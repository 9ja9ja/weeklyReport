import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireTeamMaster } from '@/lib/auth';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const year = parseInt(searchParams.get('year') || '0');
  const weekNum = parseInt(searchParams.get('weekNum') || '0');
  const teamId = parseInt(searchParams.get('teamId') || '0');

  if (!teamId) return NextResponse.json({ isLocked: false });

  try {
    const lock = await prisma.summaryLock.findUnique({
      where: { teamId_year_weekNum: { teamId, year, weekNum } }
    });
    return NextResponse.json({ isLocked: lock?.isLocked ?? false, lockedBy: lock?.lockedBy ?? null, lockedAt: lock?.lockedAt ?? null });
  } catch {
    return NextResponse.json({ isLocked: false });
  }
}

export async function POST(request: Request) {
  try {
    const { year, weekNum, teamId, isLocked, requestUserId } = await request.json();
    if (!teamId) return NextResponse.json({ error: 'teamId required' }, { status: 400 });
    if (!await requireTeamMaster(requestUserId, teamId)) return NextResponse.json({ error: '권한이 필요합니다.' }, { status: 403 });

    const result = await prisma.summaryLock.upsert({
      where: { teamId_year_weekNum: { teamId, year, weekNum } },
      update: { isLocked, lockedBy: isLocked ? requestUserId : null, lockedAt: isLocked ? new Date() : null },
      create: { teamId, year, weekNum, isLocked, lockedBy: isLocked ? requestUserId : null, lockedAt: isLocked ? new Date() : null }
    });
    return NextResponse.json({ success: true, isLocked: result.isLocked });
  } catch (error) {
    return NextResponse.json({ error: '실패' }, { status: 500 });
  }
}
