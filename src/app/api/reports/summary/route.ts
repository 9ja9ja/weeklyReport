import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireTeamMaster } from '@/lib/auth';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const year = parseInt(searchParams.get('year') || '0');
  const weekNum = parseInt(searchParams.get('weekNum') || '0');
  const teamId = parseInt(searchParams.get('teamId') || '0');

  if (!teamId) return NextResponse.json({ error: 'teamId required' }, { status: 400 });

  try {
    const [summary, lock] = await Promise.all([
      prisma.summaryData.findUnique({ where: { teamId_year_weekNum: { teamId, year, weekNum } } }),
      prisma.summaryLock.findUnique({ where: { teamId_year_weekNum: { teamId, year, weekNum } } })
    ]);
    return NextResponse.json({
      contents: summary?.contents || null,
      isLocked: lock?.isLocked ?? false,
      lockedBy: lock?.lockedBy ?? null,
      lockedAt: lock?.lockedAt ?? null
    });
  } catch (error) {
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { year, weekNum, teamId, contents, requestUserId } = await request.json();
    if (!teamId) return NextResponse.json({ error: 'teamId required' }, { status: 400 });
    if (!await requireTeamMaster(requestUserId, teamId)) return NextResponse.json({ error: '권한이 필요합니다.' }, { status: 403 });

    const lock = await prisma.summaryLock.findUnique({ where: { teamId_year_weekNum: { teamId, year, weekNum } } });
    if (lock?.isLocked) return NextResponse.json({ error: '잠금 상태에서는 저장할 수 없습니다.' }, { status: 403 });

    const result = await prisma.summaryData.upsert({
      where: { teamId_year_weekNum: { teamId, year, weekNum } },
      update: { contents, updatedAt: new Date() },
      create: { teamId, year, weekNum, contents }
    });
    return NextResponse.json({ success: true, id: result.id });
  } catch (error) {
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
