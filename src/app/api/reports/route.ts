import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { regenerateSummary } from '@/lib/summaryGenerator';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const userId = searchParams.get('userId');
  const year = searchParams.get('year');
  const weekNum = searchParams.get('weekNum');
  const all = searchParams.get('all');
  const teamId = searchParams.get('teamId');

  try {
    if (all === 'true' && year && weekNum && teamId) {
      const reports = await prisma.report.findMany({
        where: { year: parseInt(year), weekNum: parseInt(weekNum), user: { teamId: parseInt(teamId) } },
        include: { user: true, items: { include: { category: true } } }
      });
      return NextResponse.json(reports);
    }

    if (userId && year && weekNum) {
      const report = await prisma.report.findUnique({
        where: { userId_year_weekNum: { userId: parseInt(userId), year: parseInt(year), weekNum: parseInt(weekNum) } },
        include: { items: { include: { category: true } } }
      });
      return NextResponse.json(report || null);
    }

    return NextResponse.json({ error: 'Invalid parameters' }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { userId, year, weekNum, items } = await request.json();
    if (!userId || !year || !weekNum || !Array.isArray(items)) return NextResponse.json({ error: 'Invalid data' }, { status: 400 });

    // 유저의 팀 조회
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

    // 잠금 상태 확인 (팀별)
    const lock = await prisma.summaryLock.findUnique({
      where: { teamId_year_weekNum: { teamId: user.teamId, year, weekNum } }
    });
    if (lock?.isLocked) return NextResponse.json({ error: '이 주차는 잠겨있어 저장할 수 없습니다.' }, { status: 403 });

    const result = await prisma.$transaction(async (tx) => {
      const report = await tx.report.upsert({
        where: { userId_year_weekNum: { userId, year, weekNum } },
        update: { updatedAt: new Date() },
        create: { userId, year, weekNum }
      });

      for (const item of items) {
        const currentStr = typeof item.currentContents === 'string' ? item.currentContents : JSON.stringify(item.currentContents);
        const nextStr = typeof item.nextContents === 'string' ? item.nextContents : JSON.stringify(item.nextContents);
        await tx.reportItem.upsert({
          where: { reportId_categoryId: { reportId: report.id, categoryId: item.categoryId } },
          update: { currentContents: currentStr, nextContents: nextStr },
          create: { reportId: report.id, categoryId: item.categoryId, currentContents: currentStr, nextContents: nextStr }
        });
      }

      // 4주 보관 정책
      const cy = parseInt(year), cw = parseInt(weekNum);
      const cutY = cw > 4 ? cy : cy - 1, cutW = cw > 4 ? cw - 4 : cw + 52 - 4;
      await tx.report.deleteMany({ where: { OR: [{ year: { lt: cutY } }, { year: cutY, weekNum: { lt: cutW } }] } });

      return report;
    });

    // 취합본 자동 갱신 (팀별)
    try { await regenerateSummary(year, weekNum, user.teamId); } catch (e) { console.error('Summary refresh failed:', e); }

    return NextResponse.json({ success: true, reportId: result.id });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
