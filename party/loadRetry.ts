/**
 * 룸 초기 상태 로드(`/api/realtime/doc`)의 재시도 정책.
 *
 * onLoad 가 실패하면 partyserver 가 그 예외를 잡아 소켓을 1011 로 닫는다. 사용자에게는
 * "편집 화면이 안 열린다"로만 보이고, 룸은 스스로 회복하지 못한다.
 *
 * 2026-09-22 18:04 에 실제로 났다: t5/w39 룸이 깨어나며 520 을 받아 실패했고,
 * 2분 18초 뒤 저절로 정상으로 돌아왔다. 짧은 재시도였으면 아무도 몰랐을 일이다.
 *
 * **다만 무차별 재시도는 금물이다.** 2026-08-28 에는 같은 실패가 10분간 이어지며
 * 분당 120건의 재접속 폭풍이 났다. 그때 재시도를 걸었다면 Next 로 가는 요청이 3배가 돼
 * 장애를 키웠을 것이다. 그래서 대상을 좁힌다 — 다시 걸면 풀릴 법한 것만.
 */

/** callNext 가 돌려주는 모양 (성공 여부 + 상태코드 + 본문) */
export interface LoadResult {
  ok: boolean;
  status: number;
  data: unknown;
}

/** 시도 횟수 — 길게 끌면 접속이 그만큼 붙잡혀 있다 */
const MAX_ATTEMPTS = 3;
/** 재시도 사이 대기 (ms). 합쳐서 1초를 넘기지 않는다 */
const BACKOFF_MS = [200, 600];

/**
 * 다시 시도하면 풀릴 수 있는 실패인가.
 *
 * 520~527 은 Cloudflare 고유 코드로 "origin 에 닿았지만 응답이 이상했다"는 뜻이다.
 * Vercel 도 Next 도 이 번호를 쓰지 않으므로, Worker→Vercel 구간의 일시적 결함이 확실하다.
 * status 0 은 callNext 가 fetch 예외를 표현하는 값이라 같은 부류로 본다.
 *
 * 나머지는 전부 제외한다:
 *  - 409  세대 불일치. 은퇴 경로가 즉시 처리해야 하며 지연시키면 접속자가 새 룸으로 못 간다
 *  - 403  봇 차단. 다시 걸어도 같은 판정을 받는다
 *  - 502·503·504  부하 계열. 요청을 늘리는 것이 곧 악화다
 *  - 500·404·401  앱 오류·문서 없음·서명 실패. 재시도로 달라지지 않는다
 */
export function isTransientLoadFailure(status: number): boolean {
  if (status === 0) return true;
  return status >= 520 && status <= 527;
}

/**
 * 일시적 실패에 한해 짧게 다시 시도한다.
 *
 * `sleep` 을 인자로 받는 이유: 테스트가 실제로 기다리지 않고도 대기 간격을 검증할 수 있어야 한다.
 */
export async function loadWithRetry(
  attempt: () => Promise<LoadResult>,
  sleep: (ms: number) => Promise<void>
): Promise<LoadResult> {
  let last = await attempt();
  for (let i = 0; i < MAX_ATTEMPTS - 1; i++) {
    if (last.ok || !isTransientLoadFailure(last.status)) return last;
    await sleep(BACKOFF_MS[i]);
    last = await attempt();
  }
  return last;
}
