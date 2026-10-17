import { describe, expect, it } from 'vitest';
import { formatSize, renderReportMail, reportMailSubject } from './briefReportTemplate';

const base = {
  year: 2026,
  weekNum: 42,
  baseDate: new Date(2026, 9, 16),
  link: 'https://example.test/brief',
  attachments: []
};

describe('renderReportMail', () => {
  it('모든 팀이 작성완료면 정상 배너를 쓴다', () => {
    const html = renderReportMail({
      ...base,
      teams: [{ name: 'A팀', checked: true, checkedByName: '홍', checkedAt: new Date(2026, 9, 16, 17, 10), attachmentCount: 0 }]
    });
    expect(html).toContain('[정상] 1팀 모두 작성완료');
    expect(html).toContain('기준일 : 2026.10.16');
  });

  it('미작성 팀이 있으면 팀 이름을 배너에 보여준다', () => {
    const html = renderReportMail({
      ...base,
      teams: [
        { name: 'A팀', checked: true, checkedByName: null, checkedAt: null, attachmentCount: 0 },
        { name: 'B팀', checked: false, checkedByName: null, checkedAt: null, attachmentCount: 0 }
      ]
    });
    expect(html).toContain('작성완료 1/2팀');
    expect(html).toContain('미작성: B팀');
  });

  it('사용자가 입력한 이름·파일명은 escape 한다', () => {
    const html = renderReportMail({
      ...base,
      teams: [{ name: '<b>팀</b>', checked: true, checkedByName: '"홍"', checkedAt: null, attachmentCount: 1 }],
      attachments: [{ fileName: '<script>x</script>.docx', size: 10, teamName: 'A&B' }]
    });
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<b>팀</b>');
    expect(html).toContain('&lt;script&gt;x&lt;/script&gt;.docx');
    expect(html).toContain('A&amp;B');
  });
});

describe('메일 제목·크기 표기', () => {
  it('제목에 연도와 주차가 들어간다', () => {
    expect(reportMailSubject(2026, 42)).toBe('2026년 42주차 비즈니스플랫폼 본부 주간보고 취합본 보고드립니다.');
  });

  it('크기를 B/KB/MB 로 줄여 쓴다', () => {
    expect(formatSize(500)).toBe('500B');
    expect(formatSize(33 * 1024)).toBe('33KB');
    expect(formatSize(1.5 * 1024 * 1024)).toBe('1.5MB');
  });
});
