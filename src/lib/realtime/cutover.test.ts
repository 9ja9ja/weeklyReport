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

describe('isCollabWeek — 끈 팀 (collabUntil)', () => {
  // 33주차에 켰다가 36주차에 껐다: 33~35 는 공동 편집, 36부터 기존 방식
  const stopped = {
    collabFromYear: 2026, collabFromWeek: 33,
    collabUntilYear: 2026, collabUntilWeek: 35
  };

  it('끈 시점까지는 공동 편집으로 남는다', () => {
    // 이미 함께 작성한 주차가 legacy 로 되돌아가면 개인 Report 기준으로 재생성돼
    // 공동 문서 내용을 덮어쓴다. 지난 주차는 건드리면 안 된다.
    expect(isCollabWeek(stopped, 2026, 33)).toBe(true);
    expect(isCollabWeek(stopped, 2026, 35)).toBe(true);
  });

  it('끈 다음 주차부터 기존 방식', () => {
    expect(isCollabWeek(stopped, 2026, 36)).toBe(false);
    expect(isCollabWeek(stopped, 2026, 52)).toBe(false);
    expect(isCollabWeek(stopped, 2027, 1)).toBe(false);
  });

  it('켠 적 없는 주차는 여전히 기존 방식', () => {
    expect(isCollabWeek(stopped, 2026, 32)).toBe(false);
  });

  it('until 이 from 보다 앞이면 어느 주차도 공동 편집이 아니다', () => {
    // 켜자마자 되돌린 경우 — 구간이 비어야 한다
    const undone = {
      collabFromYear: 2026, collabFromWeek: 33,
      collabUntilYear: 2026, collabUntilWeek: 32
    };
    for (const w of [31, 32, 33, 34]) expect(isCollabWeek(undone, 2026, w)).toBe(false);
  });

  it('until 한쪽만 있으면 무시한다 (열린 구간)', () => {
    expect(isCollabWeek({ ...stopped, collabUntilWeek: null }, 2026, 40)).toBe(true);
    expect(isCollabWeek({ ...stopped, collabUntilYear: null }, 2026, 40)).toBe(true);
  });
});
