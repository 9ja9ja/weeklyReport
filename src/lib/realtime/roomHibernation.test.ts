/**
 * 하이버네이션에서 깨어난 룸이 편집을 저장하는가.
 *
 * Cloudflare WebSocket Hibernation 은 소켓을 열어둔 채 Durable Object 를 메모리에서 내린다.
 * 다시 깨어날 때 partyserver 가 부르는 것은 onStart(→onLoad)와 onMessage 뿐이고,
 * **이미 열려 있던 연결에 대해서는 onConnect 를 다시 부르지 않는다.**
 * 그래서 문서 변경 감시(dirtySinceSave·dirtyUserIds)를 onConnect 에서만 걸면
 * 깨어난 뒤의 모든 편집이 "변경 없음"으로 판정돼 조용히 저장되지 않는다.
 *
 * 이 파일만 party/(Worker) 코드를 가져오므로 루트 tsconfig 의 exclude 에 넣어 뒀다 —
 * party 는 @cloudflare/workers-types 가 필요해 앱 타입체크에 끌어들이면 깨진다.
 * Worker 쪽 타입은 party/tsconfig.json 이 따로 검사한다.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';

// y-partyserver 의 YServer 를 실제 생명주기와 같은 순서로 흉내낸다.
// (onStart: onLoad 결과를 this.document 에 반영 → 그 뒤에 자체 update 리스너 등록)
vi.mock('y-partyserver', async () => {
  const Yjs = await import('yjs');
  class FakeYServer {
    name = '';
    env: Record<string, string> = {} as Record<string, string>;
    document = new Yjs.Doc();
    connections: unknown[] = [];

    constructor(env?: Record<string, string>) {
      if (env) this.env = env;
    }

    async onLoad(): Promise<Y.Doc | void> {}
    async onSave(): Promise<void> {}

    async onStart(): Promise<void> {
      const src = await this.onLoad();
      if (src != null) Yjs.applyUpdate(this.document, Yjs.encodeStateAsUpdate(src as Y.Doc));
      // 실제 구현은 여기서 자체 update 리스너(동기화 브로드캐스트 + 디바운스 onSave)를 건다.
      // 테스트에서는 onSave 를 직접 호출해 디바운스 발화를 대신한다.
    }

    async onConnect(): Promise<void> {}

    /** 실제로는 Yjs sync 프로토콜 메시지지만, 여기서는 raw update 로 단순화한다 */
    async onMessage(_conn: unknown, message: Uint8Array): Promise<void> {
      Yjs.applyUpdate(this.document, message);
    }

    async onClose(): Promise<void> {}

    getConnections() { return this.connections; }
    sendCustomMessage() {}
    broadcastCustomMessage() {}
    isReadOnly() { return false; }
  }
  return { YServer: FakeYServer };
});

const ROOM = 'production-report-t5-2026-w35-g1';
const ENV = {
  REALTIME_TOKEN_SECRET: 'token-secret-token-secret-token-secret',
  REALTIME_SERVER_SECRET: 'server-secret-server-secret-server-secret',
  NEXT_APP_URL: 'https://example.test'
};

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

/** DB 에 저장돼 있는 초기 문서 — 카테고리 하나에 기존 블록 하나 */
function seedDoc(): Y.Doc {
  const doc = new Y.Doc();
  const cats = doc.getMap('cats');
  const cat = new Y.Map();
  cat.set('current', new Y.Map());
  cat.set('next', new Y.Map());
  cats.set('38', cat);
  return doc;
}

/** 사용자가 한 줄 쓴 것과 같은 문서 변경을 update 바이트로 만든다 */
function editUpdate(base: Y.Doc, authorId: number): Uint8Array {
  const draft = new Y.Doc();
  Y.applyUpdate(draft, Y.encodeStateAsUpdate(base));
  const before = Y.encodeStateVector(draft);
  const cur = (draft.getMap('cats').get('38') as Y.Map<unknown>).get('current') as Y.Map<unknown>;
  const block = new Y.Map();
  block.set('type', 'sub');
  block.set('order', 'a0');
  block.set('authorId', authorId);
  block.set('authorText', '양병석');
  block.set('subText', new Y.Text('공통'));
  block.set('bullets', new Y.Map());
  cur.set('blk1', block);
  return Y.encodeStateAsUpdate(draft, before);
}

