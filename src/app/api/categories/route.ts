import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireTeamMaster, requirePartMaster, currentUserId, unauthorized } from '@/lib/auth';

/** GET /api/categories?teamId=1 또는 ?partId=3 */
export async function GET(request: Request) {
  try {
    const me = await currentUserId();
    if (!me) return unauthorized();
    const { searchParams } = new URL(request.url);
    const teamId = parseInt(searchParams.get('teamId') || '0');
    const partId = parseInt(searchParams.get('partId') || '0');
    const includeInactive = searchParams.get('includeInactive') === 'true';
    if (!teamId && !partId) return NextResponse.json({ error: 'teamId 또는 partId required' }, { status: 400 });

    const where: { teamId?: number; partId?: number; isActive?: boolean } = {};
    if (partId) where.partId = partId;
    else where.teamId = teamId;
    if (!includeInactive) where.isActive = true;

    const categories = await prisma.category.findMany({
      where,
      orderBy: [{ part: { orderIdx: 'asc' } }, { major: 'asc' }, { orderIdx: 'asc' }],
      include: { part: { select: { id: true, name: true, orderIdx: true } } }
    });
    return NextResponse.json(categories);
  } catch {
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const me = await currentUserId();
    if (!me) return unauthorized();
    const { major, middle, partId } = await request.json();
    if (!major || !middle || !partId) return NextResponse.json({ error: '입력값을 확인해주세요.' }, { status: 400 });

    const part = await prisma.part.findUnique({ where: { id: partId }, select: { teamId: true } });
    if (!part) return NextResponse.json({ error: '파트를 찾을 수 없습니다.' }, { status: 404 });
    if (!await requireTeamMaster(me, part.teamId)) return NextResponse.json({ error: '권한이 필요합니다.' }, { status: 403 });

    const last = await prisma.category.findFirst({ where: { major, partId }, orderBy: { orderIdx: 'desc' } });
    const cat = await prisma.category.create({
      data: { major, middle: middle.trim(), partId, teamId: part.teamId, orderIdx: (last?.orderIdx ?? -1) + 1 }
    });
    return NextResponse.json(cat);
  } catch (error) {
    if ((error as { code?: string }).code === 'P2002') {
      return NextResponse.json({ error: '이미 존재하는 중분류입니다.' }, { status: 400 });
    }
    return NextResponse.json({ error: '생성 실패' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const me = await currentUserId();
    if (!me) return unauthorized();
    const { searchParams } = new URL(request.url);
    const id = parseInt(searchParams.get('id') || '0');

    const cat = await prisma.category.findUnique({ where: { id } });
    if (!cat) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (!await requireTeamMaster(me, cat.teamId)) return NextResponse.json({ error: '권한이 필요합니다.' }, { status: 403 });

    // 보고 이력이 한 건이라도 있으면 지우지 않는다 (영구 보관 정책)
    const usageCount = await prisma.reportItem.count({ where: { categoryId: id } });

    if (usageCount > 0) {
      // 사용 이력 있음 → soft delete (사용안함 처리)
      await prisma.category.update({ where: { id }, data: { isActive: false } });
      return NextResponse.json({ success: true, softDeleted: true, message: `${usageCount}건의 작성 이력이 있어 '사용안함' 처리되었습니다.` });
    } else {
      // 사용 이력 없음 → hard delete
      await prisma.category.delete({ where: { id } });
      return NextResponse.json({ success: true, softDeleted: false });
    }
  } catch (error) {
    if ((error as { code?: string }).code === 'P2003') return NextResponse.json({ error: '이 중분류를 참조하는 데이터가 있어 삭제할 수 없습니다.' }, { status: 400 });
    return NextResponse.json({ error: '삭제 실패' }, { status: 500 });
  }
}

// 사용안함 처리된 카테고리 복원
export async function PATCH(request: Request) {
  try {
    const me = await currentUserId();
    if (!me) return unauthorized();
    const { id, isActive } = await request.json();
    const cat = await prisma.category.findUnique({ where: { id } });
    if (!cat) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (!await requireTeamMaster(me, cat.teamId)) return NextResponse.json({ error: '권한이 필요합니다.' }, { status: 403 });
    await prisma.category.update({ where: { id }, data: { isActive } });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: '실패' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const me = await currentUserId();
    if (!me) return unauthorized();
    const { categoryIds, partId, teamId } = await request.json();
    if (!Array.isArray(categoryIds)) return NextResponse.json({ error: 'Invalid' }, { status: 400 });

    const allowed = partId
      ? await requirePartMaster(me, partId)
      : teamId && me
        ? await requireTeamMaster(me, teamId)
        : true;
    if (!allowed) return NextResponse.json({ error: '권한이 필요합니다.' }, { status: 403 });
    await prisma.$transaction(categoryIds.map((id: number, idx: number) => prisma.category.update({ where: { id }, data: { orderIdx: idx } })));
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: '실패' }, { status: 500 });
  }
}
