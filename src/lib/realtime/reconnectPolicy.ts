/**
 * 실시간 재접속 정책 — 재접속 폭풍을 막는다.
 *
 * y-partyserver provider 는 끊길 때마다
 *   대기 = min(2^실패횟수 × 100ms, maxBackoffTime)
 * 로 재접속한다. maxBackoffTime 기본값이 2500ms 이고 **지터가 없다.**
 * 그래서 서버가 룸을 못 열어주는 동안 접속자 전원이 5회 실패 뒤부터
 * 2.5초마다 같은 박자로 동시에 두드린다.
 *
 * 2026-08-28 운영에서 이게 두 번 터졌다.
 *   13:29~13:38  연결시도 422건 / 성공 33건
 *   16:43~16:53  연결시도 736건 / 성공  7건 (0.95%)
 * 재시도 자체가 부하를 만들어 장애를 유지시키는 구조라, 상한을 올리고
 * 클라이언트마다 다른 값을 줘서 박자를 흩는다.
 */

/** 재접속 대기 상한의 하한/상한 — 이 사이에서 클라이언트마다 다른 값을 뽑는다 */
export const RECONNECT_CEILING_MIN_MS = 20_000;
export const RECONNECT_CEILING_MAX_MS = 40_000;

/**
 * 이 클라이언트가 쓸 재접속 대기 상한.
 *
 * 고정값을 주면 전원이 같은 간격으로 동시에 재시도해 서버에 파도가 친다.
 * 접속마다 한 번 뽑아 두면 사람마다 주기가 어긋나 요청이 고르게 퍼진다.
 */
export function reconnectCeilingMs(rand: () => number = Math.random): number {
  const span = RECONNECT_CEILING_MAX_MS - RECONNECT_CEILING_MIN_MS;
  return Math.floor(RECONNECT_CEILING_MIN_MS + rand() * span);
}

/** 끊긴 뒤 이만큼 지나야 사용자에게 알린다 — 순단마다 띄우면 소음이 된다 */
export const DISCONNECT_NOTICE_AFTER_MS = 15_000;

/** 연결이 오래 끊겼을 때 보여줄 문구 */
export const DISCONNECTED_NOTICE =
  '실시간 서버에 연결하지 못했습니다. 자동으로 다시 시도하는 중입니다 — 입력한 내용은 사라지지 않습니다.';

/**
 * 지금 연결 상태로 보아 사용자에게 알려야 하는가.
 * 끊긴 직후의 짧은 순단은 조용히 넘기고, 지속될 때만 알린다.
 */
export function shouldNoticeDisconnect(
  o: { connected: boolean; disconnectedSince: number | null; now: number }
): boolean {
  if (o.connected) return false;
  if (o.disconnectedSince == null) return false;
  return o.now - o.disconnectedSince >= DISCONNECT_NOTICE_AFTER_MS;
}

/** 세대가 올라 이 룸이 은퇴했을 때 보여줄 문구 — 새로고침해야 새 룸으로 붙는다 */
export const RESTORED_NOTICE = '문서가 복원되었습니다. 새로고침해주세요.';

/**
 * 재접속 때 받은 토큰이 다른 룸을 가리키는가.
 *
 * 룸 이름에는 문서 세대가 박혀 있다(…-g3). 취합본 저장·복원으로 세대가 오르면 서버는 새 룸
 * 이름을 주지만, provider 는 처음 만든 룸 이름으로만 재접속한다 — 새 토큰 + 구룸 조합은
 * Worker 선인증에서 403 으로 끝나 20~40초마다 헛도는 루프가 된다. 룸이 바뀌었으면 멈추고
 * 새로고침을 안내해야 한다.
 */
export function roomDrifted(currentRoom: string, tokenRoom: string | undefined): boolean {
  if (!tokenRoom) return false;
  return tokenRoom !== currentRoom;
}
