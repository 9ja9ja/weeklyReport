import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireTeamMaster } from '@/lib/auth';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const year = parseInt(searchParams.get('year') || '0');
  const weekNum = parseInt(searchParams.get('weekNum') || '0');
  const teamId = parseInt(searchParams.get('teamId') || '0');
  const all = searchParams.get('all') === 'true';

  // 전체 팀 잠금 현황판
  if (all) {
    try {
      const [teams, locks] = await Promise.all([
        prisma.team.findMany({ orderBy: { orderIdx: 'asc' }, select: { id: true, name: true, division: true } }),
        prisma.summaryLock.findMany({ where: { year, weekNum } })
      ]);
      const lockMap = new Map(locks.map(l => [l.teamId, l]));
      const lockedByIds = locks.map(l => l.lockedBy).filter((v): v is number => v != null);
      const users = lockedByIds.length > 0
        ? await prisma.user.findMany({ where: { id: { in: lockedByIds } }, select: { id: true, name: true } })
        : [];
      const userMap = new Map(users.map(u => [u.id, u.name]));

      return NextResponse.json(
        teams.map(t => {
          const l = lockMap.get(t.id);
          return {
            teamId: t.id,
            teamName: t.name,
            division: t.division,
            isLocked: l?.isLocked ?? false,
            lockedAt: l?.lockedAt ?? null,
            lockedByName: l?.lockedBy != null ? userMap.get(l.lockedBy) ?? null : null
          };
        })
      );
    } catch {
      return NextResponse.json({ error: 'Failed' }, { status: 500 });
    }
  }

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
