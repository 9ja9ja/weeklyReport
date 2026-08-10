import { describe, it, expect } from 'vitest';
import { parseCollabFrom, isBriefCollabWeek } from './briefCutover';

describe('요약본 컷오버 스위치', () => {
  it('미설정이면 공동 편집이 꺼져 있다 (안전 기본값)', () => {
    for (const raw of [undefined, null, '', '   ']) {
      expect(parseCollabFrom(raw)).toBeNull();
      expect(isBriefCollabWeek(2026, 33, raw)).toBe(false);
    }
  });

  it('형식이 어긋나면 켜지지 않는다', () => {
    // 잘못 적은 값이 "전부 켜짐"으로 해석되면 파일럿 범위가 통째로 새어나간다
    for (const raw of ['2026', 'W33', '2026-33', '26-W33', '2026-W0', '2026-W54', 'abc']) {
      expect(parseCollabFrom(raw)).toBeNull();
      expect(isBriefCollabWeek(2026, 40, raw)).toBe(false);
    }
  });

  it('시작 주차 이후만 대상이다', () => {
    const from = '2026-W33';
    expect(isBriefCollabWeek(2026, 32, from)).toBe(false);
    expect(isBriefCollabWeek(2026, 33, from)).toBe(true);
    expect(isBriefCollabWeek(2026, 34, from)).toBe(true);
  });

  it('연도 경계를 주차 숫자만으로 비교하지 않는다', () => {
    const from = '2026-W33';
    // 2027년 1주차는 2026년 33주차보다 뒤다 — 숫자만 보면 틀린다
    expect(isBriefCollabWeek(2027, 1, from)).toBe(true);
    expect(isBriefCollabWeek(2025, 52, from)).toBe(false);
  });

  it('대소문자·공백을 허용한다', () => {
    expect(isBriefCollabWeek(2026, 33, ' 2026-w33 ')).toBe(true);
    expect(parseCollabFrom('2026-w7')).toEqual({ year: 2026, weekNum: 7 });
  });
});
