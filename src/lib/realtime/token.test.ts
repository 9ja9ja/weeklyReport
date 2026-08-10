/**
 * 토큰·서버간 서명 검증. 여기가 뚫리면 임의 팀 문서를 편집·덮어쓸 수 있다.
 */
import { describe, it, expect } from 'vitest';
import {
  signToken, verifyToken, signServerRequest, verifyServerRequest,
  roomName, parseRoomName, SERVER_SIGNATURE_WINDOW_SEC,
  type RealtimeTokenPayload
} from './token';

const SECRET = 'test-secret-at-least-16-chars-long';
const OTHER = 'another-secret-at-least-16-chars';

const payload = (over: Partial<RealtimeTokenPayload> = {}): RealtimeTokenPayload => ({
  uid: 7, name: '방수진', env: 'test', teamId: 3, year: 2026, weekNum: 32,
  gen: 1, readOnly: false, master: false,
  exp: Math.floor(Date.now() / 1000) + 600,
  ...over
});


/** base64url ↔ UTF-8 (테스트에서 페이로드를 위조할 때 쓴다) */
function decodeBody(body: string): Record<string, unknown> {
  const pad = body.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(pad + '='.repeat((4 - (pad.length % 4)) % 4));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return JSON.parse(new TextDecoder().decode(bytes));
}
function encodeBody(obj: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

describe('접속 토큰', () => {
  it('서명한 토큰을 그대로 검증한다', async () => {
    const t = await signToken(payload(), SECRET);
    const got = await verifyToken(t, SECRET);
    expect(got).not.toBeNull();
    expect(got!.uid).toBe(7);
    expect(got!.teamId).toBe(3);
    expect(got!.name).toBe('방수진');
  });

  it('한글·특수문자 이름이 왕복에서 깨지지 않는다', async () => {
    for (const name of ['방수진', '허주희·김재영', 'Émile', '가나다ABC123', '이름에 공백']) {
      const t = await signToken(payload({ name }), SECRET);
      const got = await verifyToken(t, SECRET);
      expect(got?.name, name).toBe(name);
    }
  });

  it('다른 시크릿으로는 검증되지 않는다', async () => {
    const t = await signToken(payload(), SECRET);
    expect(await verifyToken(t, OTHER)).toBeNull();
  });

  it('페이로드를 고치면 서명이 깨진다 — 팀 위조 불가', async () => {
    const t = await signToken(payload({ teamId: 3 }), SECRET);
    const [body, sig] = t.split('.');
    const decoded = decodeBody(body);
    decoded.teamId = 999;   // 남의 팀으로 바꿔치기
    expect(await verifyToken(`${encodeBody(decoded)}.${sig}`, SECRET)).toBeNull();
  });

  it('readOnly 를 false 로 바꿔치기해도 서명이 깨진다', async () => {
    const t = await signToken(payload({ readOnly: true }), SECRET);
    const [body, sig] = t.split('.');
    const decoded = decodeBody(body);
    decoded.readOnly = false;
    expect(await verifyToken(`${encodeBody(decoded)}.${sig}`, SECRET)).toBeNull();
  });

  it('만료된 토큰은 거부한다', async () => {
    const t = await signToken(payload({ exp: Math.floor(Date.now() / 1000) - 1 }), SECRET);
    expect(await verifyToken(t, SECRET)).toBeNull();
  });

  it('형식이 깨진 값도 조용히 거부한다', async () => {
    for (const bad of ['', 'abc', 'a.b.c', '.', 'onlybody', null, undefined]) {
      expect(await verifyToken(bad as string, SECRET)).toBeNull();
    }
  });
});

describe('서버간 요청 서명', () => {
  it('본문과 타임스탬프를 함께 검증한다', async () => {
    const body = JSON.stringify({ a: 1 });
    const { signature, timestamp } = await signServerRequest(body, SECRET);
    expect(await verifyServerRequest(body, signature, timestamp, SECRET)).toBe(true);
  });

  it('본문이 바뀌면 거부한다', async () => {
    const { signature, timestamp } = await signServerRequest('{"a":1}', SECRET);
    expect(await verifyServerRequest('{"a":2}', signature, timestamp, SECRET)).toBe(false);
  });

  it('허용 창을 벗어난 오래된 서명은 거부한다 (재전송 방지)', async () => {
    const body = '{"a":1}';
    const old = Math.floor(Date.now() / 1000) - SERVER_SIGNATURE_WINDOW_SEC - 10;
    const { signature } = await signServerRequest(body, SECRET, old);
    expect(await verifyServerRequest(body, signature, String(old), SECRET)).toBe(false);
  });

  it('미래 시각도 창을 벗어나면 거부한다', async () => {
    const body = '{"a":1}';
    const future = Math.floor(Date.now() / 1000) + SERVER_SIGNATURE_WINDOW_SEC + 10;
    const { signature } = await signServerRequest(body, SECRET, future);
    expect(await verifyServerRequest(body, signature, String(future), SECRET)).toBe(false);
  });

  it('서명·타임스탬프 누락은 거부한다', async () => {
    expect(await verifyServerRequest('{}', null, '123', SECRET)).toBe(false);
    expect(await verifyServerRequest('{}', 'sig', null, SECRET)).toBe(false);
    expect(await verifyServerRequest('{}', 'sig', 'not-a-number', SECRET)).toBe(false);
  });

  it('사용자 토큰 시크릿으로는 서버간 서명이 통과하지 않는다 (키 분리)', async () => {
    const body = '{"a":1}';
    const { signature, timestamp } = await signServerRequest(body, SECRET);
    expect(await verifyServerRequest(body, signature, timestamp, OTHER)).toBe(false);
  });
});

describe('룸 이름', () => {
  it('환경·팀·주차·세대를 담고 되돌릴 수 있다', () => {
    const n = roomName('production', 3, 2026, 32, 1);
    expect(n).toBe('production-t3-2026-w32-g1');
    expect(parseRoomName(n)).toEqual({ env: 'production', teamId: 3, year: 2026, weekNum: 32, gen: 1 });
  });

  it('프리뷰 브랜치 이름의 특수문자를 안전하게 바꾼다', () => {
    const n = roomName('preview:feat/실시간', 1, 2026, 1, 2);
    expect(n).toMatch(/^[a-zA-Z0-9_-]+-t1-2026-w1-g2$/);
    expect(parseRoomName(n)?.teamId).toBe(1);
  });

  it('세대가 다르면 다른 룸이다 — 복원 시 클라이언트가 옮겨간다', () => {
    expect(roomName('production', 3, 2026, 32, 1)).not.toBe(roomName('production', 3, 2026, 32, 2));
  });

  it('환경이 다르면 다른 룸이다 — 프리뷰가 운영 룸에 못 들어간다', () => {
    expect(roomName('production', 3, 2026, 32, 1)).not.toBe(roomName('preview', 3, 2026, 32, 1));
  });

  it('형식이 어긋나면 null', () => {
    for (const bad of ['', 'nope', 't3-2026-w32-g1', 'env-t3-2026-w32']) {
      expect(parseRoomName(bad)).toBeNull();
    }
  });
});