function makeConnection(uid: number) {
  return {
    id: `c${uid}`,
    state: { uid, name: '양병석', readOnly: false, master: false, exp: Math.floor(Date.now() / 1000) + 3600 },
    setState(s: unknown) { (this as { state: unknown }).state = s; return s; },
    close() {},
    readyState: 1,
    send() {}
  };
}

interface SaveCall { dirtyUserIds: number[]; ydoc: string; room: string }

let saveCalls: SaveCall[] = [];
let stored: Y.Doc;

beforeEach(() => {
  saveCalls = [];
  stored = seedDoc();
  vi.stubGlobal('fetch', async (url: string, init: { body: string }) => {
    const body = JSON.parse(init.body);
    if (String(url).endsWith('/api/realtime/doc')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ydoc: bytesToBase64(Y.encodeStateAsUpdate(stored)),
          docGeneration: 1, writeEpoch: 1, revision: 5, isLocked: false, seedId: 'seed-1'
        })
      };
    }
    if (String(url).endsWith('/api/realtime/save')) {
      saveCalls.push({ dirtyUserIds: body.dirtyUserIds ?? [], ydoc: body.ydoc, room: body.room });
      return {
        ok: true, status: 200,
        json: async () => ({ ok: true, revision: 6, docGeneration: 1, writeEpoch: 1 })
      };
    }
    throw new Error(`예상하지 못한 호출: ${url}`);
  });
});

afterEach(() => { vi.unstubAllGlobals(); });

async function newRoom(roomName: string = ROOM) {
  const { WeeklyRoom } = await import('../../../party/index');
  // 생성자는 (ctx, env) 를 받지만 Fake 는 env 만 쓴다
  const room = new (WeeklyRoom as unknown as new (env: unknown) => Record<string, unknown>)(ENV);
  (room as unknown as { name: string }).name = roomName;
  (room as unknown as { env: unknown }).env = ENV;
  return room as unknown as {
    name: string;
    env: unknown;
    /** 실제로는 DurableObjectState — 테스트는 알림 스로틀이 쓰는 storage 만 흉내낸다 */
    ctx: unknown;
    connections: unknown[];
    broadcastCustomMessage: (msg: string) => void;
    onStart(): Promise<void>;
    onConnect(conn: unknown, ctx: unknown): Promise<void>;
    onMessage(conn: unknown, msg: Uint8Array): Promise<void>;
    onSave(): Promise<void>;
    onRequest(request: Request): Promise<Response>;
    document: Y.Doc;
  };
}

/** Next → 룸 제어 요청 (서버간 서명) */
async function controlRequest(command: Record<string, unknown>): Promise<Request> {
  const { signServerRequest } = await import('./token');
  const body = JSON.stringify({ room: ROOM, command });
  const { signature, timestamp } = await signServerRequest(body, ENV.REALTIME_SERVER_SECRET);
  return new Request('https://room.test/parties/main/room/control', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-realtime-signature': signature,
      'x-realtime-timestamp': timestamp
    },
    body
  });
}

