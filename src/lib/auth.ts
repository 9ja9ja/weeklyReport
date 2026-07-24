import { prisma } from './db';

export async function getUserWithTeam(userId: number) {
  return prisma.user.findUnique({
    where: { id: userId },
    include: { team: true }
  });
}

/** 사용자가 속한 모든 팀 (주 소속 + 겸직). 주 소속이 앞에 온다. */
export async function getUserTeams(userId: number) {
  const links = await prisma.userTeam.findMany({
    where: { userId },
    include: { team: true },
    orderBy: [{ isPrimary: 'desc' }, { team: { orderIdx: 'asc' } }]
  });
  return links.map(l => ({
    id: l.team.id,
    name: l.team.name,
    division: l.team.division,
    isPrimary: l.isPrimary
  }));
}

/** superAdmin 또는 해당 팀의 teamMaster인지 확인 (팀 마스터 권한은 주 소속 팀에만 적용) */
export async function requireTeamMaster(requestUserId: number, teamId: number): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: requestUserId } });
  if (!user) return false;
  if (user.role === 'superAdmin') return true;
  return user.role === 'teamMaster' && user.teamId === teamId;
}

/** superAdmin인지 확인 */
export async function requireSuperAdmin(requestUserId: number): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: requestUserId } });
  return user?.role === 'superAdmin';
}

/**
 * 전체 취합본(모든 팀) 조회 권한 — 로그인한 직원이면 누구나 조회할 수 있다.
 * (임원 role 은 "조회 전용" 계정을 뜻할 뿐, 조회 자체를 제한하지 않는다)
 */
export async function requireOverviewAccess(requestUserId: number): Promise<boolean> {
  if (!requestUserId) return false;
  const user = await prisma.user.findUnique({ where: { id: requestUserId }, select: { id: true } });
  return !!user;
}

/** 해당 팀 소속(겸직 포함) 또는 superAdmin인지 확인 */
export async function requireTeamAccess(requestUserId: number, teamId: number): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: requestUserId } });
  if (!user) return false;
  if (user.role === 'superAdmin') return true;
  if (user.teamId === teamId) return true;

  const link = await prisma.userTeam.findUnique({
    where: { userId_teamId: { userId: requestUserId, teamId } }
  });
  return !!link;
}

/** 파트가 속한 팀 기준으로 마스터 권한 확인 */
export async function requirePartMaster(requestUserId: number, partId: number): Promise<boolean> {
  const part = await prisma.part.findUnique({ where: { id: partId }, select: { teamId: true } });
  if (!part) return false;
  return requireTeamMaster(requestUserId, part.teamId);
}
