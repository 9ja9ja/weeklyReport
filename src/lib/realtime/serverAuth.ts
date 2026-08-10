/**
 * Worker ↔ Next 서버간 요청 인증.
 *
 * 사용자 세션과는 완전히 다른 경로다. 이 경로로 들어오는 요청은 잠금·세대 검사를
 * 우회하는 op(lock-finalize/restore)를 쓸 수 있으므로, 서명 검증을 통과하지 못하면
 * 어떤 이유로도 처리하지 않는다.
 */
import { NextResponse } from 'next/server';
import { verifyServerRequest } from './token';
import { serverSecret, isRealtimeConfigured } from './secrets';

export const SIG_HEADER = 'x-realtime-signature';
export const TS_HEADER = 'x-realtime-timestamp';

export interface ServerRequestResult<T> {
  ok: boolean;
  body?: T;
  response?: NextResponse;
}

/**
 * 본문을 읽고 서명을 검증한다.
 * 본문을 문자열로 먼저 읽어야 서명 대상과 파싱 대상이 정확히 같아진다
 * (JSON 을 다시 stringify 하면 키 순서·공백이 달라져 서명이 어긋난다).
 */
export async function readSignedBody<T>(request: Request): Promise<ServerRequestResult<T>> {
  // 미구성(시크릿 없음)은 장애가 아니다. 500 대신 503 으로 명확히 알린다.
  if (!isRealtimeConfigured()) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: '실시간 기능이 아직 구성되지 않았습니다.' },
        { status: 503 }
      )
    };
  }
  const raw = await request.text();
  const ok = await verifyServerRequest(
    raw,
    request.headers.get(SIG_HEADER),
    request.headers.get(TS_HEADER),
    serverSecret()
  );
  if (!ok) {
    return {
      ok: false,
      response: NextResponse.json({ error: '서명이 유효하지 않습니다.' }, { status: 401 })
    };
  }
  try {
    return { ok: true, body: JSON.parse(raw) as T };
  } catch {
    return {
      ok: false,
      response: NextResponse.json({ error: '본문을 해석할 수 없습니다.' }, { status: 400 })
    };
  }
}

/** base64 ↔ 바이트 (Worker 와 Next 가 ydoc 바이트를 주고받는 형식) */
export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

export function base64ToBytes(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
