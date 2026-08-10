import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { isCollabWeek } from '@/lib/realtime/persist';
import { requireTeamMaster, currentUserId, unauthorized } from '@/lib/auth';

export async function GET(request: Request) {
    const me = await currentUserId();
    if (!me) return unauthorized();
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
    const me = await currentUserId();
    if (!me) return unauthorized();
    const { year, weekNum, teamId, contents } = await request.json();
    if (!teamId) return NextResponse.json({ error: 'teamId required' }, { status: 400 });
    if (!await requireTeamMaster(me, teamId)) return NextResponse.json({ error: '권한이 필요합니다.' }, { status: 403 });

    const lock = await prisma.summaryLock.findUnique({ where: { teamId_year_weekNum: { teamId, year, weekNum } } });
    if (lock?.isLocked) return NextResponse.json({ error: '잠금 상태에서는 저장할 수 없습니다.' }, { status: 403 });

    // 공동 편집 주차의 취합본은 공유 문서의 미러다. 여기로 직접 쓰면 룸의 다음 저장이
    // 곧바로 되돌려버려, 팀장이 다듬은 내용이 몇 초 뒤 조용히 사라진다.
    const team = await prisma.team.findUnique({
      where: { id: teamId },
      select: {
        collabFromYear: true, collabFromWeek: true,
        collabUntilYear: true, collabUntilWeek: true
      }
    });
    if (team && isCollabWeek(team, year, weekNum)) {
      return NextResponse.json(
        { error: '이 주차는 팀이 함께 작성합니다. 주간보고 화면에서 편집해주세요.', collab: true },
        { status: 409 }
      );
    }

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
