/**
 * 주간보고 취합본 보고메일 본문(HTML).
 *
 * 메일 클라이언트는 외부 CSS 와 최신 레이아웃을 믿을 수 없어 테이블 + 인라인 스타일로 만든다.
 * 이름·파일명은 사용자가 입력한 값이라 전부 escape 한다.
 */
export interface ReportMailTeam {
  name: string;
  checked: boolean;
  checkedByName: string | null;
  checkedAt: Date | null;
  attachmentCount: number;
}

export interface ReportMailAttachment { fileName: string; size: number; teamName: string }

export interface ReportMailInput {
  year: number;
  weekNum: number;
  /** 기준일(해당 주 금요일) */
  baseDate: Date;
  teams: ReportMailTeam[];
  attachments: ReportMailAttachment[];
  /** 요약본 전체 보기 링크 */
  link: string;
}

const esc = (v: string) =>
  v.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

const p2 = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}.${p2(d.getMonth() + 1)}.${p2(d.getDate())}`;
const mdhm = (d: Date) => `${p2(d.getMonth() + 1)}/${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`;

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

export function reportMailSubject(year: number, weekNum: number): string {
  return `${year}년 ${weekNum}주차 비즈니스플랫폼 본부 주간보고 취합본 보고드립니다.`;
}

export function renderReportMail(input: ReportMailInput): string {
  const { teams, attachments } = input;
  const done = teams.filter(t => t.checked).length;
  const pending = teams.filter(t => !t.checked);
  const allDone = pending.length === 0;

  const banner = allDone
    ? `<div style="background:#f0fdf4;border:1px solid #bbf7d0;color:#166534;border-radius:6px;padding:12px 16px;font-weight:700">[정상] ${teams.length}팀 모두 작성완료</div>`
    : `<div style="background:#fffbeb;border:1px solid #fcd34d;color:#92400e;border-radius:6px;padding:12px 16px;font-weight:700">[확인] 작성완료 ${done}/${teams.length}팀 — 미작성: ${esc(pending.map(t => t.name).join(', '))}</div>`;

  const th = 'padding:10px 8px;text-align:left;border-top:1px solid #333;border-bottom:1px solid #ddd;background:#fafafa;font-size:13px';
  const td = 'padding:10px 8px;border-bottom:1px solid #eee;font-size:13px';

  const teamRows = teams.map(t => `
      <tr>
        <td style="${td}">${esc(t.name)}</td>
        <td style="${td};font-weight:700;color:${t.checked ? '#16a34a' : '#94a3b8'}">${t.checked ? '작성완료' : '미작성'}</td>
        <td style="${td};color:#555">${t.checked ? esc([t.checkedByName, t.checkedAt ? mdhm(t.checkedAt) : ''].filter(Boolean).join(' · ')) : '-'}</td>
        <td style="${td};text-align:right">${t.attachmentCount || '-'}</td>
      </tr>`).join('');

  const fileRows = attachments.length
    ? attachments.map(a => `
      <tr>
        <td style="${td}">${esc(a.fileName)}</td>
        <td style="${td};color:#555">${esc(a.teamName)}</td>
        <td style="${td};text-align:right;color:#555">${formatSize(a.size)}</td>
      </tr>`).join('')
    : `<tr><td colspan="3" style="${td};color:#94a3b8">첨부파일 없음</td></tr>`;

  return `<!DOCTYPE html>
<html lang="ko"><head><meta charset="utf-8"></head>
<body style="margin:0;padding:24px;background:#fff;font-family:'Malgun Gothic','맑은 고딕','Apple SD Gothic Neo',Arial,sans-serif;color:#222">
  <div style="max-width:760px">
    <h2 style="margin:0 0 16px;font-size:20px">기준일 : ${ymd(input.baseDate)}</h2>
    ${banner}

    <h3 style="margin:28px 0 8px;font-size:15px">※ 팀별 작성 현황 (${input.year}년 ${input.weekNum}주차)</h3>
    <table style="border-collapse:collapse;width:100%">
      <tr><th style="${th}">팀</th><th style="${th}">상태</th><th style="${th}">확인자</th><th style="${th};text-align:right">첨부</th></tr>${teamRows}
    </table>

    <h3 style="margin:28px 0 8px;font-size:15px">※ 첨부파일 (${attachments.length}건)</h3>
    <table style="border-collapse:collapse;width:100%">
      <tr><th style="${th}">파일명</th><th style="${th}">팀</th><th style="${th};text-align:right">크기</th></tr>${fileRows}
    </table>

    <p style="margin:28px 0 0">
      <a href="${esc(input.link)}" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;padding:10px 20px;border-radius:6px;font-weight:700;font-size:14px">요약본 전체 보기</a>
    </p>
  </div>
</body></html>`;
}
