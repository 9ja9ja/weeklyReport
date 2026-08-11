/**
 * 조회 기본 주차.
 *
 * 화면을 열자마자 보이는 주차라 틀리면 **매번 손으로 돌려놔야 하고**, 최악의 경우
 * 엉뚱한 주차에 작성해 넣는다. 연말·연초는 달력 연도와 주차의 해가 갈라져 특히 틀리기 쉽다.
 */
import { describe, it, expect } from 'vitest';
import { getIsoWeek, getDefaultWeek, getPrevWeek } from './weekUtils';

/** 로컬 시간 기준 — 화면은 브라우저 로컬 시간으로 판단한다 */
const at = (s: string) => new Date(`${s}T09:00:00`);

describe('getIsoWeek — 주차가 속한 해', () => {
  it('평범한 날은 달력 연도 그대로', () => {
    expect(getIsoWeek(at('2026-08-11'))).toEqual({ year: 2026, weekNum: 33 });
  });

  it('1월 초라도 전년도 마지막 주에 속하면 전년도로 센다', () => {
    // 2027-01-01(금)은 ISO 로 2026년 53주차다. 2027년 53주차는 존재하지 않는다.
    expect(getIsoWeek(at('2027-01-01'))).toEqual({ year: 2026, weekNum: 53 });
  });

  it('12월 말이라도 다음 해 1주차면 다음 해로 센다', () => {
    expect(getIsoWeek(at('2025-12-29'))).toEqual({ year: 2026, weekNum: 1 });
  });
});

describe('getDefaultWeek — 월·화는 지난주, 수~일은 이번주', () => {
  it('월요일은 지난주', () => {
    expect(getDefaultWeek(at('2026-08-10'))).toEqual({ year: 2026, weekNum: 32 });
  });

  it('화요일은 지난주', () => {
    expect(getDefaultWeek(at('2026-08-11'))).toEqual({ year: 2026, weekNum: 32 });
  });

  it('수·목·금·토·일은 이번주', () => {
    for (const d of ['2026-08-12', '2026-08-13', '2026-08-14', '2026-08-15', '2026-08-16']) {
      expect(getDefaultWeek(at(d))).toEqual({ year: 2026, weekNum: 33 });
    }
  });

  it('일요일은 그날이 속한 주(직전 월요일부터의 주)를 연다', () => {
    // 2026-08-09(일)은 32주차의 마지막 날이다 — 33주차가 아니다
    expect(getDefaultWeek(at('2026-08-09'))).toEqual({ year: 2026, weekNum: 32 });
  });

  it('해가 바뀌는 월요일에도 존재하는 주차를 돌려준다', () => {
    // 2027-01-04(월) → 이번주는 2027년 1주차, 기본값은 그 직전인 2026년 53주차
    expect(getDefaultWeek(at('2027-01-04'))).toEqual({ year: 2026, weekNum: 53 });
    // 2025-12-29(월) → 이번주는 2026년 1주차, 기본값은 2025년 52주차
    expect(getDefaultWeek(at('2025-12-29'))).toEqual({ year: 2025, weekNum: 52 });
  });

  it('언제나 지난주 계산과 어긋나지 않는다 (1년 전체)', () => {
    const d = new Date('2026-01-01T09:00:00');
    for (let i = 0; i < 400; i++) {
      const cur = getIsoWeek(d);
      const expected = d.getDay() === 1 || d.getDay() === 2
        ? getPrevWeek(cur.year, cur.weekNum)
        : cur;
      expect(getDefaultWeek(d)).toEqual(expected);
      expect(expected.weekNum).toBeGreaterThanOrEqual(1);
      expect(expected.weekNum).toBeLessThanOrEqual(53);
      d.setDate(d.getDate() + 1);
    }
  });
});
