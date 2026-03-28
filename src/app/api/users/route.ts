import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireTeamMaster, requireSuperAdmin } from '@/lib/auth';
import bcrypt from 'bcryptjs';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const teamId = parseInt(searchParams.get('teamId') || '0');
    const withStatus = searchParams.get('withStatus') === 'true';
    const year = parseInt(searchParams.get('year') || '0');
    const weekNum = parseInt(searchParams.get('weekNum') || '0');

    const where = teamId ? { teamId } : {};

    const users = await prisma.user.findMany({
      where,
      orderBy: { name: 'asc' },
      select: {
        id: true, name: true, role: true, teamId: true, mustChangePw: true, createdAt: true,
        ...(withStatus && year && weekNum ? {
          reports: { where: { year, weekNum }, select: { id: true, updatedAt: true } }
        } : {})
      }
    });

    if (withStatus && year && weekNum) {
      return NextResponse.json(users.map((u: any) => ({
        id: u.id, name: u.name, role: u.role, teamId: u.teamId,
        hasReport: u.reports?.length > 0,
        lastUpdated: u.reports?.[0]?.updatedAt || null
      })));
    }
    return NextResponse.json(users);
  } catch (error) {
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { name, teamId, requestUserId } = await request.json();
    if (!name?.trim()) return NextResponse.json({ error: '이름을 입력해주세요.' }, { status: 400 });
    if (!teamId) return NextResponse.json({ error: '팀을 선택해주세요.' }, { status: 400 });
    if (!await requireTeamMaster(requestUserId, teamId)) return NextResponse.json({ error: '권한이 필요합니다.' }, { status: 403 });
    const newUser = await prisma.user.create({ data: { name: name.trim(), teamId } });
    return NextResponse.json(newUser);
  } catch (error: any) {
    if (error.code === 'P2002') return NextResponse.json({ error: '같은 팀에 동일한 이름이 있습니다.' }, { status: 400 });
    return NextResponse.json({ error: '생성 실패' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = parseInt(searchParams.get('id') || '0');
    const requestUserId = parseInt(searchParams.get('requestUserId') || '0');

    const target = await prisma.user.findUnique({ where: { id } });
    if (!target) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (!await requireTeamMaster(requestUserId, target.teamId)) return NextResponse.json({ error: '권한이 필요합니다.' }, { status: 403 });

    await prisma.user.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const { targetUserId, role, requestUserId, resetPassword } = await request.json();

    const target = await prisma.user.findUnique({ where: { id: targetUserId } });
    if (!target) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    // 비밀번호 초기화
    if (resetPassword) {
      if (!await requireTeamMaster(requestUserId, target.teamId)) return NextResponse.json({ error: '권한이 필요합니다.' }, { status: 403 });
      const hashed = await bcrypt.hash('0000', 10);
      await prisma.user.update({ where: { id: targetUserId }, data: { password: hashed, mustChangePw: true } });
      return NextResponse.json({ success: true });
    }

    // 역할 변경
    if (typeof role === 'string') {
      // superAdmin 설정은 superAdmin만 가능
      if (role === 'superAdmin') {
        if (!await requireSuperAdmin(requestUserId)) return NextResponse.json({ error: '최고관리자만 가능합니다.' }, { status: 403 });
      } else {
        if (!await requireTeamMaster(requestUserId, target.teamId)) return NextResponse.json({ error: '권한이 필요합니다.' }, { status: 403 });
      }
      // 자기 자신의 권한 해제 방지
      if (requestUserId === targetUserId && target.role !== 'user' && role === 'user') {
        return NextResponse.json({ error: '본인의 권한은 해제할 수 없습니다.' }, { status: 400 });
      }
      await prisma.user.update({ where: { id: targetUserId }, data: { role } });
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: '변경할 내용이 없습니다.' }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: '실패' }, { status: 500 });
  }
}
