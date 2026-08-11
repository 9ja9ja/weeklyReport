/**
 * 붙여넣기 색 정리.
 *
 * 다크모드 워드에서 복사하면 글자색이 흰색으로 박혀 들어와 밝은 화면에서 아예 안 보인다.
 * 반대로 검정으로 고쳐 저장하면 다크모드에서 안 보인다. 둘 다 "그 사람 편집기의 테마"일 뿐이라
 * 내용으로 저장하면 안 된다. 의도한 강조색(빨강·파랑)은 반드시 남아야 한다.
 */
import { describe, it, expect } from 'vitest';
import { stripThemeColors, isThemeArtifactColor, shouldIgnoreColor } from '@/lib/briefColors';

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

/**
 * 운영 요약본(2026년 33주차)에 실제로 저장돼 있던 값들.
 *
 * 여기서 명도만 보면 **의도한 빨강이 먼저 지워진다** — 워드 기본 글자색 #262626(0.149)보다
 * 짙은 빨강 #C00000(0.160)이 오히려 밝다. 그래서 무채색인지를 먼저 본다.
 */
describe('실제 문서에서 온 색 판정', () => {
  it('워드 기본 본문색은 검정이 아니어도 테마 흔적으로 본다', () => {
    for (const c of ['#262626', '#333333', '#404040', 'rgb(38, 38, 38)']) {
      expect(isThemeArtifactColor(c, false)).toBe(true);
    }
  });

  it('의도해서 고른 색은 더 어두워도 남긴다', () => {
    for (const c of ['#C00000', '#0070C0', '#dc2626', '#166534']) {
      expect(isThemeArtifactColor(c, false)).toBe(false);
    }
  });

  it('한쪽 테마에서 사라지는 밝은 회색 글자도 걷어낸다', () => {
    expect(isThemeArtifactColor('#e8e8e8', false)).toBe(true);
    // 중간 회색은 어느 쪽에서도 읽히므로 그대로 둔다
    expect(isThemeArtifactColor('#808080', false)).toBe(false);
  });

  it('표 머리의 연회색 배경은 일부러 칠한 것이라 남긴다', () => {
    expect(isThemeArtifactColor('rgb(242, 242, 242)', true)).toBe(false);
    expect(isThemeArtifactColor('rgb(233, 240, 246)', true)).toBe(false);
    // 사실상 흰색·검정만 배경에서 걷어낸다
    expect(isThemeArtifactColor('#ffffff', true)).toBe(true);
    expect(isThemeArtifactColor('#000000', true)).toBe(true);
  });
});

describe('화면에서 색을 무시할지 판단', () => {
  it('테마 흔적이면 무시한다', () => {
    expect(shouldIgnoreColor('#262626')).toBe(true);
  });

  it('형광펜이 칠해진 글자는 건드리지 않는다', () => {
    // 노란 형광펜 위의 검정 글씨를 밝은 테마색으로 바꾸면 오히려 안 보인다
    expect(shouldIgnoreColor('#262626', { highlighted: true })).toBe(false);
  });

  it('배경을 칠한 칸 안의 글자도 건드리지 않는다', () => {
    expect(shouldIgnoreColor('#262626', { onFilledCell: true })).toBe(false);
  });

  it('색이 없으면 판단할 것도 없다', () => {
    expect(shouldIgnoreColor(null)).toBe(false);
    expect(shouldIgnoreColor(undefined)).toBe(false);
    expect(shouldIgnoreColor('  ')).toBe(false);
  });
});
