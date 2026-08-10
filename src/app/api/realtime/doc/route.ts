import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { readSignedBody, bytesToBase64 } from '@/lib/realtime/serverAuth';
import { parseRoomName, roomName } from '@/lib/realtime/token';
import { currentEnvironment } from '@/lib/realtime/persist';

/**
 * 룸 콜드스타트용 초기 상태 제공. **Worker 전용**(서버간 서명).
 *
 * 사용자에게는 절대 열지 않는다 — ydoc 원본을 통째로 돌려주므로 렌더된 취합본보다 민감하다.
 * 사용자용 조회는 /api/shared-docs (contents 만, requireTeamAccess) 를 쓴다.
 *
 * ── 여기서 문서를 만들지 않는 이유 ────────────────────────────
 * partyserver 는 onConnect(토큰 검증)보다 **먼저** onStart→onLoad 를 실행한다.
 * 즉 이 라우트는 인증되지 않은 WebSocket 접속 시도만으로도 호출된다.
 * 문서 생성을 여기 두면 아무나 임의 팀·주차의 문서를 만들게 되므로,
 * 시드는 세션을 검증하는 /api/realtime/token 에서만 한다.
 *
 * POST { room }  →  { ydoc(base64), docGeneration, writeEpoch, revision, seedId, isLocked }
 */
export async function POST(request: Request) {
  const parsed = await readSignedBody<{ room?: string }>(request);
  if (!parsed.ok) return parsed.response!;

  const room = parsed.body?.room;
  const key = room ? parseRoomName(room) : null;
  if (!key) return NextResponse.json({ error: '룸 이름이 올바르지 않습니다.' }, { status: 400 });

  const { env, teamId, year, weekNum, gen } = key;

  // 룸 이름을 되돌려 원문과 정확히 일치하는지 확인한다.
  // Number() 파싱은 선행 0 을 흡수하므로("...-w032-g1") 정규화 왕복으로 막지 않으면
  // 서로 다른 문자열이 같은 문서 키로 해석돼 별개의 Durable Object 가 한 행을 공유한다.
  if (roomName(env, teamId, year, weekNum, gen) !== room) {
    return NextResponse.json({ error: '정규화되지 않은 룸 이름입니다.' }, { status: 400 });
  }

  // 룸의 환경을 서버 환경에 고정한다. 룸 이름은 호출자가 정하므로 이걸 믿으면
  // 프리뷰 워커가 'production' 문서를 열 수 있다.
  if (env !== currentEnvironment()) {
    return NextResponse.json({ error: '환경이 일치하지 않습니다.' }, { status: 400 });
  }

  const doc = await prisma.sharedDoc.findUnique({
    where: { environment_teamId_year_weekNum: { environment: env, teamId, year, weekNum } }
  });
  // 없으면 만들지 않는다 — 시드는 세션 검증을 거친 경로에서만
  if (!doc) return NextResponse.json({ error: '문서가 없습니다.' }, { status: 404 });

  // 룸 이름의 세대와 DB 세대가 다르면 구세대 룸이다. 상태를 주지 않아야
  // 복원 이후 구 룸이 되살아나지 않는다.
  if (doc.docGeneration !== gen) {
    return NextResponse.json(
      { error: '세대가 다릅니다. 새 룸으로 접속해야 합니다.', docGeneration: doc.docGeneration },
      { status: 409 }
    );
  }

  const lock = await prisma.summaryLock.findUnique({
    where: { teamId_year_weekNum: { teamId, year, weekNum } },
    select: { isLocked: true }
  });

  return NextResponse.json({
    ydoc: bytesToBase64(new Uint8Array(doc.ydoc)),
    docGeneration: doc.docGeneration,
    writeEpoch: doc.writeEpoch,
    revision: doc.revision,
    seedId: doc.seedId,
    isLocked: lock?.isLocked === true
  }, { headers: { 'Cache-Control': 'no-store' } });
}
