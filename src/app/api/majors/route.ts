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

    const majors = await prisma.majorCategory.findMany({ where, orderBy: { orderIdx: 'asc' } });
    return NextResponse.json(majors);
  } catch (error) {
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { name, teamId, requestUserId } = await request.json();
    if (!name?.trim() || !teamId) return NextResponse.json({ error: '입력값을 확인해주세요.' }, { status: 400 });
    if (!await requireTeamMaster(requestUserId, teamId)) return NextResponse.json({ error: '권한이 필요합니다.' }, { status: 403 });
    const last = await prisma.majorCategory.findFirst({ where: { teamId }, orderBy: { orderIdx: 'desc' } });
    const result = await prisma.majorCategory.create({ data: { name: name.trim(), teamId, orderIdx: (last?.orderIdx ?? -1) + 1 } });
    return NextResponse.json(result);
  } catch (error: any) {
    if (error.code === 'P2002') return NextResponse.json({ error: '이미 존재하는 대분류입니다.' }, { status: 400 });
    return NextResponse.json({ error: '생성 실패' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const { majorIds, teamId, requestUserId } = await request.json();
    if (!await requireTeamMaster(requestUserId, teamId)) return NextResponse.json({ error: '권한이 필요합니다.' }, { status: 403 });
    await prisma.$transaction(majorIds.map((id: number, idx: number) => prisma.majorCategory.update({ where: { id }, data: { orderIdx: idx } })));
    return NextResponse.json({ success: true });
  } catch (error) {
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

    // 하위 활성 중분류 존재 여부 확인
    const activeCatCount = await prisma.category.count({ where: { major: major.name, teamId: major.teamId, isActive: true } });
    if (activeCatCount > 0) return NextResponse.json({ error: `활성 중분류가 ${activeCatCount}개 존재합니다. 먼저 중분류를 삭제/비활성화 해주세요.` }, { status: 400 });

    // 비활성 중분류라도 있으면 soft delete
    const inactiveCatCount = await prisma.category.count({ where: { major: major.name, teamId: major.teamId } });
    if (inactiveCatCount > 0) {
      await prisma.majorCategory.update({ where: { id }, data: { isActive: false } });
      return NextResponse.json({ success: true, softDeleted: true, message: '하위 비활성 중분류가 있어 사용안함 처리되었습니다.' });
    }

    await prisma.majorCategory.delete({ where: { id } });
    return NextResponse.json({ success: true, softDeleted: false });
  } catch (error) {
    return NextResponse.json({ error: '삭제 실패' }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const { id, newName, isActive, requestUserId } = await request.json();
    const old = await prisma.majorCategory.findUnique({ where: { id } });
    if (!old) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (!await requireTeamMaster(requestUserId, old.teamId)) return NextResponse.json({ error: '권한이 필요합니다.' }, { status: 403 });

    // 활성/비활성 토글
    if (typeof isActive === 'boolean') {
      await prisma.majorCategory.update({ where: { id }, data: { isActive } });
      return NextResponse.json({ success: true });
    }

    // 이름 변경
    if (newName) {
      await prisma.$transaction([
        prisma.majorCategory.update({ where: { id }, data: { name: newName.trim() } }),
        prisma.category.updateMany({ where: { major: old.name, teamId: old.teamId }, data: { major: newName.trim() } })
      ]);
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: '변경할 내용이 없습니다.' }, { status: 400 });
  } catch (error: any) {
    if (error.code === 'P2002') return NextResponse.json({ error: '이미 존재하는 이름입니다.' }, { status: 400 });
    return NextResponse.json({ error: '실패' }, { status: 500 });
  }
}
