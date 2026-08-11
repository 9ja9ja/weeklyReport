import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireTeamMaster, requireSuperAdmin, currentUserId, unauthorized } from '@/lib/auth';
import { compareMembers } from '@/lib/roles';
import bcrypt from 'bcryptjs';

export async function GET(request: Request) {
  try {
    const me = await currentUserId();
    if (!me) return unauthorized();
    const { searchParams } = new URL(request.url);
    const teamId = parseInt(searchParams.get('teamId') || '0');
    const withStatus = searchParams.get('withStatus') === 'true';
    const year = parseInt(searchParams.get('year') || '0');
    const weekNum = parseInt(searchParams.get('weekNum') || '0');

    // teamId 지정 시 겸직 인원까지 포함해서 조회
    const where = teamId ? { userTeams: { some: { teamId } } } : {};

    const rows = await prisma.user.findMany({
      where,
      orderBy: { name: 'asc' },
      select: {
        id: true, name: true, role: true, teamId: true, position: true,
        mustChangePw: true, isActive: true, createdAt: true,
        userTeams: { select: { teamId: true, isPrimary: true, orderIdx: true } },
        ...(withStatus && year && weekNum ? {
          reports: { where: { year, weekNum }, select: { id: true, updatedAt: true } }
        } : {})
      }
    });

    // 팀 안 표시 순서 — 손으로 정한 순서 > 직책(팀장·부팀장) > 이름.
    // 순서는 팀마다 따로라(UserTeam) 겸직자가 있어도 다른 팀 순서를 흔들지 않는다.
    const membership = (u: (typeof rows)[number]) => u.userTeams.find(t => t.teamId === teamId);
    const ordered = (u: (typeof rows)[number]) => {
      const m = membership(u);
      return { isPrimary: !!m?.isPrimary, orderIdx: m?.orderIdx ?? 999, position: u.position, name: u.name };
    };
    const users = teamId
      ? [...rows].sort((a, b) => compareMembers(ordered(a), ordered(b)))
      : rows;

    if (withStatus && year && weekNum) {
      return NextResponse.json(users.map(u => ({
        id: u.id, name: u.name, role: u.role, teamId: u.teamId, position: u.position,
        isPrimary: teamId ? u.userTeams.some(t => t.teamId === teamId && t.isPrimary) : true,
        hasReport: (u as typeof u & { reports?: unknown[] }).reports?.length ? true : false,
        lastUpdated: (u as typeof u & { reports?: { updatedAt: Date }[] }).reports?.[0]?.updatedAt || null
      })));
    }

    return NextResponse.json(users.map(u => ({
      id: u.id, name: u.name, role: u.role, teamId: u.teamId, position: u.position,
      mustChangePw: u.mustChangePw, isActive: u.isActive, createdAt: u.createdAt,
      teamIds: u.userTeams.map(t => t.teamId),
      isPrimary: teamId ? u.userTeams.some(t => t.teamId === teamId && t.isPrimary) : true
    })));
  } catch (error) {
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const me = await currentUserId();
    if (!me) return unauthorized();
    const { name, teamId, position } = await request.json();
    if (!name?.trim()) return NextResponse.json({ error: '이름을 입력해주세요.' }, { status: 400 });
    if (!teamId) return NextResponse.json({ error: '팀을 선택해주세요.' }, { status: 400 });
    if (!await requireTeamMaster(me, teamId)) return NextResponse.json({ error: '권한이 필요합니다.' }, { status: 403 });

    const newUser = await prisma.user.create({
      data: {
        name: name.trim(),
        teamId,
        position: (position || '').trim(),
        userTeams: { create: { teamId, isPrimary: true } }
      }
    });
    return NextResponse.json(newUser);
  } catch (error) {
    if ((error as { code?: string }).code === 'P2002') {
      return NextResponse.json({ error: '같은 팀에 동일한 이름이 있습니다.' }, { status: 400 });
    }
    return NextResponse.json({ error: '생성 실패' }, { status: 500 });
  }
}

/**
 * 겸직 추가/해제 — PUT /api/users  { targetUserId, teamId, action: 'add'|'remove' }
 * 팀 안 순서 변경 — PUT /api/users  { teamId, userIds: [...] }  (화면에 보이는 순서 그대로)
 */
