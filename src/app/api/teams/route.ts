import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireSuperAdmin, currentUserId, unauthorized } from '@/lib/auth';
import { getPrevWeek, getIsoWeek } from '@/lib/weekUtils';
import { COLLAB_WRITE_READY } from '@/lib/realtime/collabReady';
import { isCollabWeek } from '@/lib/collabWeek';
import { currentEnvironment } from '@/lib/realtime/persist';

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
            // 팀 안 표시 순서 — 지정한 순서(직급 순 등)가 먼저, 지정 없는 사람은 이름순
            orderBy: [{ isPrimary: 'desc' }, { orderIdx: 'asc' }, { user: { name: 'asc' } }],
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

      // 공동 편집 주차는 개인 Report 가 없다. 작성 여부는 실제 편집 이력(DocActivity)으로 본다 —
      // 이월 시드만으로 "작성함"이 되지 않도록 편집 이벤트를 따로 기록해 둔 값이다.
      const env = currentEnvironment();
      const collabTeamIds = teams
        .filter(t => isCollabWeek(t, year, weekNum) || isCollabWeek(t, prev.year, prev.weekNum))
        .map(t => t.id);
      const activities = collabTeamIds.length
        ? await prisma.docActivity.findMany({
            where: {
              environment: env,
              teamId: { in: collabTeamIds },
              OR: [{ year, weekNum }, { year: prev.year, weekNum: prev.weekNum }]
            },
            select: { teamId: true, userId: true, year: true, weekNum: true, lastEditedAt: true }
          })
        : [];
      const actKey = (t: number, u: number, y: number, w: number) => `${t}:${u}:${y}:${w}`;
      const actMap = new Map(activities.map(a => [actKey(a.teamId, a.userId, a.year, a.weekNum), a]));

      const result = teams.map(team => ({
        id: team.id,
        name: team.name,
        division: team.division,
        prevWeekNum: prev.weekNum,
        users: team.userTeams.map(ut => {
          const curCollab = isCollabWeek(team, year, weekNum);
          const preCollab = isCollabWeek(team, prev.year, prev.weekNum);
          const curAct = actMap.get(actKey(team.id, ut.user.id, year, weekNum));
          const preAct = actMap.get(actKey(team.id, ut.user.id, prev.year, prev.weekNum));
          const cur = ut.user.reports.find(r => r.year === year && r.weekNum === weekNum);
          const pre = ut.user.reports.find(r => r.year === prev.year && r.weekNum === prev.weekNum);
          return {
            id: ut.user.id,
            name: ut.user.name,
            role: ut.user.role,
            teamId: ut.user.teamId,
            position: ut.user.position,
            isPrimary: ut.isPrimary,
            hasReport: curCollab ? !!curAct?.lastEditedAt : !!cur,
            prevHasReport: preCollab ? !!preAct?.lastEditedAt : !!pre,
            lastUpdated: (curCollab ? curAct?.lastEditedAt : cur?.updatedAt) || null
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
        collabFromYear: t.collabFromYear,
        collabFromWeek: t.collabFromWeek,
        collabUntilYear: t.collabUntilYear,
        collabUntilWeek: t.collabUntilWeek,
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
    const { id, newName, division, collab } = await request.json();
    if (!await requireSuperAdmin(me)) return NextResponse.json({ error: '최고관리자 권한이 필요합니다.' }, { status: 403 });

    const data: {
      name?: string; division?: string;
      collabFromYear?: number | null; collabFromWeek?: number | null;
      collabUntilYear?: number | null; collabUntilWeek?: number | null;
    } = {};
    if (newName?.trim()) data.name = newName.trim();
    if (typeof division === 'string') data.division = division.trim();

    // 실시간 공동 편집 켜기/끄기 — 적용 시점은 서버가 정한다.
    // 클라이언트가 주차를 지정하게 두면 지난 주차를 임의로 공동 편집으로 바꿔
    // 확정된 취합본이 재생성 대상이 될 수 있다.
    if (collab === true || collab === false) {
      // 끄기는 항상 허용한다. 잘못 켠 상태에서 빠져나올 길까지 막으면 안 된다.
      if (collab && !COLLAB_WRITE_READY) {
        return NextResponse.json(
          { error: '주간보고 작성 화면이 아직 공동 편집으로 바뀌지 않았습니다. 지금 켜면 팀원이 저장할 수 없습니다.' },
          { status: 409 }
        );
      }
      // 달력 연도가 아니라 **주차가 속한 해**를 쓴다. 1/1 이 전년도 53주차인 해에
      // 달력 연도를 붙이면 존재하지 않는 주차(2027-W53)가 저장돼, 그 팀이 한 해 내내
      // 공동 편집으로 판정되지 않는다.
      const now = new Date();
      const cur = getIsoWeek(now);
      const team = await prisma.team.findUnique({
        where: { id },
        select: { collabFromYear: true, collabFromWeek: true }
      });
      if (!team) return NextResponse.json({ error: '팀을 찾을 수 없습니다.' }, { status: 404 });

      if (collab) {
        // 이번 주차부터 적용. 이미 시작 주차가 있으면 그대로 두고 종료만 해제한다 —
        // 시작점을 뒤로 밀면 그 사이 함께 작성한 주차가 기존 방식으로 되돌아간다.
        data.collabFromYear = team.collabFromYear ?? cur.year;
        data.collabFromWeek = team.collabFromWeek ?? cur.weekNum;
        data.collabUntilYear = null;
        data.collabUntilWeek = null;
      } else {
        // 지난 주차까지는 공동 편집으로 남긴다. 이번 주차부터 기존 방식.
        const prev = getPrevWeek(cur.year, cur.weekNum);
        data.collabUntilYear = prev.year;
        data.collabUntilWeek = prev.weekNum;
      }
    }

    if (Object.keys(data).length === 0) return NextResponse.json({ error: '변경할 내용이 없습니다.' }, { status: 400 });

    const updated = await prisma.team.update({
      where: { id },
      data,
      select: {
        id: true, name: true, division: true,
        collabFromYear: true, collabFromWeek: true,
        collabUntilYear: true, collabUntilWeek: true
      }
    });
    return NextResponse.json({ success: true, team: updated });
  } catch (error) {
    if ((error as { code?: string }).code === 'P2002') return NextResponse.json({ error: '이미 존재하는 팀 이름입니다.' }, { status: 400 });
    return NextResponse.json({ error: '수정 실패' }, { status: 500 });
  }
}