describe('룸 하이버네이션 이후 저장', () => {
  it('깨어난 뒤(onConnect 없이 onStart 만) 들어온 편집도 저장된다', async () => {
    const room = await newRoom();
    const conn = makeConnection(21);
    // 소켓은 살아 있으므로 연결 목록에는 남아 있다 — 다만 onConnect 는 다시 불리지 않는다
    room.connections = [conn];

    await room.onStart();                                   // 하이버네이션 깨어남
    await room.onMessage(conn, editUpdate(stored, 21));     // 사용자가 한 줄 씀
    await room.onSave();                                    // 디바운스 발화

    expect(saveCalls.length).toBe(1);
  });

  it('깨어난 뒤의 편집도 작성자(dirtyUserIds)로 기록된다', async () => {
    const room = await newRoom();
    const conn = makeConnection(21);
    room.connections = [conn];

    await room.onStart();
    await room.onMessage(conn, editUpdate(stored, 21));
    await room.onSave();

    expect(saveCalls[0]?.dirtyUserIds).toEqual([21]);
  });

  it('새로 접속한 경우(기존 경로)도 그대로 저장된다', async () => {
    const room = await newRoom();
    const conn = makeConnection(21);
    room.connections = [conn];

    const { signToken } = await import('./token');
    const token = await signToken({
      uid: 21, name: '양병석', kind: 'report', env: 'production',
      teamId: 5, year: 2026, weekNum: 35, gen: 1,
      readOnly: false, master: false, exp: Math.floor(Date.now() / 1000) + 3600
    }, ENV.REALTIME_TOKEN_SECRET);

    await room.onStart();
    await room.onConnect(conn, {
      request: new Request(`https://example.test/?token=${encodeURIComponent(token)}`)
    });
    await room.onMessage(conn, editUpdate(stored, 21));
    await room.onSave();

    expect(saveCalls.length).toBe(1);
    expect(saveCalls[0]?.dirtyUserIds).toEqual([21]);
  });

  it('변경이 없으면 디바운스 저장은 건너뛴다 (불필요한 revision 증가 방지)', async () => {
    const room = await newRoom();
    room.connections = [makeConnection(21)];

    await room.onStart();
    await room.onSave();

    expect(saveCalls.length).toBe(0);
  });
});

/**
 * 요약본(Brief)도 같은 WeeklyRoom 클래스·같은 flush() 를 지난다.
 * 게다가 요약본은 소수가 오래 열어두고 쓰는 편이라, 남이 새로 접속해 감시를
 * 되살려 줄 확률이 낮다 — 하이버네이션 피해가 주간보고보다 크다.
 */
describe('요약본 룸도 같은 경로로 저장된다', () => {
  const BRIEF_ROOM = 'production-brief-2026-w35-g1';

  /** 요약본은 본문이 블록 JSON 이 아니므로 단순 텍스트 변경으로 편집을 흉내낸다 */
  function briefEdit(base: Y.Doc): Uint8Array {
    const draft = new Y.Doc();
    Y.applyUpdate(draft, Y.encodeStateAsUpdate(base));
    const before = Y.encodeStateVector(draft);
    draft.getText('brief').insert(0, '이번 주 요약 한 줄');
    return Y.encodeStateAsUpdate(draft, before);
  }

  it('깨어난 뒤 들어온 요약본 편집도 저장된다', async () => {
    const room = await newRoom(BRIEF_ROOM);
    const conn = makeConnection(39);
    room.connections = [conn];

    await room.onStart();
    await room.onMessage(conn, briefEdit(stored));
    await room.onSave();

    expect(saveCalls.length).toBe(1);
    expect(saveCalls[0]?.room).toBe(BRIEF_ROOM);
    expect(saveCalls[0]?.dirtyUserIds).toEqual([39]);
  });
});

describe('[저장] 버튼(manual flush)', () => {
  /**
   * 변경 감시가 어긋난 상태에서도 눌린 저장은 반드시 DB 에 남아야 한다.
   * 여기서 건너뛰면 사용자에게 "저장되었습니다"만 뜨고 아무것도 안 남는다.
   */
  it('변경 플래그와 무관하게 실제로 저장한다', async () => {
    const room = await newRoom();
    room.connections = [makeConnection(21)];

    await room.onStart();
    const res = await room.onRequest(await controlRequest({ type: 'flush' }));

    expect(saveCalls.length).toBe(1);
    expect(await res.json()).toMatchObject({ ok: true });
  });

  it('깨어난 뒤 편집분도 저장 버튼으로 즉시 반영된다', async () => {
    const room = await newRoom();
    const conn = makeConnection(21);
    room.connections = [conn];

    await room.onStart();                                   // 하이버네이션 깨어남
    await room.onMessage(conn, editUpdate(stored, 21));     // 한 줄 씀
    await room.onRequest(await controlRequest({ type: 'flush' }));

    expect(saveCalls.length).toBe(1);
    expect(saveCalls[0]?.dirtyUserIds).toEqual([21]);
  });
});

