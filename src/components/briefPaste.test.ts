/**
 * 붙여넣기 색 정리.
 *
 * 다크모드 워드에서 복사하면 글자색이 흰색으로 박혀 들어와 밝은 화면에서 아예 안 보인다.
 * 반대로 검정으로 고쳐 저장하면 다크모드에서 안 보인다. 둘 다 "그 사람 편집기의 테마"일 뿐이라
 * 내용으로 저장하면 안 된다. 의도한 강조색(빨강·파랑)은 반드시 남아야 한다.
 */
import { describe, it, expect } from 'vitest';
import { stripThemeColors } from './BriefEditor';

describe('테마 색 제거', () => {
  it('흰 글자색을 걷어낸다 (다크모드 워드에서 복사)', () => {
    for (const c of ['#ffffff', '#FFFFFF', '#fff', 'white', 'rgb(255, 255, 255)', 'rgb(255,255,255)']) {
      const got = stripThemeColors(`<p><span style="color: ${c}">내용</span></p>`);
      expect(got).not.toMatch(/color/i);
      expect(got).toContain('내용');
    }
  });

  it('검정 글자색도 걷어낸다 (라이트모드 기본색)', () => {
    for (const c of ['#000000', '#000', 'black', 'rgb(0, 0, 0)', 'windowtext']) {
      expect(stripThemeColors(`<p><span style="color:${c}">내용</span></p>`)).not.toMatch(/color/i);
    }
  });

  it('의도한 강조색은 남긴다', () => {
    for (const c of ['#dc2626', '#2563eb', 'rgb(220, 38, 38)', '#f59e0b']) {
      const got = stripThemeColors(`<p><span style="color: ${c}">강조</span></p>`);
      expect(got).toContain(c);
    }
  });

  it('형광펜 같은 밝은 배경색도 테마 흔적이면 걷어낸다', () => {
    expect(stripThemeColors('<td style="background-color: #ffffff">칸</td>')).not.toMatch(/background/i);
    // 파스텔 강조는 유지
    expect(stripThemeColors('<td style="background-color: #fef08a">칸</td>')).toContain('#fef08a');
  });

  it('색이 아닌 선언은 그대로 둔다', () => {
    const got = stripThemeColors('<p style="text-align: center; color: #000000; margin-left: 24px">가운데</p>');
    expect(got).toContain('text-align: center');
    expect(got).toContain('margin-left: 24px');
    expect(got).not.toContain('#000000');
  });

  it('남는 선언이 없으면 style 속성 자체를 지운다', () => {
    expect(stripThemeColors('<p style="color: #000000">줄</p>')).toBe('<p>줄</p>');
  });

  it('해석할 수 없는 색은 건드리지 않는다', () => {
    const got = stripThemeColors('<p style="color: var(--foreground)">줄</p>');
    expect(got).toContain('var(--foreground)');
  });

  it('여러 요소를 한 번에 처리한다', () => {
    const html = '<p><span style="color:#ffffff">흰</span><span style="color:#dc2626">빨강</span></p>';
    const got = stripThemeColors(html);
    expect(got).toContain('흰');
    expect(got).toContain('#dc2626');
    expect(got).not.toMatch(/#ffffff/i);
  });
});
