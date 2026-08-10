import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { currentUserId, unauthorized, forbidden, requireMasterOrAbove } from '@/lib/auth';
import { currentEnvironment } from '@/lib/realtime/persist';
import { briefRoomName } from '@/lib/realtime/token';
import { flushRoom } from '@/lib/realtime/roomControl';
import { isRealtimeConfigured } from '@/lib/realtime/secrets';

/**
 * 요약본 즉시 저장. **사용자 세션용**.
 *
 * 편집은 2초 디바운스로 자동 저장되지만, 사용자는 [저장]을 눌러 확인하고 싶어 한다.
 * 이 경로는 룸에 flush 명령만 보낸다 — 문서 내용은 받지 않는다.
 * 클라이언트가 보낸 HTML 을 신뢰하면 룸 상태와 DB 가 갈라지기 때문이다.
 *
 * POST { year, weekNum }
 */
export async function POST(request: Request) {
  const me = await currentUserId();
  if (!me) return unauthorized();
  if (!(await requireMasterOrAbove(me))) return forbidden('관리자 이상만 저장할 수 있습니다.');
  if (!isRealtimeConfigured()) {
    return NextResponse.json({ error: '실시간 기능이 아직 구성되지 않았습니다.' }, { status: 503 });
  }

  const { year, weekNum } = await request.json().catch(() => ({}));
  if (!Number.isInteger(year) || !Number.isInteger(weekNum)) {
    return NextResponse.json({ error: 'year·weekNum 이 필요합니다.' }, { status: 400 });
  }

  const environment = currentEnvironment();
  const doc = await prisma.briefDoc.findUnique({
    where: { environment_year_weekNum: { environment, year, weekNum } },
    select: { docGeneration: true }
  });
  if (!doc) return NextResponse.json({ error: '실시간 문서가 없습니다.' }, { status: 404 });

  const res = await flushRoom(briefRoomName(environment, year, weekNum, doc.docGeneration));
  if (!res.ok) {
    return NextResponse.json(
      { error: '실시간 서버에 저장 신호를 보내지 못했습니다.', detail: res.error ?? res.status },
      { status: 502 }
    );
  }
  // 룸은 저장 실패도 HTTP 200 + { ok:false } 로 돌려준다. 상태코드만 보면 거짓 성공이 된다.
  const saved = (res.body as { ok?: boolean } | undefined)?.ok;
  if (saved === false) {
    return NextResponse.json(
      { ok: false, error: '실시간 서버가 저장을 마치지 못했습니다. 잠시 후 다시 시도해주세요.' },
      { status: 409 }
    );
  }

  // 룸이 저장한 뒤의 revision 을 그대로 돌려준다 — "저장됨" 표시의 기준값이다
  const after = await prisma.briefDoc.findUnique({
    where: { environment_year_weekNum: { environment, year, weekNum } },
    select: { revision: true }
  });
  return NextResponse.json({ ok: true, revision: after?.revision ?? null, room: res.body });
}
