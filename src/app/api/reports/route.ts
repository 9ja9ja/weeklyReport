import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const userId = searchParams.get('userId');
  const year = searchParams.get('year');
  const weekNum = searchParams.get('weekNum');
  const all = searchParams.get('all');

  try {
    if (all === 'true' && year && weekNum) {
      // Get combined reports for a specific week
      const reports = await prisma.report.findMany({
        where: { year: parseInt(year), weekNum: parseInt(weekNum) },
        include: { user: true, items: { include: { category: true } } }
      });
      return NextResponse.json(reports);
    }

    if (userId && year && weekNum) {
      // Get single user's report
      const report = await prisma.report.findUnique({
        where: {
          userId_year_weekNum: {
            userId: parseInt(userId),
            year: parseInt(year),
            weekNum: parseInt(weekNum)
          }
        },
        include: { items: { include: { category: true } } }
      });
      return NextResponse.json(report || null);
    }

    return NextResponse.json({ error: 'Invalid parameters' }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch reports' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { userId, year, weekNum, items } = body;
    // items: Array of { categoryId, currentContents, nextContents }

    if (!userId || !year || !weekNum || !Array.isArray(items)) {
      return NextResponse.json({ error: 'Invalid data format' }, { status: 400 });
    }

    const result = await prisma.$transaction(async (tx) => {
      const report = await tx.report.upsert({
        where: {
          userId_year_weekNum: {
            userId, year, weekNum
          }
        },
        update: { updatedAt: new Date() },
        create: { userId, year, weekNum }
      });

      for (const item of items) {
        const { categoryId, currentContents, nextContents } = item;

        const currentContentsStr = typeof currentContents === 'string' ? currentContents : JSON.stringify(currentContents);
        const nextContentsStr = typeof nextContents === 'string' ? nextContents : JSON.stringify(nextContents);

        await tx.reportItem.upsert({
          where: {
            reportId_categoryId: {
              reportId: report.id,
              categoryId
            }
          },
          update: {
            currentContents: currentContentsStr,
            nextContents: nextContentsStr
          },
          create: {
            reportId: report.id,
            categoryId,
            currentContents: currentContentsStr,
            nextContents: nextContentsStr
          }
        });
      }

      // 데이터 4주 보관 정책 (이전 데이터 자동 삭제)
      // Ensure year and weekNum are numbers for calculation
      const currentYear = parseInt(year);
      const currentWeekNum = parseInt(weekNum);

      const cutoffYear = currentWeekNum > 4 ? currentYear : currentYear - 1;
      const cutoffWeekNum = currentWeekNum > 4 ? currentWeekNum - 4 : currentWeekNum + 52 - 4;

      await tx.report.deleteMany({
        where: {
          OR: [
            { year: { lt: cutoffYear } },
            { year: cutoffYear, weekNum: { lt: cutoffWeekNum } }
          ]
        }
      });

      return report;
    });

    return NextResponse.json({ success: true, reportId: result.id });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Failed to save report' }, { status: 500 });
  }
}
