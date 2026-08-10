import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { currentUserId, unauthorized, forbidden, requireTeamMaster } from '@/lib/auth';
import { currentEnvironment, isCollabWeek } from '@/lib/realtime/persist';
import { signToken, roomName } from '@/lib/realtime/token';
import { tokenSecret, TOKEN_TTL_SEC } from '@/lib/realtime/secrets';
import { ensureWeekDocument } from '@/lib/realtime/seed';

/**
 * 실시간 룸 접속 토큰 발급. **사용자 세션용 엔드포인트**다(서버간 시크릿 아님).
 *
 * Worker 는 Next 세션 쿠키를 검증할 수 없으므로, 여기서 세션·권한·잠금을 확인하고
 * 그 판정을 서명한 단기 토큰에 담아 넘긴다. Worker 는 토큰만 믿는다.
 *
 * GET /api/realtime/token?teamId=&year=&weekNum=
 */
export async function GET(request: Request) {
  const me = await currentUserId();
  if (!me) return unauthorized();

  const { searchParams } = new URL(request.url);
  const teamId = Number(searchParams.get('teamId'));
  const year = Number(searchParams.get('year'));
  const weekNum = Number(searchParams.get('weekNum'));
  if (![teamId, year, weekNum].every(Number.isInteger)) {
    return NextResponse.json({ error: 'teamId·year·weekNum 이 필요합니다.' }, { status: 400 });
  }

  const user = await prisma.user.findUnique({
    where: { id: me },
    select: { id: true, name: true, role: true, teamId: true, isActive: true }
  });
  if (!user?.isActive) return unauthorized();

  // 임원은 조회 전용 계정이다. 실시간 문서에는 아예 들이지 않는다 —
  // 작성 중인 미완성 상태를 확정 보고로 오해할 위험이 있고, 얻는 값이 없다.
  if (user.role === 'executive') return forbidden('임원 계정은 실시간 편집에 참여하지 않습니다.');

  // 소속 확인 (겸직 포함). superAdmin 은 전 팀 허용
  const isMember =
    user.role === 'superAdmin' ||
    user.teamId === teamId ||
    !!(await prisma.userTeam.findUnique({ where: { userId_teamId: { userId: me, teamId } } }));
  if (!isMember) return forbidden('해당 팀 소속이 아닙니다.');

  const team = await prisma.team.findUnique({
    where: { id: teamId },
    select: { collabFromYear: true, collabFromWeek: true }
  });
  if (!team) return NextResponse.json({ error: '팀을 찾을 수 없습니다.' }, { status: 404 });

  // 컷오버 이전 주차는 실시간 대상이 아니다 (개인 Report 모드)
  if (!isCollabWeek(team, year, weekNum)) {
    return NextResponse.json(
      { error: '이 주차는 아직 공동 편집 대상이 아닙니다.', collab: false },
      { status: 409 }
    );
  }

  const environment = currentEnvironment();

  // 문서가 없으면 서버가 원자적으로 만든다. 클라이언트가 만들면 동시 접속 시 중복·소실이 난다.
  const seeded = await ensureWeekDocument(environment, teamId, year, weekNum);

  const doc = await prisma.sharedDoc.findUnique({
    where: { environment_teamId_year_weekNum: { environment, teamId, year, weekNum } },
    select: { docGeneration: true, writeEpoch: true, revision: true, seedId: true }
  });
  if (!doc) {
    // 잠긴 주차인데 문서가 없으면 만들 수 없다 — 읽을 것도 없으므로 명확히 알린다
    return NextResponse.json(
      { error: seeded.reason === 'locked' ? '잠긴 주차의 문서가 없습니다.' : '문서를 준비하지 못했습니다.' },
      { status: 409 }
    );
  }

  const lock = await prisma.summaryLock.findUnique({
    where: { teamId_year_weekNum: { teamId, year, weekNum } },
    select: { isLocked: true }
  });
  const master = await requireTeamMaster(me, teamId);

  const payload = {
    uid: user.id,
    name: user.name,
    env: environment,
    teamId, year, weekNum,
    gen: doc.docGeneration,
    // 잠기면 마스터도 읽기전용이다. 잠금 해제가 먼저다.
    readOnly: lock?.isLocked === true,
    master,
    exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SEC
  };

  return NextResponse.json({
    token: await signToken(payload, tokenSecret()),
    room: roomName(environment, teamId, year, weekNum, doc.docGeneration),
    host: process.env.NEXT_PUBLIC_REALTIME_HOST ?? null,
    docGeneration: doc.docGeneration,
    writeEpoch: doc.writeEpoch,
    revision: doc.revision,
    seedId: doc.seedId,
    isLocked: lock?.isLocked === true,
    readOnly: payload.readOnly,
    master,
    expiresAt: payload.exp
  }, {
    // 토큰은 사용자·문서별이라 절대 캐시되면 안 된다
    headers: { 'Cache-Control': 'no-store' }
  });
}
