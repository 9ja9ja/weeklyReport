import { cookies } from 'next/headers';
import crypto from 'crypto';

/**
 * 서버 세션 — HMAC 서명된 쿠키
 *
 * 이전에는 클라이언트가 body/query 로 requestUserId 를 보내고 서버가 그걸 그대로 믿었다.
 * 값을 바꾸면 남의 계정으로 행세할 수 있었으므로, 신원은 오직 이 쿠키에서만 읽는다.
 *
 * 쿠키 값 형식:  base64url({"uid":1,"exp":1700000000})  +  "."  +  base64url(HMAC-SHA256)
 * 서버만 아는 SESSION_SECRET 으로 서명하므로 클라이언트가 uid 를 위조할 수 없다.
 */

const COOKIE_NAME = 'wr_session';
/** 서명 만료 — 로그인 후 12시간 */
const MAX_AGE_SEC = 12 * 60 * 60;

function getSecret(): string {
  const s = process.env.SESSION_SECRET;
  if (s && s.length >= 16) return s;
  if (process.env.NODE_ENV === 'production') {
    // 운영에서 시크릿이 없으면 위조 서명을 막을 수 없다. 인증을 통과시키느니 실패시킨다.
    throw new Error('SESSION_SECRET 환경변수가 설정되지 않았습니다.');
  }
  return 'dev-only-insecure-secret-do-not-use-in-production';
}

const b64url = (buf: Buffer) => buf.toString('base64url');

function sign(payload: string): string {
  return b64url(crypto.createHmac('sha256', getSecret()).update(payload).digest());
}

/** 로그인 성공 시 호출 — 서명된 세션 쿠키를 심는다 */
export async function createSession(userId: number): Promise<void> {
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE_SEC;
  const payload = b64url(Buffer.from(JSON.stringify({ uid: userId, exp })));
  const value = `${payload}.${sign(payload)}`;

  (await cookies()).set(COOKIE_NAME, value, {
    httpOnly: true, // JS 로 읽을 수 없다 (XSS 로 탈취 불가)
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/'
    // maxAge 를 두지 않아 브라우저 세션 쿠키가 된다 (탭을 닫으면 사라짐 — 기존 sessionStorage 와 동일한 수명)
  });
}

export async function destroySession(): Promise<void> {
  (await cookies()).delete(COOKIE_NAME);
}

/**
 * 현재 요청자의 userId. 쿠키가 없거나 서명이 틀리거나 만료면 null.
 * 이 함수의 반환값만이 신원의 근거다.
 */
export async function getSessionUserId(): Promise<number | null> {
  const raw = (await cookies()).get(COOKIE_NAME)?.value;
  if (!raw) return null;

  const dot = raw.lastIndexOf('.');
  if (dot < 1) return null;

  const payload = raw.slice(0, dot);
  const given = raw.slice(dot + 1);
  const expected = sign(payload);

  // 타이밍 공격 방지 — 길이가 다르면 timingSafeEqual 이 예외를 던지므로 먼저 비교한다
  if (given.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected))) return null;

  try {
    const { uid, exp } = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (typeof uid !== 'number' || typeof exp !== 'number') return null;
    if (exp < Math.floor(Date.now() / 1000)) return null;
    return uid;
  } catch {
    return null;
  }
}
