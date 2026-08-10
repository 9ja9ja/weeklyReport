import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { currentUserId, unauthorized, forbidden, requireTeamAccess } from '@/lib/auth';
import { currentEnvironment, isCollabWeek } from '@/lib/realtime/persist';
import { roomName } from '@/lib/realtime/token';
import { flushRoom } from '@/lib/realtime/roomControl';
import { isRealtimeConfigured } from '@/lib/realtime/secrets';

/**
 * 주간보고 공유 문서 즉시 저장. **사용자 세션용**.
 *
 * 편집은 자동 저장되지만 사용자는 [저장]을 눌러 확인하고 싶어 한다.
 * 이 경로는 룸에 flush 명령만 보낸다 — 문서 내용은 받지 않는다.
 * 클라이언트가 보낸 내용을 신뢰하면 룸 상태와 DB 가 갈라진다.
 *
 * POST { teamId, year, weekNum }
 */
export async function POST(request: Request) {
  const me = await currentUserId();
  if (!me) return unauthorized();
  if (!isRealtimeConfigured()) {
    return NextResponse.json({ error: '실시간 기능이 아직 구성되지 않았습니다.' }, { status: 503 });
  }

  const { teamId, year, weekNum } = await request.json().catch(() => ({}));
  if (![teamId, year, weekNum].every(Number.isInteger)) {
    return NextResponse.json({ error: 'teamId·year·weekNum 이 필요합니다.' }, { status: 400 });
  }
  if (!(await requireTeamAccess(me, teamId))) return forbidden('해당 팀 소속이 아닙니다.');

  const team = await prisma.team.findUnique({
    where: { id: teamId },
    select: {
      collabFromYear: true, collabFromWeek: true,
      collabUntilYear: true, collabUntilWeek: true
    }
  });
  if (!team || !isCollabWeek(team, year, weekNum)) {
    return NextResponse.json({ error: '이 주차는 공동 편집 대상이 아닙니다.' }, { status: 409 });
  }

  const environment = currentEnvironment();
  const doc = await prisma.sharedDoc.findUnique({
    where: { environment_teamId_year_weekNum: { environment, teamId, year, weekNum } },
    select: { docGeneration: true }
  });
  if (!doc) return NextResponse.json({ error: '공유 문서가 없습니다.' }, { status: 404 });

  const res = await flushRoom(roomName(environment, teamId, year, weekNum, doc.docGeneration));
  if (!res.ok) {
    return NextResponse.json(
      { error: '실시간 서버에 저장 신호를 보내지 못했습니다.', detail: res.error ?? res.status },
      { status: 502 }
    );
  }
  // 룸은 저장에 실패해도 HTTP 200 에 { ok:false } 를 담아 돌려준다.
  // 상태코드만 보면 실패를 성공으로 알리게 된다 — 저장 확인이 목적인 버튼에서 가장 나쁜 오답이다.
  const saved = (res.body as { ok?: boolean } | undefined)?.ok;
  if (saved === false) {
    return NextResponse.json(
      { ok: false, error: '실시간 서버가 저장을 마치지 못했습니다. 잠시 후 다시 시도해주세요.' },
      { status: 409 }
    );
  }

  const after = await prisma.sharedDoc.findUnique({
    where: { environment_teamId_year_weekNum: { environment, teamId, year, weekNum } },
    select: { revision: true }
  });
  return NextResponse.json({ ok: true, revision: after?.revision ?? null });
}
