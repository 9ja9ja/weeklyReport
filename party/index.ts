/**
 * 실시간 공동 편집 룸 (Cloudflare Durable Object).
 *
 * 스파이크에서 확인한 y-partyserver 2.2.0 의 한계를 여기서 메운다.
 *  1. DO storage 영속 계층이 없다 → 영속화는 전적으로 onLoad/onSave 몫
 *  2. 마지막 접속자가 나가도 flush 하지 않는다 → onClose 에서 직접 flush
 *  3. onSave 실패는 console.error 로 삼켜진다 → 재시도 + 클라이언트 ACK
 *
 * 권한 판정은 서버가 발급한 토큰으로만 한다. Y.Doc 의 meta.isLocked 는 클라이언트가
 * 바꿀 수 있으므로 표시용일 뿐이다.
 */
import type { Connection, ConnectionContext, WSMessage } from 'partyserver';
import { YServer } from 'y-partyserver';
import * as Y from 'yjs';
import {
  verifyToken, signServerRequest, verifyServerRequest, parseRoomName, roomNameOf,
  type RealtimeTokenPayload, type RoomKey
} from '../src/lib/realtime/token';

export interface Env {
  /** 사용자 접속 토큰 서명키 */
  REALTIME_TOKEN_SECRET: string;
  /** Worker ↔ Next 서버간 시크릿 (토큰 키와 분리) */
  REALTIME_SERVER_SECRET: string;
  /** Next 앱 주소 */
  NEXT_APP_URL: string;
  WeeklyRoom: DurableObjectNamespace;
}

