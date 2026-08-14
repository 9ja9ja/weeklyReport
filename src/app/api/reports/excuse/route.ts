import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { currentUserId, unauthorized, forbidden, requireTeamAccess } from '@/lib/auth';
import { summaryStage, membersCanWriteAt } from '@/lib/summaryStage';

/** GET /api/reports/excuse?teamId=1&year=2026&weekNum=33 — 내가 이번 주 "보고 없음"을 선언했는지 */
export async function GET(request: Request) {
  try {
    const me = await currentUserId();
    if (!me) return unauthorized();

    const { searchParams } = new URL(request.url);
    const teamId = parseInt(searchParams.get('teamId') || '0');
    const year = parseInt(searchParams.get('year') || '0');
    const weekNum = parseInt(searchParams.get('weekNum') || '0');
    if (!teamId || !year || !weekNum) {
      return NextResponse.json({ error: 'Invalid parameters' }, { status: 400 });
    }

    const excuse = await prisma.writingExcuse.findUnique({
      where: { teamId_year_weekNum_userId: { teamId, year, weekNum, userId: me } }
    });
    return NextResponse.json({ hasExcuse: !!excuse });
  } catch (error) {
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const me = await currentUserId();
    if (!me) return unauthorized();

    const { teamId, year, weekNum } = await request.json();
    if (!teamId || !year || !weekNum) {
      return NextResponse.json({ error: 'Invalid data' }, { status: 400 });
    }

    if (!await requireTeamAccess(me, teamId)) {
      return forbidden('해당 팀의 보고를 작성할 권한이 없습니다.');
    }

    const lock = await prisma.summaryLock.findUnique({
      where: { teamId_year_weekNum: { teamId, year, weekNum } }
    });
    if (!membersCanWriteAt(summaryStage(lock))) return forbidden('작성 기간이 아닙니다');

    await prisma.writingExcuse.upsert({
      where: { teamId_year_weekNum_userId: { teamId, year, weekNum, userId: me } },
      update: {},
      create: { teamId, year, weekNum, userId: me }
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const me = await currentUserId();
    if (!me) return unauthorized();

    const { teamId, year, weekNum } = await request.json();
    if (!teamId || !year || !weekNum) {
      return NextResponse.json({ error: 'Invalid data' }, { status: 400 });
    }

    const lock = await prisma.summaryLock.findUnique({
      where: { teamId_year_weekNum: { teamId, year, weekNum } }
    });
    if (!membersCanWriteAt(summaryStage(lock))) return forbidden('작성 기간이 아닙니다');

    // 없으면 무시 — deleteMany 는 대상이 없어도 에러 없이 0건 삭제로 끝난다
    await prisma.writingExcuse.deleteMany({ where: { teamId, year, weekNum, userId: me } });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
