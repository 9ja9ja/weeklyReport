import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { currentUserId, unauthorized, forbidden, requireOverviewAccess } from '@/lib/auth';
import { loadBriefTeamChecks, briefMailSent } from '@/lib/briefTeamStatus';

/**
 * 이 사람이 체크·해제(관리자)하거나 첨부를 올릴 수 있는(작성자) 팀 id.
 * 직급 텍스트는 보지 않는다 — 표기가 사람마다 달라 판정 근거로 쓰면 조용히 권한이 사라진다.
 *  - 체크: 최고관리자는 전 팀, 관리자(teamMaster)는 자기 팀(겸직 포함)
 *  - 첨부: 최고관리자는 전 팀, 임원 제외 소속(겸직 포함) 팀원 누구나 자기 팀
 */
async function teamPermissions(uid: number, allTeamIds: number[]) {
  const user = await prisma.user.findUnique({ where: { id: uid }, select: { role: true, isActive: true, teamId: true } });
  if (!user?.isActive) return { check: new Set<number>(), upload: new Set<number>() };
  if (user.role === 'superAdmin') return { check: new Set(allTeamIds), upload: new Set(allTeamIds) };

  const links = await prisma.userTeam.findMany({ where: { userId: uid }, select: { teamId: true } });
  const mine = allTeamIds.filter(id => id === user.teamId || links.some(l => l.teamId === id));
  return {
    check: new Set(user.role === 'teamMaster' ? mine : []),
    upload: new Set(user.role === 'executive' ? [] : mine)
  };
}

/** 요약본 우측 팀별 작성 현황 (작성완료 체크 + 팀별 첨부파일) */
export async function GET(req: NextRequest) {
  const uid = await currentUserId();
  if (!uid) return unauthorized();
  if (!(await requireOverviewAccess(uid))) return forbidden('조회 권한이 없습니다.');

  const year = parseInt(req.nextUrl.searchParams.get('year') || '');
  const weekNum = parseInt(req.nextUrl.searchParams.get('weekNum') || '');
  if (!year || !weekNum) return NextResponse.json({ error: '연도와 주차가 필요합니다.' }, { status: 400 });

  try {
    const summary = await loadBriefTeamChecks(year, weekNum);
    const perm = await teamPermissions(uid, summary.teams.map(t => t.teamId));
    return NextResponse.json({
      ...summary,
      // 보고메일이 나간 뒤에는 나간 파일과 달라지지 않도록 첨부 변경을 막는다
      attachmentsLocked: await briefMailSent(year, weekNum),
      teams: summary.teams.map(t => ({
        ...t,
        canEdit: perm.check.has(t.teamId),
        canUpload: perm.upload.has(t.teamId)
      }))
    });
  } catch {
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
