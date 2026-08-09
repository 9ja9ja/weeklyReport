import { NextResponse } from 'next/server';
import { prisma } from './db';
import { getSessionUserId } from './session';

/**
 * 요청자의 신원 — 세션 쿠키에서만 읽는다.
 *
 * 아래 require* 함수들의 첫 인자에는 반드시 이 값을 넘겨야 한다.
 * 클라이언트가 body/query 로 보낸 requestUserId 를 넘기면 위조가 가능해진다.
 */
export async function currentUserId(): Promise<number | null> {
  return getSessionUserId();
}

export const unauthorized = () =>
  NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });

export const forbidden = (msg = '권한이 필요합니다.') =>
  NextResponse.json({ error: msg }, { status: 403 });

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

/** superAdmin 또는 해당 팀의 teamMaster인지 확인 (주 소속 팀 + 겸직 팀 모두 포함) */
export async function requireTeamMaster(requestUserId: number, teamId: number): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: requestUserId } });
  if (!user || !user.isActive) return false;
  if (user.role === 'superAdmin') return true;
  if (user.role !== 'teamMaster') return false;
  if (user.teamId === teamId) return true;

  const link = await prisma.userTeam.findUnique({
    where: { userId_teamId: { userId: requestUserId, teamId } }
  });
  return !!link;
}

/** superAdmin인지 확인 */
export async function requireSuperAdmin(requestUserId: number): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: requestUserId } });
  return !!user?.isActive && user.role === 'superAdmin';
}

/**
 * 전체 취합본(모든 팀) 조회 권한 — 로그인한 직원이면 누구나 조회할 수 있다.
 * (임원 role 은 "조회 전용" 계정을 뜻할 뿐, 조회 자체를 제한하지 않는다)
 */
export async function requireOverviewAccess(requestUserId: number): Promise<boolean> {
  if (!requestUserId) return false;
  const user = await prisma.user.findUnique({ where: { id: requestUserId }, select: { isActive: true } });
  return !!user?.isActive;
}

/** 해당 팀 소속(겸직 포함) 또는 superAdmin인지 확인 */
export async function requireTeamAccess(requestUserId: number, teamId: number): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: requestUserId } });
  if (!user || !user.isActive) return false;
  if (user.role === 'superAdmin') return true;
  if (user.teamId === teamId) return true;

  const link = await prisma.userTeam.findUnique({
    where: { userId_teamId: { userId: requestUserId, teamId } }
  });
  return !!link;
}

/** teamMaster 이상(teamMaster | superAdmin) 여부 확인 */
export async function requireMasterOrAbove(requestUserId: number): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: requestUserId }, select: { role: true, isActive: true } });
  if (!user?.isActive) return false;
  return user.role === 'superAdmin' || user.role === 'teamMaster';
}

/** 파트가 속한 팀 기준으로 마스터 권한 확인 */
export async function requirePartMaster(requestUserId: number, partId: number): Promise<boolean> {
  const part = await prisma.part.findUnique({ where: { id: partId }, select: { teamId: true } });
  if (!part) return false;
  return requireTeamMaster(requestUserId, part.teamId);
}

/**
 * 팀 소속(겸직 포함)이면서 작성 권한이 있는 사람 — 대분류 관리처럼 팀원 전체에 연 편집 기능용.
 *
 * requireTeamAccess 와 달리 role 을 본다. User.teamId 가 필수 컬럼이라 임원 계정도 반드시 어느 팀엔가
 * 속하므로, 소속만 확인하면 "조회 전용"이어야 할 임원이 분류를 고칠 수 있게 된다.
 */
export async function requireTeamEditor(requestUserId: number, teamId: number): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: requestUserId } });
  if (!user || !user.isActive) return false;
  if (user.role === 'executive') return false;
  if (user.role === 'superAdmin') return true;
  if (user.teamId === teamId) return true;

  const link = await prisma.userTeam.findUnique({
    where: { userId_teamId: { userId: requestUserId, teamId } }
  });
  return !!link;
}

/** 파트가 속한 팀 기준으로 requireTeamEditor 확인 */
export async function requirePartEditor(requestUserId: number, partId: number): Promise<boolean> {
  const part = await prisma.part.findUnique({ where: { id: partId }, select: { teamId: true } });
  if (!part) return false;
  return requireTeamEditor(requestUserId, part.teamId);
}
