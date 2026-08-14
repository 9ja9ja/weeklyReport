/**
 * 작성마감 주차에 팀원 저장이 끼어들지 못하는지 — 실제 Postgres 가 있어야 의미가 있다.
 *
 * 작성마감은 팀장이 취합본을 정리하는 구간이다. 여기서 룸의 늦은 저장이 한 번이라도
 * 통과하면 정리한 내용이 그 저장으로 되돌아간다. 잠금과 똑같이 막혀야 한다.
 *
 * 실행:
 *   TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55432/wrtest npx vitest run src/lib/realtime/writeClose.test.ts
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import * as Y from 'yjs';
import { PrismaClient } from '@prisma/client';
import { buildDocFromState, type EditorState } from './buildDoc';
import { resolveTestDatabaseUrl } from './testDb';

const TEST_URL = resolveTestDatabaseUrl();
const d = TEST_URL ? describe : describe.skip;
if (TEST_URL) process.env.DATABASE_URL = TEST_URL;

let prisma: PrismaClient;
let persistUpdate: typeof import('./persist').persistUpdate;

const ENV = 'test';
const WEEK = { year: 2026, weekNum: 33 };
let teamId = 0;

const SEED: EditorState = {
  '1': { current: [{ id: 'b1', type: 'sub', subText: '팀원이 쓴 내용', authorText: '', bullets: [] }] as never, next: [] }
};

let rid = 0;
const nextRequestId = () => `req-${++rid}-${Math.random().toString(36).slice(2)}`;

d('작성마감 주차의 저장 게이트 (실제 Postgres)', () => {
  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: TEST_URL } } });
    ({ persistUpdate } = await import('./persist'));
  });
  afterAll(async () => { await prisma.$disconnect(); });

  beforeEach(async () => {
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
  });

  const base = () => ({ environment: ENV, teamId, ...WEEK });

  async function seed() {
    const doc = buildDocFromState(SEED, { teamId, ...WEEK, seedId: 'seed-1' });
    await persistUpdate({
      ...base(), update: Y.encodeStateAsUpdate(doc), requestId: nextRequestId(),
      op: 'seed', seedId: 'seed-1', seededFrom: 'test'
    });
    return doc;
  }

  async function close() {
    await prisma.summaryLock.create({
      data: { teamId, ...WEEK, isClosed: true, closedAt: new Date() }
    });
  }

  it('작성마감이면 팀원(normal) 저장을 거부한다', async () => {
    const doc = await seed();
    await close();

    doc.getMap('cats'); // 문서를 건드려 변경분을 만든다
    const late = new Y.Doc();
    Y.applyUpdate(late, Y.encodeStateAsUpdate(doc));
    late.getMap('meta').set('touched', 1);

    const res = await persistUpdate({
      ...base(), update: Y.encodeStateAsUpdate(late), requestId: nextRequestId(), op: 'normal'
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('locked');
  });

  it('작성마감이면 새 문서를 시드하지도 않는다', async () => {
    await close();
    const doc = buildDocFromState(SEED, { teamId, ...WEEK, seedId: 'seed-x' });
    const res = await persistUpdate({
      ...base(), update: Y.encodeStateAsUpdate(doc), requestId: nextRequestId(),
      op: 'seed', seedId: 'seed-x', seededFrom: 'test'
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('locked');
  });

  it('작성마감 중 팀장의 취합본 반영(restore)은 통과하고 내용이 치환된다', async () => {
    await seed();
    await close();

    // 팀장이 취합본에서 정리한 결과 — 기존 블록을 지우고 다시 쓴 상태
    const edited: EditorState = {
      '1': { current: [{ id: 'b9', type: 'sub', subText: '팀장이 정리한 내용', authorText: '', bullets: [] }] as never, next: [] }
    };
    const doc = buildDocFromState(edited, { teamId, ...WEEK, seedId: 'seed-1' });
    const res = await persistUpdate({
      ...base(), update: Y.encodeStateAsUpdate(doc), requestId: nextRequestId(), op: 'restore'
    });

    expect(res.ok).toBe(true);
    const saved = await prisma.sharedDoc.findUniqueOrThrow({
      where: { environment_teamId_year_weekNum: { environment: ENV, teamId, ...WEEK } }
    });
    // 치환이므로 팀원이 쓴 블록은 남지 않는다 (병합이면 되살아난다)
    expect(saved.contents).toContain('팀장이 정리한 내용');
    expect(saved.contents).not.toContain('팀원이 쓴 내용');
  });

  it('마감을 취소하면 팀원 저장이 다시 통과한다', async () => {
    const doc = await seed();
    await close();
    await prisma.summaryLock.update({
      where: { teamId_year_weekNum: { teamId, ...WEEK } },
      data: { isClosed: false, closedAt: null }
    });

    const next = new Y.Doc();
    Y.applyUpdate(next, Y.encodeStateAsUpdate(doc));
    next.getMap('meta').set('touched', 2);
    const res = await persistUpdate({
      ...base(), update: Y.encodeStateAsUpdate(next), requestId: nextRequestId(), op: 'normal'
    });
    expect(res.ok).toBe(true);
  });
});
