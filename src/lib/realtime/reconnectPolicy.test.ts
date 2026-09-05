import { describe, it, expect } from 'vitest';
import {
  reconnectCeilingMs, shouldNoticeDisconnect, roomDrifted,
  RECONNECT_CEILING_MIN_MS, RECONNECT_CEILING_MAX_MS, DISCONNECT_NOTICE_AFTER_MS
} from './reconnectPolicy';

describe('reconnectCeilingMs — 재접속 상한', () => {
  it('provider 기본값(2.5초)보다 훨씬 크다', () => {
    // 기본값이면 전원이 2.5초마다 두드려 폭풍이 유지된다
    expect(reconnectCeilingMs(() => 0)).toBeGreaterThan(2_500 * 4);
  });

  it('정해진 범위 안에서 나온다', () => {
    expect(reconnectCeilingMs(() => 0)).toBe(RECONNECT_CEILING_MIN_MS);
    expect(reconnectCeilingMs(() => 0.5)).toBe(30_000);
    expect(reconnectCeilingMs(() => 0.999999)).toBeLessThan(RECONNECT_CEILING_MAX_MS);
  });

  it('클라이언트마다 다른 값이 나온다 (박자를 흩는다)', () => {
    const vals = [0.1, 0.3, 0.7, 0.9].map(r => reconnectCeilingMs(() => r));
    expect(new Set(vals).size).toBe(4);
  });

  it('무작위로 뽑아도 항상 범위를 벗어나지 않는다', () => {
    for (let i = 0; i < 200; i++) {
      const v = reconnectCeilingMs();
      expect(v).toBeGreaterThanOrEqual(RECONNECT_CEILING_MIN_MS);
      expect(v).toBeLessThan(RECONNECT_CEILING_MAX_MS);
    }
  });
});

describe('shouldNoticeDisconnect — 언제 사용자에게 알리는가', () => {
  it('연결돼 있으면 알리지 않는다', () => {
    expect(shouldNoticeDisconnect({ connected: true, disconnectedSince: 0, now: 999_999 })).toBe(false);
  });

  it('짧은 순단은 조용히 넘긴다', () => {
    expect(shouldNoticeDisconnect({ connected: false, disconnectedSince: 1_000, now: 6_000 })).toBe(false);
  });

  it('끊김이 지속되면 알린다', () => {
    const since = 1_000;
    expect(shouldNoticeDisconnect({
      connected: false, disconnectedSince: since, now: since + DISCONNECT_NOTICE_AFTER_MS
    })).toBe(true);
  });

  it('끊긴 시각을 모르면 알리지 않는다', () => {
    expect(shouldNoticeDisconnect({ connected: false, disconnectedSince: null, now: 999_999 })).toBe(false);
  });
});

describe('roomDrifted — 재접속 토큰이 다른 룸을 가리키는가', () => {
  const ROOM = 'production-report-t6-2026-w36-g2';

  it('같은 룸이면 그대로 재접속한다', () => {
    expect(roomDrifted(ROOM, ROOM)).toBe(false);
  });

  it('세대가 올라 룸 이름이 바뀌었으면 멈춰야 한다', () => {
    expect(roomDrifted(ROOM, 'production-report-t6-2026-w36-g3')).toBe(true);
  });

  it('토큰 응답에 룸이 없으면(구버전 서버) 판단하지 않는다', () => {
    expect(roomDrifted(ROOM, undefined)).toBe(false);
  });
});
