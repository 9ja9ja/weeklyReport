/**
 * 룸 초기 상태 로드의 재시도 정책.
 *
 * 2026-09-22 18:04, t5/w39 룸이 깨어나며 /api/realtime/doc 이 520 을 돌려줘 편집 화면이
 * 열리지 않았다. 520~527 은 Cloudflare 고유 코드로, Worker→Vercel 구간의 일시적 결함이다.
 * 실제로 2분 18초 만에 저절로 회복됐다 — 짧은 재시도면 사용자가 모르고 지나갈 일이었다.
 *
 * 다만 무차별 재시도는 금물이다. 2026-08-28 에는 같은 실패가 10분간 이어지며 분당 120건의
 * 재접속 폭풍이 났는데, 그때 재시도를 걸었다면 Next 로 가는 요청을 3배로 늘려 악화시켰다.
 * 그래서 **일시적 네트워크 계열만** 재시도하고, 부하·권한·세대 계열은 즉시 포기한다.
 */
import { describe, it, expect } from 'vitest';
import { isTransientLoadFailure, loadWithRetry } from '../../../party/loadRetry';

describe('isTransientLoadFailure — 무엇을 다시 시도할 것인가', () => {
  it('Cloudflare origin 계열(520~527)은 일시적이다', () => {
    for (const s of [520, 521, 522, 523, 524, 525, 526, 527]) {
      expect(isTransientLoadFailure(s)).toBe(true);
    }
  });

  it('연결 자체가 안 된 경우(status 0)도 일시적이다', () => {
    // callNext 는 fetch 예외를 status 0 으로 돌려준다
    expect(isTransientLoadFailure(0)).toBe(true);
  });

  it('세대 불일치(409)는 재시도하지 않는다 — 은퇴 경로가 즉시 처리해야 한다', () => {
    expect(isTransientLoadFailure(409)).toBe(false);
  });

  it('봇 차단(403)은 재시도해도 같은 결과다', () => {
    expect(isTransientLoadFailure(403)).toBe(false);
  });

  it('부하 계열(502·503·504)은 재시도하지 않는다 — 요청을 늘리면 악화된다', () => {
    for (const s of [502, 503, 504]) expect(isTransientLoadFailure(s)).toBe(false);
  });

  it('앱 오류(500)와 문서 없음(404), 서명 실패(401)도 재시도 대상이 아니다', () => {
    for (const s of [500, 404, 401]) expect(isTransientLoadFailure(s)).toBe(false);
  });
});

describe('loadWithRetry — 실제 재시도 동작', () => {
  const noSleep = async () => {};

  it('처음에 성공하면 한 번만 부른다', async () => {
    let calls = 0;
    const res = await loadWithRetry(async () => { calls++; return { ok: true, status: 200, data: null }; }, noSleep);
    expect(calls).toBe(1);
    expect(res.ok).toBe(true);
  });

  it('일시적 실패 뒤 성공하면 그 결과를 돌려준다', async () => {
    let calls = 0;
    const res = await loadWithRetry(async () => {
      calls++;
      return calls < 3 ? { ok: false, status: 520, data: null } : { ok: true, status: 200, data: { ydoc: 'x' } };
    }, noSleep);
    expect(calls).toBe(3);
    expect(res.ok).toBe(true);
  });

  it('계속 실패하면 3회까지만 시도하고 마지막 결과를 돌려준다', async () => {
    let calls = 0;
    const res = await loadWithRetry(async () => { calls++; return { ok: false, status: 520, data: null }; }, noSleep);
    expect(calls).toBe(3);
    expect(res.status).toBe(520);
  });

  it('재시도 대상이 아니면 즉시 포기한다', async () => {
    let calls = 0;
    const res = await loadWithRetry(async () => { calls++; return { ok: false, status: 409, data: null }; }, noSleep);
    expect(calls).toBe(1);
    expect(res.status).toBe(409);
  });

  it('다시 시도할수록 더 오래 기다린다', async () => {
    const waits: number[] = [];
    await loadWithRetry(
      async () => ({ ok: false, status: 520, data: null }),
      async ms => { waits.push(ms); }
    );
    expect(waits.length).toBe(2);              // 3회 시도 = 대기 2번
    expect(waits[1]).toBeGreaterThan(waits[0]);
  });

  it('전체 대기가 1초를 넘지 않는다 — 접속을 오래 붙잡으면 안 된다', async () => {
    const waits: number[] = [];
    await loadWithRetry(
      async () => ({ ok: false, status: 520, data: null }),
      async ms => { waits.push(ms); }
    );
    expect(waits.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(1000);
  });
});
