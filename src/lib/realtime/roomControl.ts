/**
 * Next → Worker 제어 경로.
 *
 * 잠금·해제·권한 회수를 접속 중인 룸에 즉시 반영하려면 서버가 룸에 명령을 보낼 수 있어야 한다.
 * y-partyserver 에 onCustomMessage/broadcastCustomMessage 가 내장돼 있어(스파이크 확인)
 * 별도 채널을 만들지 않고 Worker 의 HTTP 엔드포인트로 명령을 넣는다.
 *
 * Worker 가 없거나 응답하지 않아도 **DB 상태가 진실원본**이므로 잠금 자체는 성립한다.
 * 이 호출은 "접속자에게 즉시 알리는" 최적화이며, 실패해도 최대 토큰 TTL 안에 수렴한다.
 */
import { signServerRequest } from './token';
import { serverSecret, isRealtimeConfigured } from './secrets';

export type RoomCommand =
  | { type: 'freeze' }
  | { type: 'unfreeze' }
  | { type: 'flush' }
  | { type: 'locked'; writeEpoch: number }
  | { type: 'unlocked'; writeEpoch: number }
  | { type: 'generation'; docGeneration: number }
  | { type: 'revoke'; userIds: number[] };

export interface RoomCallResult {
  ok: boolean;
  status?: number;
  body?: unknown;
  error?: string;
}

function realtimeHost(): string | null {
  return process.env.REALTIME_HOST ?? process.env.NEXT_PUBLIC_REALTIME_HOST ?? null;
}

/**
 * 룸에 명령을 보낸다. 호스트가 없으면(로컬 개발·Worker 미배포) 조용히 넘어간다 —
 * 실시간 알림이 없을 뿐 DB 기준 동작은 유지된다.
 */
export async function sendRoomCommand(
  room: string, command: RoomCommand, timeoutMs = 4000
): Promise<RoomCallResult> {
  const host = realtimeHost();
  if (!host) return { ok: false, error: 'REALTIME_HOST 미설정 (실시간 통지 생략)' };
  // 시크릿이 없으면 서명할 수 없다. serverSecret() 이 던지므로 여기서 먼저 걸러야
  // 잠금 토글 같은 기존 기능이 500 으로 죽지 않는다.
  if (!isRealtimeConfigured()) return { ok: false, error: '실시간 미구성 (통지 생략)' };

  const payload = JSON.stringify({ room, command });
  const { signature, timestamp } = await signServerRequest(payload, serverSecret());

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    // 룸 경로를 URL 에 넣어야 Worker 가 해당 Durable Object 로 넘긴다.
    // `/control` 단독은 라우터에 매칭되지 않아 항상 404 가 된다.
    const url = `${host.replace(/\/$/, '')}/rooms/${encodeURIComponent(room)}/control`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-realtime-signature': signature,
        'x-realtime-timestamp': timestamp
      },
      body: payload,
      signal: ctl.signal
    });
    const body = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, body };
  } catch (e) {
    return { ok: false, error: String(e) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 잠금 확정 — freeze → 최종 flush → 커밋 → 방송.
 *
 * 순서가 중요하다. freeze 없이 flush 하면 flush 도중 도착한 편집이 확정본에서 빠지고,
 * 커밋 전에 방송하면 커밋이 실패했을 때 사용자만 잠긴 줄 안다.
 */
export async function freezeRoomForLock(room: string): Promise<RoomCallResult> {
  return sendRoomCommand(room, { type: 'freeze' });
}

export async function announceLocked(room: string, writeEpoch: number): Promise<RoomCallResult> {
  return sendRoomCommand(room, { type: 'locked', writeEpoch });
}

export async function announceUnlocked(room: string, writeEpoch: number): Promise<RoomCallResult> {
  return sendRoomCommand(room, { type: 'unlocked', writeEpoch });
}

export async function unfreezeRoom(room: string): Promise<RoomCallResult> {
  return sendRoomCommand(room, { type: 'unfreeze' });
}

/**
 * 즉시 저장. 디바운스(최대 6초)를 기다리지 않고 지금 DB 에 반영한다.
 * 사용자가 [저장]을 눌렀을 때 쓴다 — 자동 저장이 있어도 눌러서 확인하고 싶어 한다.
 */
export async function flushRoom(room: string): Promise<RoomCallResult> {
  return sendRoomCommand(room, { type: 'flush' });
}
