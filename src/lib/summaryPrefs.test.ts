/**
 * 취합본 표시 설정(내용없음 포함 / 작성자 포함)의 물려받기 규칙.
 *
 * 이 규칙이 화면마다 갈리면 같은 주차가 화면마다 다르게 보인다 —
 * 실제로 팀별 취합본은 "직전 주차 물려받기"를 하는데 전체취합본·PDF·엑셀은
 * `?? true` 로 하드코딩돼 있어, 체크박스는 꺼져 보이는데 내용없음 행이 그대로 나왔다.
 */
import { describe, it, expect } from 'vitest';
import { isPlaceholderSummary, pickInherited, resolveDisplayPrefs, type StoredPrefs } from './summaryPrefs';

const row = (
  teamId: number, year: number, weekNum: number,
  includeEmpty: boolean | null, includeAuthor: boolean | null
): StoredPrefs => ({ teamId, year, weekNum, includeEmpty, includeAuthor });

describe('resolveDisplayPrefs — 값이 없으면 직전 설정을 물려받는다', () => {
  it('자기 주차에 값이 있으면 그대로 쓴다', () => {
    expect(resolveDisplayPrefs(row(1, 2026, 35, false, false), row(1, 2026, 34, true, true)))
      .toEqual({ includeEmpty: false, includeAuthor: false });
  });

  it('자기 주차가 없으면 직전 주차 값을 쓴다', () => {
    expect(resolveDisplayPrefs(null, row(1, 2026, 34, false, true)))
      .toEqual({ includeEmpty: false, includeAuthor: true });
  });

  it('직전 설정도 없으면 둘 다 켬(true)이 기본이다', () => {
    expect(resolveDisplayPrefs(null, null)).toEqual({ includeEmpty: true, includeAuthor: true });
  });

  it('한 필드만 설정돼 있으면 나머지만 물려받는다', () => {
    // 체크박스 토글은 그 필드만 부분 저장하므로 실제로 자주 나오는 모양이다
    expect(resolveDisplayPrefs(row(1, 2026, 35, null, true), row(1, 2026, 34, false, false)))
      .toEqual({ includeEmpty: false, includeAuthor: true });
  });

  it('직전 행의 해당 필드가 비어 있으면 기본값으로 떨어진다', () => {
    expect(resolveDisplayPrefs(row(1, 2026, 35, null, null), row(1, 2026, 34, false, null)))
      .toEqual({ includeEmpty: false, includeAuthor: true });
  });

  /**
   * 2026-08-28 운영에서 신고된 그 상태 그대로.
   * 플랫폼기획팀 34주차 = (내용없음 끔, 작성자 켬) / 35주차 = 작성자만 저장돼 내용없음은 비어 있음.
   * 취합본 화면은 "내용없음 끔"으로 보이는데 전체취합본은 켜서 내용없음 행을 출력했다.
   */
  it('신고된 운영 상태(플랫폼기획팀 2026-35)에서 내용없음은 꺼진 채로 나온다', () => {
    expect(resolveDisplayPrefs(row(1, 2026, 35, null, true), row(1, 2026, 34, false, true)))
      .toEqual({ includeEmpty: false, includeAuthor: true });
  });
});

describe('pickInherited — 팀별로 직전 설정 행을 고른다', () => {
  it('가장 가까운 이전 주차를 고른다', () => {
    const rows = [row(1, 2026, 30, true, true), row(1, 2026, 34, false, false), row(1, 2026, 32, true, true)];
    expect(pickInherited(rows, 2026, 35).get(1)?.weekNum).toBe(34);
  });

  it('같은 주차와 이후 주차는 후보가 아니다', () => {
    const rows = [row(1, 2026, 35, false, false), row(1, 2026, 36, false, false)];
    expect(pickInherited(rows, 2026, 35).get(1)).toBeUndefined();
  });

  it('연도가 바뀌어도 직전 주차를 찾는다', () => {
    const rows = [row(1, 2025, 52, false, true), row(1, 2026, 3, true, true)];
    expect(pickInherited(rows, 2026, 1).get(1)?.year).toBe(2025);
  });

  it('내용없음 값이 비어 있는 행은 물려받을 후보가 아니다', () => {
    // 체크박스를 한 번도 만지지 않아 자동 생성만 된 행은 물려줄 설정이 없다
    const rows = [row(1, 2026, 34, null, true), row(1, 2026, 33, false, false)];
    expect(pickInherited(rows, 2026, 35).get(1)?.weekNum).toBe(33);
  });

  it('팀마다 독립적으로 고른다', () => {
    const rows = [row(1, 2026, 34, false, false), row(5, 2026, 31, true, true)];
    const got = pickInherited(rows, 2026, 35);
    expect(got.get(1)?.weekNum).toBe(34);
    expect(got.get(5)?.weekNum).toBe(31);
  });

  it('후보가 없는 팀은 비어 있다', () => {
    expect(pickInherited([], 2026, 35).get(1)).toBeUndefined();
  });
});

/**
 * 표시 설정 토글은 그 주차 행이 없으면 contents='{}' 로 행을 만든다(설정을 담을 자리가 필요하다).
 * 이 자리표시 행을 취합본으로 세면 "취합본 있음(내용 없음)"이 되어 개별 보고 폴백이 막히고,
 * 개인 작성 팀이 통째로 빈칸으로 나온다. 운영에서 실제로 만들어진 행을 확인했다(땡겨요 2026-32).
 */
describe('isPlaceholderSummary — 설정만 담긴 빈 행은 취합본이 아니다', () => {
  it('빈 객체는 자리표시 행이다', () => {
    expect(isPlaceholderSummary('{}')).toBe(true);
  });

  it('내용이 비어 있어도 분류가 들어 있으면 실제 취합본이다', () => {
    // 팀장이 항목을 모두 지운 취합본 — 개별 보고로 되살리면 안 된다
    expect(isPlaceholderSummary('{"12":{"current":[],"next":[]}}')).toBe(false);
  });

  it('내용이 있으면 당연히 취합본이다', () => {
    expect(isPlaceholderSummary('{"12":{"current":[{"id":"a","subText":"x"}],"next":[]}}')).toBe(false);
  });

  it('빈 문자열·null 은 취합본이 아니다', () => {
    expect(isPlaceholderSummary('')).toBe(true);
    expect(isPlaceholderSummary(null)).toBe(true);
    expect(isPlaceholderSummary(undefined)).toBe(true);
  });

  it('깨진 JSON 은 취합본으로 세지 않는다', () => {
    expect(isPlaceholderSummary('{not json')).toBe(true);
  });

  it('객체가 아닌 JSON 도 취합본으로 세지 않는다', () => {
    expect(isPlaceholderSummary('[]')).toBe(true);
    expect(isPlaceholderSummary('null')).toBe(true);
  });
});
