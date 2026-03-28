import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const userId = parseInt(searchParams.get('userId') || '0');
  const year = parseInt(searchParams.get('year') || '0');
  const weekNum = parseInt(searchParams.get('weekNum') || '0');
  const count = parseInt(searchParams.get('count') || '5');

  if (!userId || !year || !weekNum) {
    return NextResponse.json({ error: 'Invalid params' }, { status: 400 });
  }

  try {
    // 유저 존재 확인
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });
    const weeks: { year: number; weekNum: number }[] = [];
    let y = year;
    let w = weekNum;
    for (let i = 0; i < count; i++) {
      weeks.push({ year: y, weekNum: w });
      w--;
      if (w < 1) { w = 52; y--; }
    }

    const reports = await prisma.report.findMany({
      where: {
        userId,
        OR: weeks.map(wk => ({ year: wk.year, weekNum: wk.weekNum }))
      },
      select: { year: true, weekNum: true, updatedAt: true }
    });

    const reportMap = new Map(reports.map(r => [`${r.year}-${r.weekNum}`, r.updatedAt]));

    const result = weeks.map(wk => ({
      year: wk.year,
      weekNum: wk.weekNum,
      hasReport: reportMap.has(`${wk.year}-${wk.weekNum}`),
      updatedAt: reportMap.get(`${wk.year}-${wk.weekNum}`) || null
    }));

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
