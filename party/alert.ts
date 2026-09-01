/**
 * 실시간 장애 알림 (텔레그램).
 *
 * 왜 폴링이 아니라 실패 지점에서 쏘는가:
 * 우리가 겪은 장애(2026-08-28)는 `onLoad` 실패가 partyserver 에게 잡혀 소켓 1011 로만
 * 끝나서, Cloudflare 지표에는 예외가 아니라 '연결 끊김'으로만 남았다. 지표를 주기적으로
 * 훑는 방식으로는 원인(상태코드)을 알 수 없고 지연도 크다. 실패한 그 자리에서 보내야
 * 룸 이름과 응답 상태까지 남는다.
 *
 * 시크릿이 설정돼 있지 않으면 조용히 아무것도 하지 않는다 —
 * 알림 설정 여부가 실시간 편집 동작에 영향을 주면 안 된다.
 */

/** 같은 룸에서 이 간격 안에는 한 번만 알린다. 폭풍이 나면 실패가 수백 건이라 그대로 두면 도배된다 */
const THROTTLE_MS = 15 * 60 * 1000;
/** 마지막 알림 시각을 두는 DO 스토리지 키 — 메모리에 두면 하이버네이션에서 날아가 제한이 안 먹는다 */
const LAST_ALERT_KEY = 'lastAlertAt';

export interface AlertEnv {
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
}

/** DO 스토리지 중 이 모듈이 쓰는 부분만 (테스트에서 갈아끼우기 쉽게 좁게 잡는다) */
export interface AlertStore {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
}

export interface AlertInput {
  title: string;
  room: string;
  /** 응답 상태코드 등 원인 단서 */
  detail: Record<string, unknown>;
  now?: number;
}

/** 서울 기준 표기 — 로그를 보는 사람이 전부 한국에 있다 */
export function kstStamp(ms: number): string {
  const d = new Date(ms + 9 * 60 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} `
    + `${p(d.getUTCHours())}:${p(d.getUTCMinutes())} KST`;
}

/** 보낼 문구. 장식 기호는 BMP 만 쓴다(이모지는 전송 경로마다 깨지는 일이 있다) */
export function formatAlert(input: AlertInput): string {
  const lines = [
    `[주간보고 실시간] ${input.title}`,
    `룸   : ${input.room}`,
    `시각 : ${kstStamp(input.now ?? Date.now())}`
  ];
  for (const [k, v] of Object.entries(input.detail)) {
    if (v === null || v === undefined || v === '') continue;
    lines.push(`${k.padEnd(5)}: ${String(v)}`);
  }
  return lines.join('\n');
}

/** 지금 알려도 되는가 — 마지막 알림에서 THROTTLE_MS 가 지났을 때만 */
export function shouldAlert(lastAlertAt: number | undefined, now: number): boolean {
  if (lastAlertAt === undefined) return true;
  return now - lastAlertAt >= THROTTLE_MS;
}

/**
 * 알림 전송. 실패해도 절대 던지지 않는다 —
 * 알림이 안 가는 것보다 그것 때문에 룸이 더 망가지는 쪽이 훨씬 나쁘다.
 */
export async function sendAlert(
  env: AlertEnv, store: AlertStore, input: AlertInput
): Promise<'sent' | 'throttled' | 'disabled' | 'failed'> {
  const token = env.TELEGRAM_BOT_TOKEN;
  const chatId = env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return 'disabled';

  const now = input.now ?? Date.now();
  try {
    const last = await store.get<number>(LAST_ALERT_KEY);
    if (!shouldAlert(last, now)) return 'throttled';
    // 전송 성공을 기다리지 않고 먼저 기록한다 — 폭풍 중 동시 다발 호출이
    // 전부 전송 단계까지 밀고 들어가면 제한이 무의미해진다.
    await store.put(LAST_ALERT_KEY, now);

    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: formatAlert({ ...input, now }),
        disable_notification: false
      })
    });
    return res.ok ? 'sent' : 'failed';
  } catch {
    return 'failed';
  }
}
