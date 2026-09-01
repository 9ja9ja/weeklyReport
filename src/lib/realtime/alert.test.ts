/**
 * 장애 알림의 판정·문구 로직.
 *
 * 전송 자체(fetch)는 Worker 런타임이라 여기서 검증하지 않는다.
 * 대신 폭풍 때 도배되지 않게 막는 제한 규칙과, 사람이 읽고 바로 대응할 수 있는
 * 문구 구성을 고정한다.
 */
import { describe, it, expect } from 'vitest';
import { shouldAlert, formatAlert, kstStamp } from '../../../party/alert';

const MIN = 60_000;

describe('shouldAlert — 폭풍 때 도배를 막는다', () => {
  it('처음 실패는 항상 알린다', () => {
    expect(shouldAlert(undefined, 1_000_000)).toBe(true);
  });

  it('직후 연속 실패는 억제한다', () => {
    // 2026-08-28 폭풍은 분당 120건이었다. 그대로 두면 텔레그램이 마비된다
    const t = 1_000_000;
    expect(shouldAlert(t, t + 1_000)).toBe(false);
    expect(shouldAlert(t, t + 14 * MIN)).toBe(false);
  });

  it('15분이 지나면 다시 알린다 — 장애가 계속되고 있음을 알려야 한다', () => {
    const t = 1_000_000;
    expect(shouldAlert(t, t + 15 * MIN)).toBe(true);
  });
});

describe('formatAlert — 받는 사람이 바로 대응할 수 있어야 한다', () => {
  const base = {
    title: '룸 초기화 실패',
    room: 'production-report-t5-2026-w36-g1',
    now: Date.UTC(2026, 8, 3, 5, 22)   // 14:22 KST
  };

  it('룸·시각·원인이 모두 담긴다', () => {
    const msg = formatAlert({ ...base, detail: { status: 403, error: 'challenge' } });
    expect(msg).toContain('룸 초기화 실패');
    expect(msg).toContain('production-report-t5-2026-w36-g1');
    expect(msg).toContain('2026-09-03 14:22 KST');
    expect(msg).toContain('403');
  });

  it('빈 값은 줄을 만들지 않는다', () => {
    const msg = formatAlert({ ...base, detail: { status: 500, error: null } });
    expect(msg).not.toContain('error');
  });

  it('시각은 한국 시간으로 찍는다', () => {
    expect(kstStamp(Date.UTC(2026, 8, 3, 5, 22))).toBe('2026-09-03 14:22 KST');
  });

  it('자정 넘김도 날짜가 맞는다', () => {
    expect(kstStamp(Date.UTC(2026, 8, 3, 16, 30))).toBe('2026-09-04 01:30 KST');
  });
});