/**
 * 구세대 룸 은퇴.
 *
 * 취합본 저장(restore)은 DB 세대를 올린 **뒤** 방금 구세대가 된 룸에 generation 명령을 보낸다.
 * partyserver 는 그 요청을 처리하기 전에 onStart→onLoad 를 먼저 돌리므로, 메모리에 없던
 * 구세대 룸은 onLoad 에서 "세대가 다릅니다" 409 를 만난다. 이건 장애가 아니라 정상 은퇴다 —
 * 알리지 않고, 남은 접속자를 새 룸으로 보내야 한다. (2026-09-04 텔레그램 알림 8건의 원인.
 * onLoad 가 알림 후 던지기만 해서 kick 이 한 번도 전달되지 않았다.)
 */
describe('구세대 룸 은퇴 (onLoad 409)', () => {
  const OLD_ROOM = 'production-report-t6-2026-w36-g2';
  const ALERT_ENV = { ...ENV, TELEGRAM_BOT_TOKEN: 'bot-token', TELEGRAM_CHAT_ID: '-100' };
  const GENERATION_MISMATCH = '세대가 다릅니다. 새 룸으로 접속해야 합니다.';

  let telegramCalls = 0;
  let docResponse: { ok: boolean; status: number; body: Record<string, unknown> };

  function stubFetch() {
    vi.stubGlobal('fetch', async (url: string, init: { body: string }) => {
      const u = String(url);
      if (u.startsWith('https://api.telegram.org/')) {
        telegramCalls++;
        return { ok: true, status: 200, json: async () => ({ ok: true }) };
      }
      if (u.endsWith('/api/realtime/doc')) {
        return { ok: docResponse.ok, status: docResponse.status, json: async () => docResponse.body };
      }
      if (u.endsWith('/api/realtime/save')) {
        const body = JSON.parse(init.body);
        saveCalls.push({ dirtyUserIds: body.dirtyUserIds ?? [], ydoc: body.ydoc, room: body.room });
        return { ok: true, status: 200, json: async () => ({ ok: true, revision: 6, docGeneration: 1, writeEpoch: 1 }) };
      }
      throw new Error(`예상하지 못한 호출: ${url}`);
    });
  }

  /** 알림이 실제로 나가는지 보려면 스로틀 스토리지와 텔레그램 시크릿이 있어야 한다 */
  async function oldRoom() {
    const room = await newRoom(OLD_ROOM);
    room.env = ALERT_ENV;
    const store = new Map<string, unknown>();
    room.ctx = { storage: {
      get: async (k: string) => store.get(k),
      put: async (k: string, v: unknown) => { store.set(k, v); }
    } };
    return room;
  }

  beforeEach(() => {
    telegramCalls = 0;
    // DB 는 이미 세대 3 — 이 룸(g2)은 구세대다
    docResponse = { ok: false, status: 409, body: { error: GENERATION_MISMATCH, docGeneration: 3 } };
    stubFetch();
  });

  it('DB 세대가 룸 세대보다 크면 텔레그램 알림을 보내지 않는다', async () => {
    const room = await oldRoom();

    await expect(room.onStart()).rejects.toThrow();

    expect(telegramCalls).toBe(0);
  });

  it('남아 있던 접속자에게 generation-changed 를 방송하고 4404 로 닫는다', async () => {
    const room = await oldRoom();
    const conn = makeConnection(31);
    conn.close = vi.fn();
    room.connections = [conn];
    const sent: string[] = [];
    room.broadcastCustomMessage = (m: string) => { sent.push(m); };

    await expect(room.onStart()).rejects.toThrow();

    expect(conn.close).toHaveBeenCalledWith(4404, expect.any(String));
    expect(sent.map(s => JSON.parse(s))).toContainEqual({ type: 'generation-changed', docGeneration: 3 });
  });

  it('은퇴한 룸은 편집 메시지가 와도 저장하지 않는다 (빈 문서 저장 금지)', async () => {
    const room = await oldRoom();
    const conn = makeConnection(31);
    room.connections = [conn];

    await expect(room.onStart()).rejects.toThrow();
    await room.onMessage(conn, editUpdate(stored, 31));
    await room.onSave();

    expect(saveCalls.length).toBe(0);
  });

  it('409 라도 DB 세대가 룸 세대보다 작으면(문서 재생성 이상) 기존대로 알린다', async () => {
    docResponse = { ok: false, status: 409, body: { error: GENERATION_MISMATCH, docGeneration: 1 } };
    const room = await oldRoom();

    await expect(room.onStart()).rejects.toThrow();

    expect(telegramCalls).toBe(1);
  });

  it('409 가 아닌 실패(5xx)는 기존대로 알린다', async () => {
    docResponse = { ok: false, status: 503, body: { error: 'unavailable' } };
    const room = await oldRoom();

    await expect(room.onStart()).rejects.toThrow();

    expect(telegramCalls).toBe(1);
  });
});