/** 연결에 붙여두는 상태 */
interface ConnState {
  uid: number;
  name: string;
  readOnly: boolean;
  master: boolean;
  /** 토큰 만료 — 매 메시지마다 확인해 만료된 연결을 끊는다 */
  exp: number;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
function base64ToBytes(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * 토큰이 이 룸의 것인지 확인한다.
 * 룸 이름은 누구나 추측할 수 있으므로, 토큰에 담긴 문서 좌표와 정확히 일치해야만 통과시킨다.
 */
function tokenMatchesRoom(claims: RealtimeTokenPayload, key: RoomKey | null): boolean {
  if (!key) return false;
  if (claims.kind !== key.kind) return false;
  if (claims.env !== key.env) return false;
  if (claims.year !== key.year || claims.weekNum !== key.weekNum || claims.gen !== key.gen) return false;
  if (key.kind === 'report' && claims.teamId !== key.teamId) return false;
  return true;
}

export class WeeklyRoom extends YServer<Env> {
  /**
   * WebSocket Hibernation 활성화.
   *
   * hibernate: false(기본값)면 idle WebSocket 이 열려 있는 동안에도 DO 벽시계 시간이
   * 계속 흘러 무료 플랜 한도(13,000 GB-s/일)를 금세 소진한다.
   * true 로 두면 메시지가 없는 동안 DO 가 잠들어 벽시계 시간이 0 이 되고,
   * 메시지가 오면 자동으로 깨어나 처리한다.
   */
  static options = { hibernate: true };

  /** 저장 디바운스 — 짧게 둔다. DO 가 사라지면 되살릴 사본이 없다(스파이크 C1) */
  static callbackOptions = { debounceWait: 2000, debounceMaxWait: 6000 };

  /** 잠금 확정 중에는 새 편집을 받지 않는다 */
  private frozen = false;
  /** 서버가 확인한 잠금 상태 (표시용 meta 와 별개) */
  private locked = false;
  /** 저장 fencing */
  private writeEpoch = 1;
  private docGeneration = 1;
  /** 마지막으로 DB 에 반영된 revision — 클라이언트 ACK 기준 */
  private revision = 0;
  /** 이번 저장분을 실제로 편집한 사용자들. ACK 성공 후에만 비운다 */
  private dirtyUserIds = new Set<number>();
  private loaded = false;
  /** 지금 처리 중인 메시지를 보낸 연결 — 문서 변경의 출처를 알아내려고 잠시 들고 있는다 */
  private pendingOrigin: Connection<ConnState> | null = null;
  /** update 구독을 한 번만 걸기 위한 표시 */
  private watchingUpdates = false;
  /**
   * 콜드스타트 때 받은 문서 식별자.
   * DB 문서가 지워졌다 다시 만들어지면 세대·에폭이 1 로 되돌아가 fencing 이 통하지 않으므로,
   * 저장할 때마다 이 값을 함께 보내 "같은 문서인지"를 서버가 확인하게 한다.
   */
  private seedId = '';
  /**
   * 마지막 성공 저장 이후 문서가 바뀌었는가.
   * [저장] 버튼은 HTTP 로 언제든 부를 수 있는데, 변경이 없어도 매번 저장하면
   * ydoc 디코드·HTML 재생성·revision 증가·영수증 삽입이 그대로 돌아 advisory lock 을 붙잡는다.
   */
  private dirtySinceSave = false;

  private get roomKey() {
    return parseRoomName(this.name);
  }

  // ── 영속화 ────────────────────────────────────────────────

  /** 룸 콜드스타트 — DB 에서 초기 상태를 가져온다 */
  async onLoad(): Promise<Y.Doc | void> {
    const res = await this.callNext('/api/realtime/doc', { room: this.name });
    if (!res.ok) {
      // 상태를 못 받으면 빈 문서로 열지 않는다. 빈 문서가 저장되면 내용이 날아간다.
      throw new Error(`룸 초기 상태 로드 실패: ${res.status}`);
    }
    const data = res.data as {
      ydoc: string; docGeneration: number; writeEpoch: number; revision: number;
      isLocked: boolean; seedId?: string;
    };

    this.seedId = data.seedId ?? '';
    this.docGeneration = data.docGeneration;
    this.writeEpoch = data.writeEpoch;
    this.revision = data.revision;
    this.locked = data.isLocked;
    this.loaded = true;

    const doc = new Y.Doc();
    Y.applyUpdate(doc, base64ToBytes(data.ydoc));
    return doc;
  }

  /**
   * 실제 문서 변경이 일어났을 때만 기여자로 기록한다.
   * y-partyserver 가 onStart 에서 this.document 를 구성한 뒤여야 구독할 수 있어,
   * 첫 연결 시점에 한 번 건다.
   */
  private watchUpdates() {
    if (this.watchingUpdates) return;
    this.watchingUpdates = true;
    this.document.on('update', () => {
      this.dirtySinceSave = true;
      const st = this.pendingOrigin?.state;
      if (st) this.dirtyUserIds.add(st.uid);
    });
  }

  /** 디바운스 저장. 실패하면 던져서 재시도 대상임을 남긴다 */
  async onSave(): Promise<void> {
    await this.flush('debounce');
  }

  /**
   * 실제 저장 + ACK.
   *
   * y-partyserver 는 onSave 실패를 삼키므로, 성공 여부를 여기서 직접 관리하고
   * 클라이언트에 revision 을 알린다. "저장됨" 표시는 이 값 기준이다.
   */
  private async flush(reason: 'debounce' | 'close' | 'lock' | 'manual'): Promise<boolean> {
    if (!this.loaded) return false;
    // 룸 종류(report/brief)에 무관하게 같은 경로로 저장한다 —
    // Next 의 /api/realtime/save 가 룸 이름을 보고 알아서 분기한다.
    if (!this.roomKey) return false;
    // 바뀐 게 없으면 저장하지 않는다. 잠금 확정(lock)은 상태를 확정해야 하므로 예외.
    if (!this.dirtySinceSave && reason !== 'lock') {
      this.broadcastControl({ type: 'saved', revision: this.revision, at: Date.now(), noop: true });
      return true;
    }

    const update = Y.encodeStateAsUpdate(this.document);
    const dirty = [...this.dirtyUserIds];

    const payload = {
      room: this.name,
      ydoc: bytesToBase64(update),
      requestId: crypto.randomUUID(),
      docGeneration: this.docGeneration,
      writeEpoch: this.writeEpoch,
      op: 'normal' as const,
      seedId: this.seedId,
      dirtyUserIds: dirty
    };

    let lastError = '';
    // 지수 백오프 재시도 — 저장 실패를 조용히 넘기면 유실로 이어진다
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await this.callNext('/api/realtime/save', payload);
      if (res.ok) {
        const data = res.data as {
          revision: number; writeEpoch: number; docGeneration: number; deduped?: boolean;
        };
        this.revision = data.revision;
        // deduped 응답은 '기록 시점' 세대를 돌려준다(설계상 의도). 그대로 받으면 epoch 이 뒤로 간다.
        if (!data.deduped) {
          this.writeEpoch = data.writeEpoch;
          this.docGeneration = data.docGeneration;
        }
        // ACK 성공 후에만 비운다. 먼저 비우면 저장 실패 시 작성 현황이 누락된다.
        for (const id of dirty) this.dirtyUserIds.delete(id);
        this.dirtySinceSave = false;
        this.broadcastControl({ type: 'saved', revision: this.revision, at: Date.now() });
        return true;
      }

      const reasonCode = (res.data as { reason?: string } | null)?.reason;

      // 문서가 사라졌거나(롤백으로 행 삭제) 다른 문서로 교체됐다(재시드).
      // 이 룸의 Y.Doc 을 DB 에 얹으면 독립 생성된 두 문서가 병합돼 본문이 두 벌이 되고
      // 제목은 한쪽이 사라진다. 재시도하지 말고 룸을 비운다 —
      // 클라이언트는 새로고침해서 현재 문서로 다시 붙어야 한다.
      if (reasonCode === 'not-found' || reasonCode === 'seed-mismatch' || reasonCode === 'cutover-off') {
        this.broadcastControl({ type: 'stale-room', reason: reasonCode });
        for (const c of this.getConnections<ConnState>()) {
          c.close(4410, '문서가 교체되었습니다. 새로고침해주세요.');
        }
        return false;
      }

      // 세대/잠금 불일치는 재시도해도 소용없다 — 클라이언트에 알리고 멈춘다
      if (reasonCode === 'generation-mismatch' || reasonCode === 'epoch-mismatch' || reasonCode === 'locked') {
        this.broadcastControl({ type: 'save-rejected', reason: reasonCode });
        if (reasonCode === 'locked') this.locked = true;
        // 룸의 fencing 값이 DB 와 어긋났다. 다시 맞춰두지 않으면 이 DO 가 살아있는 내내
        // 모든 저장이 거부된다(콜드스타트 전까지 회복 불가).
        if (reasonCode === 'epoch-mismatch' || reasonCode === 'locked') await this.resync();
        return false;
      }
      lastError = `${res.status} ${reasonCode ?? ''}`;
      await new Promise(r => setTimeout(r, 200 * 2 ** attempt));
    }

    this.broadcastControl({ type: 'save-failed', detail: lastError, reason: reason });
    return false;
  }

  // ── 접속 ──────────────────────────────────────────────────

  async onConnect(connection: Connection<ConnState>, ctx: ConnectionContext): Promise<void> {
    const url = new URL(ctx.request.url);
    const token = url.searchParams.get('token');
    const claims = await verifyToken(token, this.env.REALTIME_TOKEN_SECRET);

    if (!claims) {
      connection.close(4401, '인증이 필요합니다.');
      return;
    }

    // 토큰이 가리키는 문서와 실제 룸이 같아야 한다. 룸 이름은 추측 가능하므로 여기서 막는다.
    if (!tokenMatchesRoom(claims, this.roomKey)) {
      connection.close(4403, '이 문서에 대한 토큰이 아닙니다.');
      return;
    }

    connection.setState({
      uid: claims.uid,
      name: claims.name,
      readOnly: claims.readOnly,
      master: claims.master,
      exp: claims.exp
    });

    await super.onConnect(connection, ctx);
    this.watchUpdates();

    // 현재 상태를 알려준다 (잠금·세대·마지막 저장)
    this.sendControl(connection, {
      type: 'hello',
      locked: this.locked,
      frozen: this.frozen,
      revision: this.revision,
      writeEpoch: this.writeEpoch,
      docGeneration: this.docGeneration
    });
  }

  /**
   * 쓰기 허용 여부. y-partyserver 가 **메시지마다** 호출하므로(스파이크 확인)
   * 재접속 없이 즉시 읽기전용으로 전환할 수 있다.
   */
  isReadOnly(connection: Connection<ConnState>): boolean {
    if (this.frozen || this.locked) return true;
    const st = connection.state;
    if (!st) return true;
    // 토큰 만료 — 세션이 끊긴 뒤에도 소켓이 살아 쓰기가 되는 것을 막는다
    if (st.exp < Math.floor(Date.now() / 1000)) return true;
    return st.readOnly;
  }

  async onMessage(connection: Connection<ConnState>, message: WSMessage): Promise<void> {
    const st = connection.state;
    // 만료된 연결은 끊는다. 타이머를 쓰면 DO 하이버네이션을 방해하므로 메시지마다 확인한다.
    if (st && st.exp < Math.floor(Date.now() / 1000)) {
      connection.close(4401, '토큰이 만료되었습니다. 다시 접속해주세요.');
      return;
    }
    // 기여자 기록은 여기서 하지 않는다. Yjs 는 접속 직후 sync·awareness(커서) 메시지를
    // 자동으로 보내므로, 메시지 도착만으로 판정하면 문서를 열어보기만 해도 '작성함'이 된다.
    // 대신 실제 문서 변경(document.on('update'))에서 origin 을 보고 기록한다.
    this.pendingOrigin = connection;
    try {
      await super.onMessage(connection, message);
    } finally {
      this.pendingOrigin = null;
    }
  }

  /**
   * 마지막 접속자가 나가면 강제 flush.
   * y-partyserver 는 onClose 에서 저장하지 않아, debounce 대기 중이던 편집이
   * DO 가 사라질 때 그대로 유실된다(스파이크 C2).
   */
  async onClose(connection: Connection<ConnState>, code: number, reason: string, wasClean: boolean): Promise<void> {
    await super.onClose(connection, code, reason, wasClean);
    const remaining = [...this.getConnections()].length;
    if (remaining === 0) await this.flush('close');
  }

  // ── 제어 (Next → 룸) ──────────────────────────────────────

  async onRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method !== 'POST' || !url.pathname.endsWith('/control')) {
      return new Response('Not found', { status: 404 });
    }