export async function PUT(request: Request) {
  try {
    const me = await currentUserId();
    if (!me) return unauthorized();
    const { targetUserId, teamId, action, userIds } = await request.json();

    // 순서 변경 — 화면이 보내온 순서대로 다시 번호를 매긴다(파트·분류 순서와 같은 방식)
    if (Array.isArray(userIds)) {
      if (!teamId) return NextResponse.json({ error: '팀을 지정해주세요.' }, { status: 400 });
      if (!await requireTeamMaster(me, teamId)) return NextResponse.json({ error: '권한이 필요합니다.' }, { status: 403 });
      if (!userIds.every(Number.isInteger)) return NextResponse.json({ error: '순서가 올바르지 않습니다.' }, { status: 400 });
      // 이 팀 소속이 아닌 id 가 섞여 오면 다른 팀의 순서를 건드리게 된다
      const members = await prisma.userTeam.findMany({ where: { teamId }, select: { userId: true } });
      const allowed = new Set(members.map(m => m.userId));
      if (!userIds.every((id: number) => allowed.has(id))) {
        return NextResponse.json({ error: '이 팀 소속이 아닌 인원이 포함되어 있습니다.' }, { status: 400 });
      }
      await prisma.$transaction(
        userIds.map((id: number, idx: number) =>
          prisma.userTeam.update({ where: { userId_teamId: { userId: id, teamId } }, data: { orderIdx: idx } })
        )
      );
      return NextResponse.json({ success: true });
    }

    if (!targetUserId || !teamId) return NextResponse.json({ error: '입력값을 확인해주세요.' }, { status: 400 });
    if (!await requireTeamMaster(me, teamId)) return NextResponse.json({ error: '권한이 필요합니다.' }, { status: 403 });

    const target = await prisma.user.findUnique({ where: { id: targetUserId } });
    if (!target) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    if (action === 'remove') {
      if (target.teamId === teamId) {
        return NextResponse.json({ error: '주 소속 팀은 해제할 수 없습니다.' }, { status: 400 });
      }
      await prisma.userTeam.deleteMany({ where: { userId: targetUserId, teamId } });
      return NextResponse.json({ success: true });
    }

    await prisma.userTeam.upsert({
      where: { userId_teamId: { userId: targetUserId, teamId } },
      update: {},
      create: { userId: targetUserId, teamId, isPrimary: false }
    });
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: '실패' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const me = await currentUserId();
    if (!me) return unauthorized();
    const { searchParams } = new URL(request.url);
    const id = parseInt(searchParams.get('id') || '0');

    const target = await prisma.user.findUnique({ where: { id } });
    if (!target) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (!await requireTeamMaster(me, target.teamId)) return NextResponse.json({ error: '권한이 필요합니다.' }, { status: 403 });

    await prisma.user.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const me = await currentUserId();
    if (!me) return unauthorized();
    const { targetUserId, role, position, resetPassword } = await request.json();

    const target = await prisma.user.findUnique({ where: { id: targetUserId } });
    if (!target) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    // 비밀번호 초기화
    if (resetPassword) {
      if (!await requireTeamMaster(me, target.teamId)) return NextResponse.json({ error: '권한이 필요합니다.' }, { status: 403 });
      const hashed = await bcrypt.hash('0000', 10);
      await prisma.user.update({ where: { id: targetUserId }, data: { password: hashed, mustChangePw: true } });
      return NextResponse.json({ success: true });
    }

    // 역할 변경
    if (typeof role === 'string') {
      // superAdmin / executive 설정은 superAdmin만 가능
      if (role === 'superAdmin' || role === 'executive') {
        if (!await requireSuperAdmin(me)) return NextResponse.json({ error: '최고관리자만 가능합니다.' }, { status: 403 });
      } else {
        if (!await requireTeamMaster(me, target.teamId)) return NextResponse.json({ error: '권한이 필요합니다.' }, { status: 403 });
      }
      // 자기 자신의 권한 해제 방지
      if (me === targetUserId && target.role !== 'user' && role === 'user') {
        return NextResponse.json({ error: '본인의 권한은 해제할 수 없습니다.' }, { status: 400 });
      }
      await prisma.user.update({ where: { id: targetUserId }, data: { role } });
      return NextResponse.json({ success: true });
    }

    // 직급 — 임원 계정은 이 값이 곧 화면 호칭이 된다(대표 등). 그래서 임원·최고관리자
    // 대상의 직급은 최고관리자만 바꾼다. 나머지는 소속 팀 관리자면 된다.
    if (typeof position === 'string') {
      const privileged = target.role === 'superAdmin' || target.role === 'executive';
      const ok = privileged ? await requireSuperAdmin(me) : await requireTeamMaster(me, target.teamId);
      if (!ok) return NextResponse.json({ error: '권한이 필요합니다.' }, { status: 403 });
      const v = position.trim();
      if (v.length > 20) return NextResponse.json({ error: '직급은 20자 이내로 입력해주세요.' }, { status: 400 });
      await prisma.user.update({ where: { id: targetUserId }, data: { position: v } });
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: '변경할 내용이 없습니다.' }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: '실패' }, { status: 500 });
  }
}