/**
 * 살아있는(warm) 룸이 뒤늦게 세대 불일치를 아는 경우.
 *
 * generation 명령이 타임아웃으로 못 닿았거나(backfill 처럼 통지 자체가 없는 경로도 있다)
 * 구토큰으로 재접속한 사람이 있으면, 룸은 다음 저장에서 generation-mismatch 로 처음 안다.
 * 그때도 접속자를 내보내고 저장을 멈춰야 옛 문서를 계속 방송하지 않는다.
 */
describe('살아있는 룸이 저장 중 세대 불일치를 만나면 은퇴한다', () => {
  let saveResponse: { ok: boolean; status: number; body: Record<string, unknown> };
  let docResponse: { ok: boolean; status: number; body: Record<string, unknown> };

  beforeEach(() => {
    saveResponse = { ok: true, status: 200, body: { ok: true, revision: 6, docGeneration: 1, writeEpoch: 1 } };
    docResponse = { ok: true, status: 200, body: {
      ydoc: bytesToBase64(Y.encodeStateAsUpdate(stored)),
      docGeneration: 1, writeEpoch: 1, revision: 5, isLocked: false, seedId: 'seed-1'
    } };
    vi.stubGlobal('fetch', async (url: string, init: { body: string }) => {
      const u = String(url);
      if (u.endsWith('/api/realtime/doc')) {
        return { ok: docResponse.ok, status: docResponse.status, json: async () => docResponse.body };
      }
      if (u.endsWith('/api/realtime/save')) {
        const body = JSON.parse(init.body);
        saveCalls.push({ dirtyUserIds: body.dirtyUserIds ?? [], ydoc: body.ydoc, room: body.room });
        return { ok: saveResponse.ok, status: saveResponse.status, json: async () => saveResponse.body };
      }
      throw new Error(`예상하지 못한 호출: ${url}`);
    });
  });

  /** 룸이 정상 시작한 뒤 DB 세대가 2 로 올라간 상황을 만든다 */
  function generationMovedOn() {
    docResponse = { ok: false, status: 409, body: { error: '세대가 다릅니다. 새 룸으로 접속해야 합니다.', docGeneration: 2 } };
  }

  for (const reason of ['generation-mismatch', 'epoch-mismatch'] as const) {
    it(`저장이 ${reason} 로 거부되고 DB 세대가 올라가 있으면 접속자를 4404 로 내보낸다`, async () => {
      const room = await newRoom();
      const conn = makeConnection(21);
      conn.close = vi.fn();
      room.connections = [conn];

      await room.onStart();                                   // DB 세대 1 — 정상 시작
      await room.onMessage(conn, editUpdate(stored, 21));
      saveResponse = { ok: false, status: 409, body: { reason } };
      generationMovedOn();
      await room.onSave();

      expect(conn.close).toHaveBeenCalledWith(4404, expect.any(String));
    });

    it(`${reason} 뒤 은퇴한 룸은 이후 편집을 저장하지 않는다`, async () => {
      const room = await newRoom();
      const conn = makeConnection(21);
      room.connections = [conn];

      await room.onStart();
      await room.onMessage(conn, editUpdate(stored, 21));
      saveResponse = { ok: false, status: 409, body: { reason } };
      generationMovedOn();
      await room.onSave();                                    // 거부 → 은퇴
      const rejected = saveCalls.length;

      saveResponse = { ok: true, status: 200, body: { ok: true, revision: 7, docGeneration: 1, writeEpoch: 1 } };
      await room.onMessage(conn, editUpdate(stored, 21));
      await room.onSave();

      expect(saveCalls.length).toBe(rejected);
    });
  }
});
