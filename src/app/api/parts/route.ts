import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireTeamMaster, requirePartMaster } from '@/lib/auth';

/** GET /api/parts?teamId=1[&includeInactive=true][&withTree=true] */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const teamId = parseInt(searchParams.get('teamId') || '0');
    const includeInactive = searchParams.get('includeInactive') === 'true';
    const withTree = searchParams.get('withTree') === 'true';
    if (!teamId) return NextResponse.json({ error: 'teamId required' }, { status: 400 });

    const where: { teamId: number; isActive?: boolean } = { teamId };
    if (!includeInactive) where.isActive = true;

    if (!withTree) {
      const parts = await prisma.part.findMany({ where, orderBy: { orderIdx: 'asc' } });
      return NextResponse.json(parts);
    }

    // 파트 > 대분류 > 중분류 트리를 한 번에
    const parts = await prisma.part.findMany({
      where,
      orderBy: { orderIdx: 'asc' },
      include: {
        majorCategories: {
          where: includeInactive ? {} : { isActive: true },
          orderBy: { orderIdx: 'asc' }
        },
        categories: {
          where: includeInactive ? {} : { isActive: true },
          orderBy: { orderIdx: 'asc' }
        }
      }
    });

    return NextResponse.json(
      parts.map(p => ({
        id: p.id,
        name: p.name,
        orderIdx: p.orderIdx,
        isActive: p.isActive,
        majors: p.majorCategories.map(m => ({
          id: m.id,
          name: m.name,
          orderIdx: m.orderIdx,
          isActive: m.isActive,
          categories: p.categories.filter(c => c.major === m.name)
        }))
      }))
    );
  } catch {
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { name, teamId, requestUserId } = await request.json();
    if (!name?.trim() || !teamId) return NextResponse.json({ error: '입력값을 확인해주세요.' }, { status: 400 });
    if (!await requireTeamMaster(requestUserId, teamId)) return NextResponse.json({ error: '권한이 필요합니다.' }, { status: 403 });

    const last = await prisma.part.findFirst({ where: { teamId }, orderBy: { orderIdx: 'desc' } });
    const part = await prisma.part.create({
      data: { name: name.trim(), teamId, orderIdx: (last?.orderIdx ?? -1) + 1 }
    });
    return NextResponse.json(part);
  } catch (error) {
    if ((error as { code?: string }).code === 'P2002') {
      return NextResponse.json({ error: '이미 존재하는 파트입니다.' }, { status: 400 });
    }
    return NextResponse.json({ error: '생성 실패' }, { status: 500 });
  }
}

/** 순서 변경 */
export async function PUT(request: Request) {
  try {
    const { partIds, teamId, requestUserId } = await request.json();
    if (!Array.isArray(partIds)) return NextResponse.json({ error: 'Invalid' }, { status: 400 });
    if (!await requireTeamMaster(requestUserId, teamId)) return NextResponse.json({ error: '권한이 필요합니다.' }, { status: 403 });

    await prisma.$transaction(
      partIds.map((id: number, idx: number) => prisma.part.update({ where: { id }, data: { orderIdx: idx } }))
    );
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: '실패' }, { status: 500 });
  }
}

/** 이름 변경 / 활성 토글 */
export async function PATCH(request: Request) {
  try {
    const { id, newName, isActive, requestUserId } = await request.json();
    if (!await requirePartMaster(requestUserId, id)) return NextResponse.json({ error: '권한이 필요합니다.' }, { status: 403 });

    if (typeof isActive === 'boolean') {
      await prisma.part.update({ where: { id }, data: { isActive } });
      return NextResponse.json({ success: true });
    }
    if (newName?.trim()) {
      await prisma.part.update({ where: { id }, data: { name: newName.trim() } });
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

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = parseInt(searchParams.get('id') || '0');
    const requestUserId = parseInt(searchParams.get('requestUserId') || '0');

    const part = await prisma.part.findUnique({ where: { id } });
    if (!part) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (!await requireTeamMaster(requestUserId, part.teamId)) return NextResponse.json({ error: '권한이 필요합니다.' }, { status: 403 });

    const activeMajors = await prisma.majorCategory.count({ where: { partId: id, isActive: true } });
    if (activeMajors > 0) {
      return NextResponse.json(
        { error: `활성 대분류가 ${activeMajors}개 존재합니다. 먼저 대분류를 삭제/비활성화 해주세요.` },
        { status: 400 }
      );
    }

    // 작성 이력이 있으면 soft delete (Category → ReportItem 은 Restrict 이므로 하드 삭제 불가)
    const usage = await prisma.reportItem.count({ where: { category: { partId: id } } });
    if (usage > 0) {
      await prisma.part.update({ where: { id }, data: { isActive: false } });
      return NextResponse.json({
        success: true,
        softDeleted: true,
        message: `${usage}건의 작성 이력이 있어 '사용안함' 처리되었습니다.`
      });
    }

    await prisma.part.delete({ where: { id } });
    return NextResponse.json({ success: true, softDeleted: false });
  } catch {
    return NextResponse.json({ error: '삭제 실패' }, { status: 500 });
  }
}
