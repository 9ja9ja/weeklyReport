import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireTeamMaster } from '@/lib/auth';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const teamId = parseInt(searchParams.get('teamId') || '0');
    const includeInactive = searchParams.get('includeInactive') === 'true';
    if (!teamId) return NextResponse.json({ error: 'teamId required' }, { status: 400 });

    const where: any = { teamId };
    if (!includeInactive) where.isActive = true;

    const categories = await prisma.category.findMany({
      where,
      orderBy: [{ major: 'asc' }, { orderIdx: 'asc' }]
    });
    return NextResponse.json(categories);
  } catch (error) {
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { major, middle, teamId, requestUserId } = await request.json();
    if (!major || !middle || !teamId) return NextResponse.json({ error: '입력값을 확인해주세요.' }, { status: 400 });
    if (!await requireTeamMaster(requestUserId, teamId)) return NextResponse.json({ error: '권한이 필요합니다.' }, { status: 403 });
    const last = await prisma.category.findFirst({ where: { major, teamId }, orderBy: { orderIdx: 'desc' } });
    const cat = await prisma.category.create({ data: { major, middle: middle.trim(), teamId, orderIdx: (last?.orderIdx ?? -1) + 1 } });
    return NextResponse.json(cat);
  } catch (error: any) {
    if (error.code === 'P2002') return NextResponse.json({ error: '이미 존재하는 중분류입니다.' }, { status: 400 });
    return NextResponse.json({ error: '생성 실패' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = parseInt(searchParams.get('id') || '0');
    const requestUserId = parseInt(searchParams.get('requestUserId') || '0');

    const cat = await prisma.category.findUnique({ where: { id } });
    if (!cat) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (!await requireTeamMaster(requestUserId, cat.teamId)) return NextResponse.json({ error: '권한이 필요합니다.' }, { status: 403 });

    // 최근 4주간 사용 이력 확인
    const now = new Date();
    const d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
    d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const currentWeek = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
    const currentYear = d.getUTCFullYear();

    const weeks: { year: number; weekNum: number }[] = [];
    let y = currentYear, w = currentWeek;
    for (let i = 0; i < 4; i++) { weeks.push({ year: y, weekNum: w }); w--; if (w < 1) { w = 52; y--; } }

    const usageCount = await prisma.reportItem.count({
      where: {
        categoryId: id,
        report: { OR: weeks.map(wk => ({ year: wk.year, weekNum: wk.weekNum })) }
      }
    });

    if (usageCount > 0) {
      // 사용 이력 있음 → soft delete (사용안함 처리)
      await prisma.category.update({ where: { id }, data: { isActive: false } });
      return NextResponse.json({ success: true, softDeleted: true, message: `최근 4주간 ${usageCount}건의 사용 이력이 있어 '사용안함' 처리되었습니다.` });
    } else {
      // 사용 이력 없음 → hard delete
      await prisma.category.delete({ where: { id } });
      return NextResponse.json({ success: true, softDeleted: false });
    }
  } catch (error: any) {
    if (error.code === 'P2003') return NextResponse.json({ error: '이 중분류를 참조하는 데이터가 있어 삭제할 수 없습니다.' }, { status: 400 });
    return NextResponse.json({ error: '삭제 실패' }, { status: 500 });
  }
}

// 사용안함 처리된 카테고리 복원
export async function PATCH(request: Request) {
  try {
    const { id, isActive, requestUserId } = await request.json();
    const cat = await prisma.category.findUnique({ where: { id } });
    if (!cat) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (!await requireTeamMaster(requestUserId, cat.teamId)) return NextResponse.json({ error: '권한이 필요합니다.' }, { status: 403 });
    await prisma.category.update({ where: { id }, data: { isActive } });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: '실패' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const { categoryIds, teamId, requestUserId } = await request.json();
    if (!Array.isArray(categoryIds)) return NextResponse.json({ error: 'Invalid' }, { status: 400 });
    if (teamId && requestUserId && !await requireTeamMaster(requestUserId, teamId)) {
      return NextResponse.json({ error: '권한이 필요합니다.' }, { status: 403 });
    }
    await prisma.$transaction(categoryIds.map((id: number, idx: number) => prisma.category.update({ where: { id }, data: { orderIdx: idx } })));
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: '실패' }, { status: 500 });
  }
}
