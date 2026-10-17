import { prisma } from '@/lib/db';

/**
 * 요약본 우측 "팀별 작성 현황" — 각 팀의 관리자가 "우리 팀 내용을 요약본에 다 썼다"고
 * 직접 체크한 값이다. 작성 이력으로 자동 판정하지 않는다.
 * (요약본 한 문서를 여러 팀이 함께 쓰므로 누가 어느 팀 몫을 썼는지는 시스템이 알 수 없다.
 *  지금까지 메신저로 "끝났어요" 하던 것을 그대로 옮긴 것.)
 *
 * 체크 대상에서 제외된 조직(PMO·땡겨요·본부 그룹 행)은 Team.briefExcluded 로 뺀다.
 */
export interface TeamBriefAttachment {
  id: number;
  fileName: string;
  size: number;
  uploadedAt: Date;
  uploadedByName: string | null;
}

export interface TeamBriefCheck {
  teamId: number;
  teamName: string;
  checked: boolean;
  checkedAt: Date | null;
  checkedByName: string | null;
  attachments: TeamBriefAttachment[];
}

export interface BriefCheckSummary {
  teams: TeamBriefCheck[];
  total: number;
  checkedCount: number;
  attachmentCount: number;
}

/** 이 주차 보고메일이 실제로 발송됐는가 — 발송 후에는 첨부를 바꾸지 못하게 막는 기준 (dryrun 은 발송이 아니다) */
export async function briefMailSent(year: number, weekNum: number): Promise<boolean> {
  const n = await prisma.briefMailLog.count({ where: { year, weekNum, status: 'sent' } });
  return n > 0;
}

/** 체크 대상 팀 (제외 플래그가 꺼진 팀) */
export function briefCheckTeams() {
  return prisma.team.findMany({
    where: { briefExcluded: false },
    orderBy: { orderIdx: 'asc' },
    select: { id: true, name: true }
  });
}

export async function loadBriefTeamChecks(year: number, weekNum: number): Promise<BriefCheckSummary> {
  const teams = await briefCheckTeams();
  const checks = await prisma.briefTeamCheck.findMany({
    where: { year, weekNum, teamId: { in: teams.map(t => t.id) } }
  });
  const byTeam = new Map(checks.map(c => [c.teamId, c]));

  const files = await prisma.briefAttachment.findMany({
    where: { year, weekNum, teamId: { in: teams.map(t => t.id) } },
    orderBy: { uploadedAt: 'asc' }
  });

  const userIds = [...new Set([...checks.map(c => c.checkedBy), ...files.map(f => f.uploadedBy)])];
  const users = userIds.length
    ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })
    : [];
  const names = new Map(users.map(u => [u.id, u.name]));

  const rows: TeamBriefCheck[] = teams.map(t => {
    const c = byTeam.get(t.id);
    return {
      teamId: t.id,
      teamName: t.name,
      checked: !!c,
      checkedAt: c?.checkedAt ?? null,
      checkedByName: c ? names.get(c.checkedBy) ?? null : null,
      attachments: files.filter(f => f.teamId === t.id).map(f => ({
        id: f.id, fileName: f.fileName, size: f.size, uploadedAt: f.uploadedAt,
        uploadedByName: names.get(f.uploadedBy) ?? null
      }))
    };
  });

  return {
    teams: rows,
    total: rows.length,
    checkedCount: rows.filter(r => r.checked).length,
    attachmentCount: files.length
  };
}
