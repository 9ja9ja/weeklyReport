import { prisma } from '@/lib/db';
import { getWeekRange } from '@/lib/weekUtils';
import { loadBriefTeamChecks } from '@/lib/briefTeamStatus';
import { renderReportMail, reportMailSubject } from '@/lib/mail/briefReportTemplate';

/** 메일 하나에 붙일 수 있는 첨부 합계. 사내 메일 서버 한도보다 보수적으로 잡았다. */
export const MAX_MAIL_ATTACHMENT_BYTES = 20 * 1024 * 1024;

export interface PickedAttachment {
  id: number;
  fileName: string;
  size: number;
  mime: string;
  storageKey: string;
  teamName: string;
}

/**
 * 보고메일의 제목·본문과, 실제로 붙일 첨부를 한 번에 만든다.
 * 미리보기와 발송이 같은 함수를 거치므로 "보던 것과 나간 것이 다른" 일이 없다.
 * attachmentIds 가 가리키는 파일은 이 주차·체크 대상 팀의 것만 인정한다(남의 주차 파일 끼워넣기 방지).
 */
export async function buildBriefReport(year: number, weekNum: number, attachmentIds: number[], link: string) {
  const summary = await loadBriefTeamChecks(year, weekNum);
  const teamName = new Map(summary.teams.map(t => [t.teamId, t.teamName]));

  const rows = attachmentIds.length
    ? await prisma.briefAttachment.findMany({
        where: { id: { in: attachmentIds }, year, weekNum, teamId: { in: summary.teams.map(t => t.teamId) } },
        orderBy: [{ teamId: 'asc' }, { uploadedAt: 'asc' }]
      })
    : [];
  const attachments: PickedAttachment[] = rows.map(r => ({
    id: r.id, fileName: r.fileName, size: r.size, mime: r.mime, storageKey: r.storageKey,
    teamName: teamName.get(r.teamId) ?? ''
  }));

  const html = renderReportMail({
    year, weekNum,
    baseDate: getWeekRange(year, weekNum).friday,
    teams: summary.teams.map(t => ({
      name: t.teamName, checked: t.checked, checkedByName: t.checkedByName, checkedAt: t.checkedAt,
      attachmentCount: t.attachments.length
    })),
    attachments: attachments.map(a => ({ fileName: a.fileName, size: a.size, teamName: a.teamName })),
    link
  });

  return {
    subject: reportMailSubject(year, weekNum),
    html,
    attachments,
    totalSize: attachments.reduce((n, a) => n + a.size, 0),
    pendingTeams: summary.teams.filter(t => !t.checked).map(t => t.teamName)
  };
}
