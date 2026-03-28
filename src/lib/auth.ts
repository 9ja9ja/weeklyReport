import { prisma } from './db';

export async function getUserWithTeam(userId: number) {
  return prisma.user.findUnique({
    where: { id: userId },
    include: { team: true }
  });
}

/** superAdmin 또는 해당 팀의 teamMaster인지 확인 */
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

/** 해당 팀 소속 또는 superAdmin인지 확인 */
export async function requireTeamAccess(requestUserId: number, teamId: number): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: requestUserId } });
  if (!user) return false;
  if (user.role === 'superAdmin') return true;
  return user.teamId === teamId;
}
