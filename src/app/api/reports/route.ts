import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { regenerateSummary } from '@/lib/summaryGenerator';
import { requireTeamAccess } from '@/lib/auth';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const userId = searchParams.get('userId');
  const year = searchParams.get('year');
  const weekNum = searchParams.get('weekNum');
  const all = searchParams.get('all');
  const teamId = searchParams.get('teamId');

  try {
    if (all === 'true' && year && weekNum && teamId) {
      const tid = parseInt(teamId);
      // 겸직 지원: 작성자의 소속이 아니라 "항목이 속한 팀" 기준으로 취합한다.
      const reports = await prisma.report.findMany({
        where: {
          year: parseInt(year),
          weekNum: parseInt(weekNum),
          items: { some: { category: { teamId: tid } } }
        },
        include: {
          user: true,
          items: { where: { category: { teamId: tid } }, include: { category: true } }
        }
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

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

    // 겸직 지원: 잠금/취합 대상 팀은 작성자 소속이 아니라 저장하려는 항목들이 속한 팀이다.
    const sentCategoryIds: number[] = items.map((i: { categoryId: number }) => i.categoryId);
    const cats = sentCategoryIds.length > 0
      ? await prisma.category.findMany({ where: { id: { in: sentCategoryIds } }, select: { teamId: true } })
      : [];
    const affectedTeamIds = cats.length > 0
      ? Array.from(new Set(cats.map(c => c.teamId)))
      : [user.teamId];

    // 작성 권한 확인 (주 소속 + 겸직)
    for (const tid of affectedTeamIds) {
      if (!await requireTeamAccess(userId, tid)) {
        return NextResponse.json({ error: '해당 팀의 보고를 작성할 권한이 없습니다.' }, { status: 403 });
      }
    }

    // 잠금 상태 확인 (팀별)
    const locks = await prisma.summaryLock.findMany({
      where: { year, weekNum, teamId: { in: affectedTeamIds }, isLocked: true }
    });
    if (locks.length > 0) return NextResponse.json({ error: '이 주차는 잠겨있어 저장할 수 없습니다.' }, { status: 403 });

    const result = await prisma.$transaction(async (tx) => {
      const report = await tx.report.upsert({
        where: { userId_year_weekNum: { userId, year, weekNum } },
        update: { updatedAt: new Date() },
        create: { userId, year, weekNum }
      });

      for (const item of items) {
        const currentArr = Array.isArray(item.currentContents) ? item.currentContents : JSON.parse(item.currentContents || '[]');
        const nextArr = Array.isArray(item.nextContents) ? item.nextContents : JSON.parse(item.nextContents || '[]');
        const currentStr = JSON.stringify(currentArr);
        const nextStr = JSON.stringify(nextArr);

        if (currentArr.length === 0 && nextArr.length === 0) {
          await tx.reportItem.deleteMany({
            where: { reportId: report.id, categoryId: item.categoryId }
          });
        } else {
          await tx.reportItem.upsert({
            where: { reportId_categoryId: { reportId: report.id, categoryId: item.categoryId } },
            update: { currentContents: currentStr, nextContents: nextStr },
            create: { reportId: report.id, categoryId: item.categoryId, currentContents: currentStr, nextContents: nextStr }
          });
        }
      }

      // 전송되지 않은 기존 항목 삭제 — 단, 이번에 저장하는 팀의 항목만 대상으로 한다.
      // (겸직자가 A팀만 저장할 때 B팀 항목이 지워지거나, 잠긴 팀 항목이 날아가면 안 된다)
      if (sentCategoryIds.length > 0) {
        await tx.reportItem.deleteMany({
          where: {
            reportId: report.id,
            categoryId: { notIn: sentCategoryIds },
            category: { teamId: { in: affectedTeamIds } }
          }
        });
      }

      // 보관 정책: 영구 보관. (이전에는 저장할 때마다 4주 이전 보고를 일괄 삭제했으나 폐기)
      return report;
    });

    // 취합본 자동 갱신 (영향받은 팀 전부)
    for (const tid of affectedTeamIds) {
      try { await regenerateSummary(year, weekNum, tid); } catch (e) { console.error('Summary refresh failed:', e); }
    }

    return NextResponse.json({ success: true, reportId: result.id });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
