import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireSuperAdmin, currentUserId, unauthorized } from '@/lib/auth';
import { getPrevWeek } from '@/lib/weekUtils';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const withUsers = searchParams.get('withUsers') === 'true';
    const year = parseInt(searchParams.get('year') || '0');
    const weekNum = parseInt(searchParams.get('weekNum') || '0');

    if (withUsers && year && weekNum) {
      const prev = getPrevWeek(year, weekNum);
      // 모든 팀 + 소속(겸직 포함) + 금주/전주 작성현황을 한 번에 반환
      const teams = await prisma.team.findMany({
        orderBy: { orderIdx: 'asc' },
        include: {
          userTeams: {
            orderBy: [{ isPrimary: 'desc' }, { user: { name: 'asc' } }],
            include: {
              user: {
                select: {
                  id: true, name: true, role: true, teamId: true, position: true,
                  reports: {
                    where: { OR: [{ year, weekNum }, { year: prev.year, weekNum: prev.weekNum }] },
                    select: { year: true, weekNum: true, updatedAt: true }
                  }
                }
              }
            }
          }
        }
      });

      const result = teams.map(team => ({
        id: team.id,
        name: team.name,
        division: team.division,
        prevWeekNum: prev.weekNum,
        users: team.userTeams.map(ut => {
          const cur = ut.user.reports.find(r => r.year === year && r.weekNum === weekNum);
          const pre = ut.user.reports.find(r => r.year === prev.year && r.weekNum === prev.weekNum);
          return {
            id: ut.user.id,
            name: ut.user.name,
            role: ut.user.role,
            teamId: ut.user.teamId,
            position: ut.user.position,
            isPrimary: ut.isPrimary,
            hasReport: !!cur,
            prevHasReport: !!pre,
            lastUpdated: cur?.updatedAt || null
          };
        })
      }));
      return NextResponse.json(result);
    }

    const teams = await prisma.team.findMany({
      orderBy: { orderIdx: 'asc' },
      include: { _count: { select: { userTeams: true, parts: true } } }
    });
    return NextResponse.json(
      teams.map(t => ({
        id: t.id,
        name: t.name,
        division: t.division,
        orderIdx: t.orderIdx,
        createdAt: t.createdAt,
        _count: { users: t._count.userTeams, parts: t._count.parts }
      }))
    );
  } catch (error) {
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const me = await currentUserId();
    if (!me) return unauthorized();
    const { name, division } = await request.json();
    if (!name?.trim()) return NextResponse.json({ error: '팀 이름을 입력해주세요.' }, { status: 400 });
    if (!await requireSuperAdmin(me)) return NextResponse.json({ error: '최고관리자 권한이 필요합니다.' }, { status: 403 });

    const last = await prisma.team.findFirst({ orderBy: { orderIdx: 'desc' } });
    const team = await prisma.team.create({
      data: { name: name.trim(), division: (division || '').trim(), orderIdx: (last?.orderIdx ?? -1) + 1 }
    });
    return NextResponse.json(team);
  } catch (error) {
    if ((error as { code?: string }).code === 'P2002') return NextResponse.json({ error: '이미 존재하는 팀 이름입니다.' }, { status: 400 });
    return NextResponse.json({ error: '생성 실패' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const me = await currentUserId();
    if (!me) return unauthorized();
    const { searchParams } = new URL(request.url);
    const id = parseInt(searchParams.get('id') || '0');
    if (!await requireSuperAdmin(me)) return NextResponse.json({ error: '최고관리자 권한이 필요합니다.' }, { status: 403 });
    await prisma.team.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: '삭제 실패' }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const me = await currentUserId();
    if (!me) return unauthorized();
    const { id, newName, division } = await request.json();
    if (!await requireSuperAdmin(me)) return NextResponse.json({ error: '최고관리자 권한이 필요합니다.' }, { status: 403 });

    const data: { name?: string; division?: string } = {};
    if (newName?.trim()) data.name = newName.trim();
    if (typeof division === 'string') data.division = division.trim();
    if (Object.keys(data).length === 0) return NextResponse.json({ error: '변경할 내용이 없습니다.' }, { status: 400 });

    await prisma.team.update({ where: { id }, data });
    return NextResponse.json({ success: true });
  } catch (error) {
    if ((error as { code?: string }).code === 'P2002') return NextResponse.json({ error: '이미 존재하는 팀 이름입니다.' }, { status: 400 });
    return NextResponse.json({ error: '수정 실패' }, { status: 500 });
  }
}
