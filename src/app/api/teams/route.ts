import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireSuperAdmin } from '@/lib/auth';

export async function GET() {
  try {
    const teams = await prisma.team.findMany({
      orderBy: { id: 'asc' },
      include: { _count: { select: { users: true } } }
    });
    return NextResponse.json(teams);
  } catch (error) {
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { name, requestUserId } = await request.json();
    if (!name?.trim()) return NextResponse.json({ error: '팀 이름을 입력해주세요.' }, { status: 400 });
    if (!await requireSuperAdmin(requestUserId)) return NextResponse.json({ error: '최고관리자 권한이 필요합니다.' }, { status: 403 });
    const team = await prisma.team.create({ data: { name: name.trim() } });
    return NextResponse.json(team);
  } catch (error: any) {
    if (error.code === 'P2002') return NextResponse.json({ error: '이미 존재하는 팀 이름입니다.' }, { status: 400 });
    return NextResponse.json({ error: '생성 실패' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = parseInt(searchParams.get('id') || '0');
    const requestUserId = parseInt(searchParams.get('requestUserId') || '0');
    if (!await requireSuperAdmin(requestUserId)) return NextResponse.json({ error: '최고관리자 권한이 필요합니다.' }, { status: 403 });
    await prisma.team.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: '삭제 실패' }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const { id, newName, requestUserId } = await request.json();
    if (!await requireSuperAdmin(requestUserId)) return NextResponse.json({ error: '최고관리자 권한이 필요합니다.' }, { status: 403 });
    await prisma.team.update({ where: { id }, data: { name: newName.trim() } });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    if (error.code === 'P2002') return NextResponse.json({ error: '이미 존재하는 팀 이름입니다.' }, { status: 400 });
    return NextResponse.json({ error: '수정 실패' }, { status: 500 });
  }
}
