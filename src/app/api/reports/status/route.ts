import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { currentUserId, unauthorized, forbidden, requireTeamMaster } from '@/lib/auth';
import { getPrevWeek } from '@/lib/weekUtils';

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

    // 리포트 + 잠금 상태를 한 번에 조회
    const [reports, locks] = await Promise.all([
      prisma.report.findMany({
        where: { userId, OR: weeks.map(wk => ({ year: wk.year, weekNum: wk.weekNum })) },
        select: { year: true, weekNum: true, updatedAt: true }
      }),
      prisma.summaryLock.findMany({
        where: { teamId: user.teamId, OR: weeks.map(wk => ({ year: wk.year, weekNum: wk.weekNum })) },
        select: { year: true, weekNum: true, isLocked: true }
      })
    ]);

    const reportMap = new Map(reports.map(r => [`${r.year}-${r.weekNum}`, r.updatedAt]));
    const lockMap = new Map(locks.map(l => [`${l.year}-${l.weekNum}`, l.isLocked]));

    const result = weeks.map(wk => ({
      year: wk.year,
      weekNum: wk.weekNum,
      hasReport: reportMap.has(`${wk.year}-${wk.weekNum}`),
      updatedAt: reportMap.get(`${wk.year}-${wk.weekNum}`) || null,
      isLocked: lockMap.get(`${wk.year}-${wk.weekNum}`) ?? false
    }));

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
