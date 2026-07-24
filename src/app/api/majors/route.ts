import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireTeamMaster, requirePartMaster } from '@/lib/auth';

/** GET /api/majors?teamId=1 또는 ?partId=3 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const teamId = parseInt(searchParams.get('teamId') || '0');
    const partId = parseInt(searchParams.get('partId') || '0');
    const includeInactive = searchParams.get('includeInactive') === 'true';
    if (!teamId && !partId) return NextResponse.json({ error: 'teamId 또는 partId required' }, { status: 400 });

    const where: { teamId?: number; partId?: number; isActive?: boolean } = {};
    if (partId) where.partId = partId;
    else where.teamId = teamId;
    if (!includeInactive) where.isActive = true;

    const majors = await prisma.majorCategory.findMany({
      where,
      orderBy: [{ part: { orderIdx: 'asc' } }, { orderIdx: 'asc' }],
      include: { part: { select: { id: true, name: true, orderIdx: true } } }
    });
    return NextResponse.json(majors);
  } catch {
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { name, partId, requestUserId } = await request.json();
    if (!name?.trim() || !partId) return NextResponse.json({ error: '입력값을 확인해주세요.' }, { status: 400 });

    const part = await prisma.part.findUnique({ where: { id: partId }, select: { teamId: true } });
    if (!part) return NextResponse.json({ error: '파트를 찾을 수 없습니다.' }, { status: 404 });
    if (!await requireTeamMaster(requestUserId, part.teamId)) return NextResponse.json({ error: '권한이 필요합니다.' }, { status: 403 });

    const last = await prisma.majorCategory.findFirst({ where: { partId }, orderBy: { orderIdx: 'desc' } });
    const result = await prisma.majorCategory.create({
      data: { name: name.trim(), partId, teamId: part.teamId, orderIdx: (last?.orderIdx ?? -1) + 1 }
    });
    return NextResponse.json(result);
  } catch (error) {
    if ((error as { code?: string }).code === 'P2002') {
      return NextResponse.json({ error: '이미 존재하는 대분류입니다.' }, { status: 400 });
    }
    return NextResponse.json({ error: '생성 실패' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const { majorIds, partId, requestUserId } = await request.json();
    if (!Array.isArray(majorIds)) return NextResponse.json({ error: 'Invalid' }, { status: 400 });
    if (!await requirePartMaster(requestUserId, partId)) return NextResponse.json({ error: '권한이 필요합니다.' }, { status: 403 });

    await prisma.$transaction(
      majorIds.map((id: number, idx: number) => prisma.majorCategory.update({ where: { id }, data: { orderIdx: idx } }))
    );
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: '실패' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = parseInt(searchParams.get('id') || '0');
    const requestUserId = parseInt(searchParams.get('requestUserId') || '0');

    const major = await prisma.majorCategory.findUnique({ where: { id } });
    if (!major) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (!await requireTeamMaster(requestUserId, major.teamId)) return NextResponse.json({ error: '권한이 필요합니다.' }, { status: 403 });

    // 하위 활성 중분류 존재 여부 (같은 파트 안에서만 판단)
    const activeCatCount = await prisma.category.count({
      where: { major: major.name, partId: major.partId, isActive: true }
    });
    if (activeCatCount > 0) {
      return NextResponse.json(
        { error: `활성 중분류가 ${activeCatCount}개 존재합니다. 먼저 중분류를 삭제/비활성화 해주세요.` },
        { status: 400 }
      );
    }

    const inactiveCatCount = await prisma.category.count({ where: { major: major.name, partId: major.partId } });
    if (inactiveCatCount > 0) {
      await prisma.majorCategory.update({ where: { id }, data: { isActive: false } });
      return NextResponse.json({ success: true, softDeleted: true, message: '하위 비활성 중분류가 있어 사용안함 처리되었습니다.' });
    }

    await prisma.majorCategory.delete({ where: { id } });
    return NextResponse.json({ success: true, softDeleted: false });
  } catch {
    return NextResponse.json({ error: '삭제 실패' }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const { id, newName, isActive, requestUserId } = await request.json();
    const old = await prisma.majorCategory.findUnique({ where: { id } });
    if (!old) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (!await requireTeamMaster(requestUserId, old.teamId)) return NextResponse.json({ error: '권한이 필요합니다.' }, { status: 403 });

    if (typeof isActive === 'boolean') {
      await prisma.majorCategory.update({ where: { id }, data: { isActive } });
      return NextResponse.json({ success: true });
    }

    // 이름 변경 시 같은 파트의 중분류 major 필드도 함께 갱신
    if (newName) {
      await prisma.$transaction([
        prisma.majorCategory.update({ where: { id }, data: { name: newName.trim() } }),
        prisma.category.updateMany({
          where: { major: old.name, partId: old.partId },
          data: { major: newName.trim() }
        })
      ]);
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: '변경할 내용이 없습니다.' }, { status: 400 });
  } catch (error) {
    if ((error as { code?: string }).code === 'P2002') {
      return NextResponse.json({ error: '이미 존재하는 이름입니다.' }, { status: 400 });
    }
    return NextResponse.json({ error: '실패' }, { status: 500 });
  }
}
