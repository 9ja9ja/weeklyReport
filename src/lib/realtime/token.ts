/**
 * 실시간 접속 토큰 · 서버간 서명.
 *
 * Cloudflare Worker 는 Next 의 세션 쿠키를 검증할 수 없다(다른 도메인 + SESSION_SECRET 미보유).
 * 그래서 Next 가 세션을 확인한 뒤 단기 토큰을 발급하고, Worker 는 그 토큰만 검증한다.
 *
 * ── 왜 Web Crypto 인가 ──────────────────────────────────────
 * 이 모듈은 Next(Node)와 Worker(V8 isolate) 양쪽에서 돌아야 한다.
 * Worker 에는 node:crypto 가 없으므로 두 곳 모두에 있는 SubtleCrypto 를 쓴다.
 *
 * ── 왜 시크릿을 둘로 나누는가 ────────────────────────────────
 * 사용자 토큰 서명키(REALTIME_TOKEN_SECRET)와 서버간 시크릿(REALTIME_SERVER_SECRET)이 같으면,
 * 한쪽이 유출됐을 때 "임의 팀 토큰 위조"와 "임의 팀 문서 덮어쓰기"가 동시에 성립한다.
 * 또 둘 다 SESSION_SECRET 과 달라야 Worker 쪽 유출이 세션 위조로 번지지 않는다.
 */

export interface RealtimeTokenPayload {
  /** 사용자 */
  uid: number;
  name: string;
  /** 접속 대상 문서 */
  env: string;
  teamId: number;
  year: number;
  weekNum: number;
  /** 룸 세대 — 복원되면 올라가고 클라이언트는 새 룸으로 옮겨야 한다 */
  gen: number;
  /** 쓰기 가능 여부. 서버가 정하며 클라이언트 주장은 믿지 않는다 */
  readOnly: boolean;
  /** 잠금 토글 등 관리 동작 가능 여부 */
  master: boolean;
  /** 만료 (epoch seconds) */
  exp: number;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = '';
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * base64url → UTF-8 문자열.
 * atob 은 바이트 단위라 그 결과를 그대로 JSON.parse 하면 한글 같은 멀티바이트가 깨진다.
 * 바이트로 되돌린 뒤 TextDecoder 로 읽어야 한다. (이 앱은 사용자 이름이 전부 한글이다)
 */
function b64urlDecode(s: string): string {
  const pad = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(pad + '='.repeat((4 - (pad.length % 4)) % 4));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return dec.decode(bytes);
}

async function hmac(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  return b64url(await crypto.subtle.sign('HMAC', key, enc.encode(message)));
}

/** 길이가 달라도 타이밍이 새지 않게 고정 시간 비교 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** `payload.signature` 형태로 서명한다 */
export async function signToken(payload: RealtimeTokenPayload, secret: string): Promise<string> {
  const body = b64url(enc.encode(JSON.stringify(payload)));
  return `${body}.${await hmac(secret, body)}`;
}

/** 서명·만료를 검증한다. 실패하면 null (사유를 노출하지 않는다) */
export async function verifyToken(
  token: string | null | undefined, secret: string, nowSec = Math.floor(Date.now() / 1000)
): Promise<RealtimeTokenPayload | null> {
  if (!token) return null;
  const dot = token.lastIndexOf('.');
  if (dot < 1) return null;

  const body = token.slice(0, dot);
  const given = token.slice(dot + 1);
  if (!timingSafeEqual(given, await hmac(secret, body))) return null;

  try {
    const p = JSON.parse(b64urlDecode(body)) as RealtimeTokenPayload;
    if (typeof p?.uid !== 'number' || typeof p?.exp !== 'number') return null;
    if (p.exp < nowSec) return null;
    return p;
  } catch {
    return null;
  }
}

// ── 서버간(Worker ↔ Next) 요청 서명 ──────────────────────────

/** 리플레이 허용 창 — 이보다 오래된 서명은 거부한다 */
export const SERVER_SIGNATURE_WINDOW_SEC = 300;

/** 본문 + 타임스탬프를 함께 서명한다. 본문만 서명하면 재전송을 막을 수 없다 */
export async function signServerRequest(
  body: string, secret: string, tsSec = Math.floor(Date.now() / 1000)
): Promise<{ signature: string; timestamp: string }> {
  return { signature: await hmac(secret, `${tsSec}.${body}`), timestamp: String(tsSec) };
}

export async function verifyServerRequest(
  body: string, signature: string | null, timestamp: string | null, secret: string,
  nowSec = Math.floor(Date.now() / 1000)
): Promise<boolean> {
  if (!signature || !timestamp) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  if (Math.abs(nowSec - ts) > SERVER_SIGNATURE_WINDOW_SEC) return false;
  return timingSafeEqual(signature, await hmac(secret, `${ts}.${body}`));
}

// ── 룸 이름 ─────────────────────────────────────────────────

/**
 * 룸 이름에 환경과 세대를 넣는다.
 * - 환경: 프리뷰 배포가 운영 룸에 들어가 실제 보고를 편집하는 사고를 막는다
 * - 세대: 복원하면 세대가 올라가 구 문서를 든 클라이언트가 자연히 새 룸으로 옮겨간다
 * Durable Object 이름으로 쓰이므로 안전한 문자만 남긴다.
 */
export function roomName(env: string, teamId: number, year: number, weekNum: number, gen: number): string {
  const safeEnv = env.replace(/[^a-zA-Z0-9_-]/g, '_');
  return `${safeEnv}-t${teamId}-${year}-w${weekNum}-g${gen}`;
}

/** 룸 이름을 되돌린다. 형식이 어긋나면 null */
export function parseRoomName(name: string): { env: string; teamId: number; year: number; weekNum: number; gen: number } | null {
  const m = /^(.+)-t(\d+)-(\d+)-w(\d+)-g(\d+)$/.exec(name);
  if (!m) return null;
  return {
    env: m[1],
    teamId: Number(m[2]),
    year: Number(m[3]),
    weekNum: Number(m[4]),
    gen: Number(m[5])
  };
}
