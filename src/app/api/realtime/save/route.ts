import { NextResponse } from 'next/server';
import { readSignedBody, base64ToBytes } from '@/lib/realtime/serverAuth';
import { parseRoomName, roomName } from '@/lib/realtime/token';
import { persistUpdate, currentEnvironment, type PersistOp } from '@/lib/realtime/persist';

/**
 * 룸 → DB 저장. **Worker 전용**(서버간 서명).
 *
 * y-partyserver 의 debounce 콜백은 실패해도 console.error 만 남기고 삼킨다(스파이크 확인).
 * 그래서 Worker 는 이 응답의 revision 을 받아 클라이언트에 ACK 로 전달해야 하고,
 * 실패하면 재시도해야 한다. "저장됨" 표시는 provider sync 가 아니라 이 revision 기준이다.
 *
 * POST { room, ydoc(base64), requestId, docGeneration, writeEpoch, op?, dirtyUserIds?, snapshotReason? }
 */
interface SaveBody {
  room?: string;
  ydoc?: string;
  requestId?: string;
  docGeneration?: number;
  writeEpoch?: number;
  op?: PersistOp;
  dirtyUserIds?: number[];
  snapshotReason?: 'lock' | 'bulk-delete' | 'pre-restore';
}

/** 요청 본문으로 올 수 있는 op — 잠금 확정·복원은 전용 라우트에서만 수행한다 */
const ALLOWED_OPS: PersistOp[] = ['normal'];

export async function POST(request: Request) {
  const parsed = await readSignedBody<SaveBody>(request);
  if (!parsed.ok) return parsed.response!;
  const body = parsed.body!;

  const key = body.room ? parseRoomName(body.room) : null;
  if (!key) return NextResponse.json({ error: '룸 이름이 올바르지 않습니다.' }, { status: 400 });

  // 정규화 왕복 — 선행 0 등으로 다른 문자열이 같은 문서 키로 해석되면 안 된다
  if (roomName(key.env, key.teamId, key.year, key.weekNum, key.gen) !== body.room) {
    return NextResponse.json({ error: '정규화되지 않은 룸 이름입니다.' }, { status: 400 });
  }
  // 룸의 환경을 서버 환경에 고정한다 (SummaryData 미러에는 environment 구분이 없다)
  if (key.env !== currentEnvironment()) {
    return NextResponse.json({ error: '환경이 일치하지 않습니다.' }, { status: 400 });
  }
  if (!body.ydoc || !body.requestId) {
    return NextResponse.json({ error: 'ydoc·requestId 가 필요합니다.' }, { status: 400 });
  }

  // 서명을 통과했더라도 op 는 좁힌다. lock-finalize/restore 는 잠금·세대 검사를 건너뛰므로
  // 요청 본문으로 지정할 수 있게 두면 시크릿 유출 시 파급이 커진다.
  const op = body.op ?? 'normal';
  if (!ALLOWED_OPS.includes(op)) {
    return NextResponse.json({ error: `이 경로에서는 op=${op} 를 쓸 수 없습니다.` }, { status: 400 });
  }

  // 룸 이름의 세대와 요청 세대가 어긋나면 구세대 룸의 저장이다
  if (body.docGeneration !== undefined && body.docGeneration !== key.gen) {
    return NextResponse.json(
      { ok: false, reason: 'generation-mismatch' },
      { status: 409 }
    );
  }

  try {
    const result = await persistUpdate({
      environment: key.env,
      teamId: key.teamId,
      year: key.year,
      weekNum: key.weekNum,
      update: base64ToBytes(body.ydoc),
      requestId: body.requestId,
      docGeneration: key.gen,
      writeEpoch: body.writeEpoch,
      op,
      dirtyUserIds: Array.isArray(body.dirtyUserIds) ? body.dirtyUserIds.filter(Number.isInteger) : [],
      snapshotReason: body.snapshotReason
    });

    // 실패도 200 이 아닌 상태코드로 알려 Worker 가 재시도/중단을 구분할 수 있게 한다
    if (!result.ok) {
      const status = result.reason === 'busy' ? 503 : 409;
      return NextResponse.json(result, { status });
    }
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return NextResponse.json({ ok: false, reason: 'error', detail: String(e) }, { status: 500 });
  }
}
