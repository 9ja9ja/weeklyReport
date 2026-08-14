import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { currentUserId, unauthorized, forbidden, requireTeamMaster } from '@/lib/auth';
import { getPrevWeek } from '@/lib/weekUtils';
import { loadCollabStatus } from '@/lib/collabStatus';
import { summaryStage } from '@/lib/summaryStage';

export async function GET(request: Request) {
  const me = await currentUserId();
  if (!me) return unauthorized();

  const { searchParams } = new URL(request.url);
  const userId = parseInt(searchParams.get('userId') || '0');
  const year = parseInt(searchParams.get('year') || '0');
  const weekNum = parseInt(searchParams.get('weekNum') || '0');
  const count = parseInt(searchParams.get('count') || '5');

  if (!userId || !year || !weekNum) {
    return NextResponse.json({ error: 'Invalid params' }, { status: 400 });
  }

  try {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

    // 남의 작성 이력은 그 사람 팀의 관리자만 볼 수 있다
    if (userId !== me && !await requireTeamMaster(me, user.teamId)) return forbidden();

    const weeks: { year: number; weekNum: number }[] = [];
    let y = year, w = weekNum;
    for (let i = 0; i < count; i++) {
      weeks.push({ year: y, weekNum: w });
      ({ year: y, weekNum: w } = getPrevWeek(y, w));
    }

    // 리포트 + 잠금 상태 + 공동 편집 이력 + "보고 없음" 선언을 한 번에 조회
    const [reports, locks, team, excuses] = await Promise.all([
      prisma.report.findMany({
        where: { userId, OR: weeks.map(wk => ({ year: wk.year, weekNum: wk.weekNum })) },
        select: { year: true, weekNum: true, updatedAt: true }
      }),
      prisma.summaryLock.findMany({
        where: { teamId: user.teamId, OR: weeks.map(wk => ({ year: wk.year, weekNum: wk.weekNum })) },
        select: { year: true, weekNum: true, isLocked: true, isClosed: true }
      }),
      prisma.team.findUnique({
        where: { id: user.teamId },
        select: {
          id: true,
          collabFromYear: true, collabFromWeek: true,
          collabUntilYear: true, collabUntilWeek: true
        }
      }),
      prisma.writingExcuse.findMany({
        where: { userId, teamId: user.teamId, OR: weeks.map(wk => ({ year: wk.year, weekNum: wk.weekNum })) },
        select: { year: true, weekNum: true }
      })
    ]);

    // 함께 작성한 주차는 개인 Report 가 없다. Report 만 보면 이미 작성한 주차가
    // '미작성' 으로 남아 팀 현황(10/14)과 내 현황이 어긋난다.
    const collab = await loadCollabStatus(team ? [team] : [], weeks);

    const reportMap = new Map(reports.map(r => [`${r.year}-${r.weekNum}`, r.updatedAt]));
    const lockMap = new Map(locks.map(l => [`${l.year}-${l.weekNum}`, l]));
    const excuseSet = new Set(excuses.map(e => `${e.year}-${e.weekNum}`));

    const result = weeks.map(wk => {
      const key = `${wk.year}-${wk.weekNum}`;
      const isCollab = team ? collab.isCollab(team.id, wk.year, wk.weekNum) : false;
      const editedAt = team ? collab.editedAt(team.id, userId, wk.year, wk.weekNum) : null;
      const lock = lockMap.get(key);
      return {
        year: wk.year,
        weekNum: wk.weekNum,
        // 개인 보고가 없는 주차라 '보기'(개인 보고 조회)는 화면에서 감춘다
        isCollab,
        hasReport: isCollab ? !!editedAt : reportMap.has(key),
        hasExcuse: excuseSet.has(key),
        updatedAt: (isCollab ? editedAt : reportMap.get(key)) || null,
        isLocked: lock?.isLocked ?? false,
        // 작성마감 주차도 더는 쓸 수 없다 — 화면이 [수정] 버튼을 열어두면
        // 열리지 않는 편집기로 보내게 된다
        stage: summaryStage(lock)
      };
    });

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
