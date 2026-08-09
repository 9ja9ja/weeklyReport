/**
 * persistUpdate 통합 테스트 — 실제 Postgres 가 있어야 의미가 있다.
 * advisory lock·트랜잭션·멱등성은 mock 으로 확인할 수 없다.
 *
 * 실행:
 *   TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55432/wrtest npx vitest run src/lib/realtime/persist.test.ts
 * TEST_DATABASE_URL 이 없으면 통째로 skip 한다(CI 없이도 나머지 테스트는 돌아가게).
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import * as Y from 'yjs';
import { PrismaClient } from '@prisma/client';
import { buildDocFromState, type EditorState } from './buildDoc';
import { materialize } from './materialize';

import { resolveTestDatabaseUrl } from './testDb';

// 안전장치: 로컬 test DB 가 아니면 실행하지 않는다 (매 케이스마다 전 테이블 deleteMany 를 하므로)
const TEST_URL = resolveTestDatabaseUrl();
const d = TEST_URL ? describe : describe.skip;

// persist.ts 는 '../db' 의 싱글턴 prisma 를 쓰므로, 테스트 DB 를 가리키도록
// 모듈 로드 전에 DATABASE_URL 을 바꿔치기한다.
if (TEST_URL) process.env.DATABASE_URL = TEST_URL;

let prisma: PrismaClient;
let persistUpdate: typeof import('./persist').persistUpdate;

const ENV = 'test';
const TEAM = { year: 2026, weekNum: 32 };
let teamId = 0;
let userId = 0;

const SEED_STATE: EditorState = {
  '1': { current: [{ id: 'b1', type: 'sub', subText: '초기 내용', authorText: '', bullets: [] }] as never, next: [] }
};

function updateOf(doc: Y.Doc): Uint8Array {
  return Y.encodeStateAsUpdate(doc);
}
let rid = 0;
const nextRequestId = () => `req-${++rid}-${Math.random().toString(36).slice(2)}`;

d('persistUpdate (실제 Postgres)', () => {
  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: TEST_URL } } });
    ({ persistUpdate } = await import('./persist'));
  });

  afterAll(async () => { await prisma.$disconnect(); });

  beforeEach(async () => {
    // 매 테스트마다 깨끗한 상태 — FK 역순으로 정리
    await prisma.sharedDocSnapshot.deleteMany();
    await prisma.docActivity.deleteMany();
    await prisma.persistReceipt.deleteMany();
    await prisma.sharedDoc.deleteMany();
    await prisma.summaryData.deleteMany();
    await prisma.summaryLock.deleteMany();
    await prisma.userTeam.deleteMany();
    await prisma.user.deleteMany();
    await prisma.team.deleteMany();

    const team = await prisma.team.create({ data: { name: `팀-${Date.now()}-${Math.random()}` } });
    teamId = team.id;
    const user = await prisma.user.create({ data: { name: `사용자-${Math.random()}`, teamId } });
    userId = user.id;
  });

  const base = () => ({ environment: ENV, teamId, year: TEAM.year, weekNum: TEAM.weekNum });

  async function seed(state: EditorState = SEED_STATE) {
    const doc = buildDocFromState(state, { teamId, ...TEAM, seedId: 'seed-1' });
    const res = await persistUpdate({
      ...base(), update: updateOf(doc), requestId: nextRequestId(),
      op: 'seed', seedId: 'seed-1', seededFrom: 'test'
    });
    return { doc, res };
  }

  it('seed 로 문서를 만들고 contents 를 채운다', async () => {
    const { res } = await seed();
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.revision).toBe(1);

    const row = await prisma.sharedDoc.findUniqueOrThrow({
      where: { environment_teamId_year_weekNum: base() }
    });
    expect(JSON.parse(row.contents)['1'].current[0].subText).toBe('초기 내용');
    expect(row.seedId).toBe('seed-1');
  });

  it('비운영 환경에서는 SummaryData 미러를 쓰지 않는다 (환경 격리)', async () => {
    // SummaryData 에는 environment 컬럼이 없다. 프리뷰/개발이 미러를 쓰면 운영 취합본을 덮어쓴다.
    await seed();
    const mirror = await prisma.summaryData.findUnique({
      where: { teamId_year_weekNum: { teamId, ...TEAM } }
    });
    expect(mirror).toBeNull();
  });

  it('운영 환경에서는 SummaryData 미러를 같은 트랜잭션에서 함께 쓴다 (롤백 경로 유지)', async () => {
    const prodBase = { environment: 'production', teamId, year: TEAM.year, weekNum: TEAM.weekNum };
    const doc = buildDocFromState(SEED_STATE, { teamId, ...TEAM, seedId: 'seed-prod' });
    const res = await persistUpdate({
      ...prodBase, update: updateOf(doc), requestId: nextRequestId(),
      op: 'seed', seedId: 'seed-prod'
    });
    expect(res.ok).toBe(true);

    const mirror = await prisma.summaryData.findUnique({
      where: { teamId_year_weekNum: { teamId, ...TEAM } }
    });
    expect(mirror).not.toBeNull();
    expect(JSON.parse(mirror!.contents)['1'].current[0].subText).toBe('초기 내용');
  });

  it('이미 시드된 문서에 다른 seedId 로 seed 하면 거부한다 (재시드 가드)', async () => {
    await seed();
    const other = buildDocFromState(
      { '1': { current: [{ id: 'zz', type: 'sub', subText: '다른 시드', authorText: '', bullets: [] }] as never, next: [] } },
      { teamId, ...TEAM, seedId: 'seed-2' }
    );
    const res = await persistUpdate({
      ...base(), update: updateOf(other), requestId: nextRequestId(), op: 'seed', seedId: 'seed-2'
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('already-seeded');

    // 원본이 그대로 남아야 한다
    const row = await prisma.sharedDoc.findUniqueOrThrow({ where: { environment_teamId_year_weekNum: base() } });
    const ids = JSON.parse(row.contents)['1'].current.map((b: { id: string }) => b.id);
    expect(ids).toEqual(['b1']);
  });

  it('같은 seedId 재시드는 멱등하게 성공 처리한다', async () => {
    await seed();
    const same = buildDocFromState(SEED_STATE, { teamId, ...TEAM, seedId: 'seed-1' });
    const res = await persistUpdate({
      ...base(), update: updateOf(same), requestId: nextRequestId(), op: 'seed', seedId: 'seed-1'
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.deduped).toBe(true);
  });

  it('restore 는 병합이 아니라 치환이라 삭제된 내용이 되살아난다', async () => {
    const { doc } = await seed();
    const cleanSnapshot = updateOf(doc);   // b1 이 있는 시점

    // 사용자가 b1 을 지우고 다른 걸 넣는다
    const edited = new Y.Doc();
    Y.applyUpdate(edited, cleanSnapshot);
    const cur = (edited.getMap('cats').get('1') as Y.Map<unknown>).get('current') as Y.Map<unknown>;
    edited.transact(() => {
      cur.delete('b1');
      const m = new Y.Map();
      m.set('type', 'sub'); m.set('order', 'b0'); m.set('authorId', null);
      m.set('authorText', ''); m.set('subText', new Y.Text()); m.set('bullets', new Y.Map());
      cur.set('junk', m);
    });
    await persistUpdate({
      ...base(), update: updateOf(edited), requestId: nextRequestId(),
      op: 'normal', docGeneration: 1, writeEpoch: 1
    });
    let row = await prisma.sharedDoc.findUniqueOrThrow({ where: { environment_teamId_year_weekNum: base() } });
    expect(JSON.parse(row.contents)['1'].current.map((b: { id: string }) => b.id)).toEqual(['junk']);

    // 관리자가 깨끗한 스냅샷으로 복원
    const res = await persistUpdate({
      ...base(), update: cleanSnapshot, requestId: nextRequestId(),
      op: 'restore', snapshotReason: 'pre-restore'
    });
    expect(res.ok).toBe(true);

    row = await prisma.sharedDoc.findUniqueOrThrow({ where: { environment_teamId_year_weekNum: base() } });
    const ids = JSON.parse(row.contents)['1'].current.map((b: { id: string }) => b.id);
    expect(ids).toEqual(['b1']);       // 삭제가 되돌아왔다
    expect(ids).not.toContain('junk'); // 이후 편집은 사라졌다
  });

  it('삭제된 사용자 id 가 섞여도 본문 저장이 롤백되지 않는다', async () => {
    const { doc } = await seed();
    const res = await persistUpdate({
      ...base(), update: updateOf(doc), requestId: nextRequestId(),
      op: 'normal', docGeneration: 1, writeEpoch: 1,
      dirtyUserIds: [userId, 999999]   // 999999 는 존재하지 않는다
    });
    expect(res.ok).toBe(true);
    const act = await prisma.docActivity.findMany();
    expect(act.length).toBe(1);
    expect(act[0].userId).toBe(userId);
  });

  it('normal 저장이 병합되고 revision 이 오른다', async () => {
    const { doc } = await seed();
    const edit = new Y.Doc();
    Y.applyUpdate(edit, updateOf(doc));
    // 새 블록 추가
    const cats = edit.getMap('cats');
    const cur = (cats.get('1') as Y.Map<unknown>).get('current') as Y.Map<unknown>;
    edit.transact(() => {
      const m = new Y.Map();
      m.set('type', 'sub'); m.set('order', 'b0'); m.set('authorId', null);
      m.set('authorText', ''); m.set('subText', new Y.Text()); m.set('bullets', new Y.Map());
      cur.set('b2', m);
    });

    const res = await persistUpdate({
      ...base(), update: updateOf(edit), requestId: nextRequestId(),
      op: 'normal', docGeneration: 1, writeEpoch: 1, dirtyUserIds: [userId]
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.revision).toBe(2);

    const row = await prisma.sharedDoc.findUniqueOrThrow({ where: { environment_teamId_year_weekNum: base() } });
    const ids = JSON.parse(row.contents)['1'].current.map((b: { id: string }) => b.id);
    expect(ids).toEqual(expect.arrayContaining(['b1', 'b2']));
  });

  it('같은 requestId 로 재호출하면 revision 이 중복 증가하지 않는다 (멱등)', async () => {
    const { doc } = await seed();
    const reqId = nextRequestId();
    const r1 = await persistUpdate({ ...base(), update: updateOf(doc), requestId: reqId, op: 'normal', docGeneration: 1, writeEpoch: 1 });
    const r2 = await persistUpdate({ ...base(), update: updateOf(doc), requestId: reqId, op: 'normal', docGeneration: 1, writeEpoch: 1 });
    expect(r1.ok && r2.ok).toBe(true);
    if (!r1.ok || !r2.ok) return;
    expect(r2.revision).toBe(r1.revision);
    expect(r2.deduped).toBe(true);

    const row = await prisma.sharedDoc.findUniqueOrThrow({ where: { environment_teamId_year_weekNum: base() } });
    expect(row.revision).toBe(r1.revision);
  });

  it('잠긴 주차에는 normal 저장을 거부한다 (WebSocket 우회 방어)', async () => {
    const { doc } = await seed();
    await prisma.summaryLock.create({ data: { teamId, ...TEAM, isLocked: true } });

    const res = await persistUpdate({
      ...base(), update: updateOf(doc), requestId: nextRequestId(),
      op: 'normal', docGeneration: 1, writeEpoch: 1
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe('locked');
  });

  it('잠긴 주차에는 새 문서를 시드하지 않는다', async () => {
    await prisma.summaryLock.create({ data: { teamId, ...TEAM, isLocked: true } });
    const doc = buildDocFromState(SEED_STATE, { teamId, ...TEAM, seedId: 's' });
    const res = await persistUpdate({
      ...base(), update: updateOf(doc), requestId: nextRequestId(), op: 'seed', seedId: 's'
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe('locked');
    expect(await prisma.sharedDoc.count()).toBe(0);
  });

  it('docGeneration 이 다르면 거부한다 — 더 큰 값도 통과시키지 않는다', async () => {
    const { doc } = await seed();
    const tooSmall = await persistUpdate({ ...base(), update: updateOf(doc), requestId: nextRequestId(), op: 'normal', docGeneration: 0, writeEpoch: 1 });
    const tooBig = await persistUpdate({ ...base(), update: updateOf(doc), requestId: nextRequestId(), op: 'normal', docGeneration: 99, writeEpoch: 1 });
    expect(tooSmall.ok).toBe(false);
    expect(tooBig.ok).toBe(false);
    if (!tooSmall.ok) expect(tooSmall.reason).toBe('generation-mismatch');
    if (!tooBig.ok) expect(tooBig.reason).toBe('generation-mismatch');
  });

  it('writeEpoch 이 다르면 거부한다', async () => {
    const { doc } = await seed();
    const res = await persistUpdate({ ...base(), update: updateOf(doc), requestId: nextRequestId(), op: 'normal', docGeneration: 1, writeEpoch: 5 });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('epoch-mismatch');
  });

  it('lock-finalize 는 잠금 검사를 우회하고 writeEpoch 을 올린다', async () => {
    const { doc } = await seed();
    await prisma.summaryLock.create({ data: { teamId, ...TEAM, isLocked: true } });

    const res = await persistUpdate({
      ...base(), update: updateOf(doc), requestId: nextRequestId(),
      op: 'lock-finalize', snapshotReason: 'lock'
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.writeEpoch).toBe(2);

    // 잠금 확정 스냅샷이 남는다
    const snaps = await prisma.sharedDocSnapshot.findMany({ where: { reason: 'lock' } });
    expect(snaps.length).toBe(1);

    // 이후 구 epoch 저장은 밀려난다
    const stale = await persistUpdate({ ...base(), update: updateOf(doc), requestId: nextRequestId(), op: 'normal', docGeneration: 1, writeEpoch: 1 });
    expect(stale.ok).toBe(false);
  });

  it('restore 는 docGeneration 을 올리고 구세대 저장을 밀어낸다', async () => {
    const { doc } = await seed();
    const res = await persistUpdate({
      ...base(), update: updateOf(doc), requestId: nextRequestId(), op: 'restore', snapshotReason: 'pre-restore'
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.docGeneration).toBe(2);
    expect(res.writeEpoch).toBe(1);

    const stale = await persistUpdate({ ...base(), update: updateOf(doc), requestId: nextRequestId(), op: 'normal', docGeneration: 1, writeEpoch: 1 });
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.reason).toBe('generation-mismatch');
  });

  it('문서가 없는데 normal 저장을 시도하면 not-found', async () => {
    const doc = buildDocFromState(SEED_STATE, { teamId, ...TEAM, seedId: 's' });
    const res = await persistUpdate({ ...base(), update: updateOf(doc), requestId: nextRequestId(), op: 'normal' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('not-found');
  });

  it('dirtyUserIds 로 편집 활동을 기록한다 (이월 시드로는 기록되지 않음)', async () => {
    const { doc } = await seed();   // seed 는 dirtyUserIds 없음
    expect(await prisma.docActivity.count()).toBe(0);

    await persistUpdate({
      ...base(), update: updateOf(doc), requestId: nextRequestId(),
      op: 'normal', docGeneration: 1, writeEpoch: 1, dirtyUserIds: [userId]
    });
    const act = await prisma.docActivity.findMany();
    expect(act.length).toBe(1);
    expect(act[0].userId).toBe(userId);
    expect(act[0].lastEditedAt).not.toBeNull();
    expect(act[0].completedAt).toBeNull();
  });

  it('동시 저장 10건이 유실 없이 직렬화된다', async () => {
    const { doc } = await seed();

    // 각자 서로 다른 블록을 추가한 증분 update 10개 (실제 Worker 도 증분을 보낸다)
    const updates = Array.from({ length: 10 }, (_, i) => {
      const d2 = new Y.Doc();
      Y.applyUpdate(d2, updateOf(doc));
      const cur = (d2.getMap('cats').get('1') as Y.Map<unknown>).get('current') as Y.Map<unknown>;
      d2.transact(() => {
        const m = new Y.Map();
        m.set('type', 'sub'); m.set('order', `z${i}`); m.set('authorId', null);
        m.set('authorText', ''); m.set('subText', new Y.Text()); m.set('bullets', new Y.Map());
        cur.set(`concurrent-${i}`, m);
      });
      return Y.encodeStateAsUpdate(d2, Y.encodeStateVector(doc));
    });

    // 전부 같은 세대로 동시에 던진다 — advisory lock 이 직렬화해 모두 성공해야 한다
    const results = await Promise.all(updates.map(u =>
      persistUpdate({
        ...base(), update: u, requestId: nextRequestId(),
        op: 'normal', docGeneration: 1, writeEpoch: 1
      })
    ));

    expect(results.every(r => r.ok)).toBe(true);

    const row = await prisma.sharedDoc.findUniqueOrThrow({ where: { environment_teamId_year_weekNum: base() } });
    const finalDoc = new Y.Doc();
    Y.applyUpdate(finalDoc, new Uint8Array(row.ydoc));
    const ids = materialize(finalDoc)['1'].current.map(b => b.id);

    // 유실 0 — 초기 블록 + 동시 추가 10개가 모두 남아야 한다
    expect(ids).toContain('b1');
    for (let i = 0; i < 10; i++) expect(ids).toContain(`concurrent-${i}`);
    expect(row.revision).toBe(11); // seed(1) + 10회
  });
});
