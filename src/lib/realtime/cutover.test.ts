/**
 * 컷오버 판정 — 팀·주차 단위. DB 없이 순수 함수로 검증한다.
 *
 * 단일 boolean 플래그였다면 "언제부터"를 표현할 수 없어, 이미 공동 편집한 주차를
 * legacy 로 되돌리는 사고를 막지 못한다.
 */
import { describe, it, expect } from 'vitest';
import { isCollabWeek } from './persist';

const off = { collabFromYear: null, collabFromWeek: null };
const from2026w33 = { collabFromYear: 2026, collabFromWeek: 33 };

describe('isCollabWeek', () => {
  it('플래그가 없으면 항상 legacy', () => {
    expect(isCollabWeek(off, 2026, 32)).toBe(false);
    expect(isCollabWeek(off, 2030, 1)).toBe(false);
  });

  it('컷오버 주차 이전은 legacy', () => {
    expect(isCollabWeek(from2026w33, 2026, 32)).toBe(false);
    expect(isCollabWeek(from2026w33, 2026, 1)).toBe(false);
  });

  it('컷오버 주차부터 collab', () => {
    expect(isCollabWeek(from2026w33, 2026, 33)).toBe(true);
    expect(isCollabWeek(from2026w33, 2026, 40)).toBe(true);
  });

  it('이전 연도는 주차와 무관하게 legacy', () => {
    expect(isCollabWeek(from2026w33, 2025, 52)).toBe(false);
    expect(isCollabWeek(from2026w33, 2025, 1)).toBe(false);
  });

  it('이후 연도는 주차와 무관하게 collab', () => {
    expect(isCollabWeek(from2026w33, 2027, 1)).toBe(true);
    expect(isCollabWeek(from2026w33, 2027, 52)).toBe(true);
  });

  it('53주 연도 경계에서도 연도 비교가 우선한다', () => {
    const from2026w53 = { collabFromYear: 2026, collabFromWeek: 53 };
    expect(isCollabWeek(from2026w53, 2026, 52)).toBe(false);
    expect(isCollabWeek(from2026w53, 2026, 53)).toBe(true);
    expect(isCollabWeek(from2026w53, 2027, 1)).toBe(true);
  });
});