    const raw = await request.text();
    const ok = await verifyServerRequest(
      raw,
      request.headers.get('x-realtime-signature'),
      request.headers.get('x-realtime-timestamp'),
      this.env.REALTIME_SERVER_SECRET
    );
    if (!ok) return Response.json({ error: '서명이 유효하지 않습니다.' }, { status: 401 });

    let body: {
      room?: string;
      command?: { type: string; writeEpoch?: number; docGeneration?: number; userIds?: number[] };
    };
    // (freeze/flush 는 저장을 유발하므로 서명 검증을 통과한 요청에서만 도달한다)
    try { body = JSON.parse(raw); } catch { return Response.json({ error: 'bad body' }, { status: 400 }); }
    const cmd = body.command;
    if (!cmd?.type) return Response.json({ error: 'command 가 필요합니다.' }, { status: 400 });

    // 서명은 본문에만 걸려 있고 라우팅은 URL 로 결정된다. 대조하지 않으면
    // 한 번 확보한 서명을 URL 만 바꿔 다른 룸에 적용할 수 있다.
    if (body.room !== this.name) {
      return Response.json({ error: '룸이 일치하지 않습니다.' }, { status: 400 });
    }

    switch (cmd.type) {
      case 'freeze': {
        // 새 편집을 막고 그 시점 상태를 확정한다
        this.frozen = true;
        const saved = await this.flush('lock');
        this.broadcastControl({ type: 'frozen' });
        return Response.json({ ok: true, saved, revision: this.revision });
      }
      case 'unfreeze':
        this.frozen = false;
        this.broadcastControl({ type: 'unfrozen' });
        return Response.json({ ok: true });

      case 'flush': {
        // 사용자가 [저장]을 눌렀다. 디바운스를 기다리지 않고 지금 반영한다.
        const saved = await this.flush('manual');
        return Response.json({ ok: saved, revision: this.revision, locked: this.locked });
      }

      case 'locked':
        this.locked = true;
        this.frozen = false;   // 잠금이 확정됐으므로 freeze 는 풀어도 된다(잠금이 쓰기를 막는다)
        if (typeof cmd.writeEpoch === 'number') this.writeEpoch = cmd.writeEpoch;
        this.broadcastControl({ type: 'locked', writeEpoch: this.writeEpoch });
        return Response.json({ ok: true });

      case 'unlocked':
        this.locked = false;
        this.frozen = false;
        if (typeof cmd.writeEpoch === 'number') this.writeEpoch = cmd.writeEpoch;
        this.broadcastControl({ type: 'unlocked', writeEpoch: this.writeEpoch });
        return Response.json({ ok: true });

      case 'generation':
        // 복원됐다 — 이 룸은 구세대다. 모두 끊어 새 룸으로 옮기게 한다.
        this.broadcastControl({ type: 'generation-changed', docGeneration: cmd.docGeneration ?? null });
        for (const c of this.getConnections<ConnState>()) c.close(4404, '문서가 복원되었습니다. 다시 접속해주세요.');
        return Response.json({ ok: true });

      case 'revoke': {
        const ids = new Set(cmd.userIds ?? []);
        let closed = 0;
        for (const c of this.getConnections<ConnState>()) {
          const st = c.state;
          if (st && ids.has(st.uid)) { c.close(4403, '권한이 변경되었습니다.'); closed++; }
        }
        return Response.json({ ok: true, closed });
      }
      default:
        return Response.json({ error: `알 수 없는 command: ${cmd.type}` }, { status: 400 });
    }
  }

  // ── 헬퍼 ──────────────────────────────────────────────────

  /** DB 의 현재 세대·잠금 상태를 다시 읽어 룸 상태를 맞춘다 */
  private async resync(): Promise<void> {
    const res = await this.callNext('/api/realtime/doc', { room: this.name });
    if (!res.ok) return;
    const data = res.data as { docGeneration: number; writeEpoch: number; revision: number; isLocked: boolean };
    this.docGeneration = data.docGeneration;
    this.writeEpoch = data.writeEpoch;
    this.revision = data.revision;
    this.locked = data.isLocked;
    this.broadcastControl({
      type: 'resynced',
      locked: this.locked, writeEpoch: this.writeEpoch, revision: this.revision
    });
  }

  private sendControl(connection: Connection<ConnState>, msg: unknown) {
    this.sendCustomMessage(connection, JSON.stringify(msg));
  }
  private broadcastControl(msg: unknown) {
    this.broadcastCustomMessage(JSON.stringify(msg));
  }

  /** Next 로 서명된 요청을 보낸다 */
  private async callNext(path: string, payload: unknown): Promise<{ ok: boolean; status: number; data: unknown }> {
    const body = JSON.stringify(payload);
    const { signature, timestamp } = await signServerRequest(body, this.env.REALTIME_SERVER_SECRET);
    try {
      const res = await fetch(`${this.env.NEXT_APP_URL.replace(/\/$/, '')}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-realtime-signature': signature,
          'x-realtime-timestamp': timestamp
        },
        body
      });
      const data = await res.json().catch(() => null);
      return { ok: res.ok, status: res.status, data };
    } catch (e) {
      return { ok: false, status: 0, data: { reason: 'network', detail: String(e) } };
    }
  }
}

const handler = {
  /**
   * 라우팅 + **선인증**.
   *
   * partyserver 는 onConnect(토큰 검증)보다 먼저 onStart→onLoad 를 실행한다.
   * 그래서 여기서 걸러내지 않으면 인증 없는 요청 한 번으로 Durable Object 가 깨어나
   * Next 의 서명된 엔드포인트를 호출하게 된다. DO 로 넘기기 전에 막는다.
   */
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/health') return new Response('ok');

    // /rooms/{room}/...  또는  /parties/main/{room}/...
    const m = /^\/(?:rooms|parties\/main)\/([^/]+)(\/.*)?$/.exec(url.pathname);
    if (!m) return new Response('Not found', { status: 404 });

    const room = decodeURIComponent(m[1]);
    const key = parseRoomName(room);
    // 정규화 왕복 — 선행 0 등으로 다른 문자열이 같은 키로 해석되면
    // 별개의 DO 가 같은 DB 행을 공유하게 된다
    if (!key || roomNameOf(key) !== room) {
      return new Response('Bad room', { status: 400 });
    }

    const isControl = (m[2] ?? '').endsWith('/control');

    if (isControl) {
      // 제어 명령은 서버간 서명으로 인증한다. 본문을 여기서 읽으면 DO 가 다시 못 읽으므로
      // 복제해 검사하고 원본 스트림은 그대로 넘긴다.
      const body = await request.clone().text();
      const ok = await verifyServerRequest(
        body,
        request.headers.get('x-realtime-signature'),
        request.headers.get('x-realtime-timestamp'),
        env.REALTIME_SERVER_SECRET
      );
      if (!ok) return new Response('Unauthorized', { status: 401 });
    } else {
      // 사용자 접속(WebSocket) — 토큰이 이 룸의 것인지 확인한 뒤에만 DO 를 깨운다
      const claims = await verifyToken(url.searchParams.get('token'), env.REALTIME_TOKEN_SECRET);
      if (!claims) return new Response('Unauthorized', { status: 401 });
      if (!tokenMatchesRoom(claims, key)) return new Response('Forbidden', { status: 403 });
    }

    // partyserver 는 x-partykit-room / x-partykit-props 헤더를 신뢰한다.
    // 지금은 idFromName 을 쓰므로 무시되지만, 호출자가 붙인 값을 그대로 넘길 이유가 없다.
    const forwarded = new Request(request);
    forwarded.headers.delete('x-partykit-room');
    forwarded.headers.delete('x-partykit-props');

    const id = env.WeeklyRoom.idFromName(room);
    const stub = env.WeeklyRoom.get(id);
    return stub.fetch(forwarded);
  }
};

export default handler;
