/**
 * Phase 2 적대적 검증에서 확정된 결함들의 회귀 테스트.
 * 각 케이스는 고치기 전에는 실패하던 것들이다.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import * as Y from 'yjs';
import { PrismaClient } from '@prisma/client';
import { resolveTestDatabaseUrl } from './testDb';
import { roomName, parseRoomName, roomNameOf } from './token';

const TEST_URL = resolveTestDatabaseUrl();
const d = TEST_URL ? describe : describe.skip;
if (TEST_URL) process.env.DATABASE_URL = TEST_URL;

// 환경 정규화 검증을 위해 고정값을 준다
process.env.REALTIME_ENV = 'test';

let prisma: PrismaClient;
let persistUpdate: typeof import('./persist').persistUpdate;
let currentEnvironment: typeof import('./persist').currentEnvironment;
let ensureWeekDocument: typeof import('./seed').ensureWeekDocument;
let buildDocFromState: typeof import('./buildDoc').buildDocFromState;

const YEAR = 2026;
const WEEK = 32;

d('Phase 2 회귀 (실제 Postgres)', () => {
  let teamId = 0;
  let catId = 0;
  let ENV = 'test';

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: TEST_URL } } });
    ({ persistUpdate, currentEnvironment } = await import('./persist'));
    ({ ensureWeekDocument } = await import('./seed'));
    ({ buildDocFromState } = await import('./buildDoc'));
    ENV = currentEnvironment();
  });
  afterAll(async () => { await prisma.$disconnect(); });

  beforeEach(async () => {
    await prisma.sharedDocSnapshot.deleteMany();
    await prisma.docActivity.deleteMany();
    await prisma.persistReceipt.deleteMany();
    await prisma.sharedDoc.deleteMany();
    await prisma.summaryData.deleteMany();
    await prisma.summaryLock.deleteMany();
    await prisma.category.deleteMany();
    await prisma.majorCategory.deleteMany();
    await prisma.part.deleteMany();
    await prisma.userTeam.deleteMany();
    await prisma.user.deleteMany();
    await prisma.team.deleteMany();

    const team = await prisma.team.create({ data: { name: `팀-${Math.random()}` } });
    teamId = team.id;
    const part = await prisma.part.create({ data: { name: '플랫폼', teamId } });
    const cat = await prisma.category.create({
      data: { major: '운영', middle: '문의 대응', partId: part.id, teamId }
    });
    catId = cat.id;
  });

  it('시드가 기존 SummaryData(확정 취합본)를 덮어쓰지 않는다', async () => {
    // 레거시 주차의 확정 취합본
    const original = JSON.stringify({
      [String(catId)]: {
        current: [{ id: 'x', type: 'sub', subText: '확정된 취합본 내용', authorText: '방수진', bullets: [] }],
        next: []
      }
    });
    await prisma.summaryData.create({ data: { teamId, year: YEAR, weekNum: WEEK, contents: original } });

    // 룸 콜드스타트 등으로 시드가 돌아도 취합본은 그대로여야 한다
    const res = await ensureWeekDocument(ENV, teamId, YEAR, WEEK);
    expect(res.created).toBe(true);

    const mirror = await prisma.summaryData.findUniqueOrThrow({
      where: { teamId_year_weekNum: { teamId, year: YEAR, weekNum: WEEK } }
    });
    expect(mirror.contents).toBe(original);
    expect(JSON.parse(mirror.contents)[String(catId)].current[0].subText).toBe('확정된 취합본 내용');
  });

  it('멱등 재전송이 세대를 앞당겨주지 않는다 (fencing 우회 방지)', async () => {
    const doc = buildDocFromState({ [String(catId)]: { current: [], next: [] } },
      { teamId, year: YEAR, weekNum: WEEK, seedId: 's1' });
    await persistUpdate({
      environment: ENV, teamId, year: YEAR, weekNum: WEEK,
      update: Y.encodeStateAsUpdate(doc), requestId: 'r-seed', op: 'seed', seedId: 's1'
    });

    // epoch 1 에서 저장
    const reqId = 'r-1';
    const first = await persistUpdate({
      environment: ENV, teamId, year: YEAR, weekNum: WEEK,
      update: Y.encodeStateAsUpdate(doc), requestId: reqId,
      op: 'normal', docGeneration: 1, writeEpoch: 1
    });
    expect(first.ok).toBe(true);

    // 잠금 등으로 epoch 이 올라간 상황을 만든다
    await prisma.sharedDoc.updateMany({
      where: { environment: ENV, teamId, year: YEAR, weekNum: WEEK },
      data: { writeEpoch: 5 }
    });

    // 구 epoch 로 같은 requestId 재전송 → 기록 시점 값(1)을 돌려줘야 한다
    const retry = await persistUpdate({
      environment: ENV, teamId, year: YEAR, weekNum: WEEK,
      update: Y.encodeStateAsUpdate(doc), requestId: reqId,
      op: 'normal', docGeneration: 1, writeEpoch: 1
    });
    expect(retry.ok).toBe(true);
    if (retry.ok) {
      expect(retry.writeEpoch).toBe(1);   // 최신값 5 를 흘리면 안 된다
      expect(retry.deduped).toBe(true);
    }
  });

  it('멱등 분기도 세대가 어긋나면 거부한다', async () => {
    const doc = buildDocFromState({ [String(catId)]: { current: [], next: [] } },
      { teamId, year: YEAR, weekNum: WEEK, seedId: 's1' });
    await persistUpdate({
      environment: ENV, teamId, year: YEAR, weekNum: WEEK,
      update: Y.encodeStateAsUpdate(doc), requestId: 'r-seed2', op: 'seed', seedId: 's1'
    });
    await persistUpdate({
      environment: ENV, teamId, year: YEAR, weekNum: WEEK,
      update: Y.encodeStateAsUpdate(doc), requestId: 'r-2',
      op: 'normal', docGeneration: 1, writeEpoch: 1
    });

    // 같은 requestId 인데 다른 epoch 을 주장하면 거부
    const bad = await persistUpdate({
      environment: ENV, teamId, year: YEAR, weekNum: WEEK,
      update: Y.encodeStateAsUpdate(doc), requestId: 'r-2',
      op: 'normal', docGeneration: 1, writeEpoch: 9
    });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.reason).toBe('epoch-mismatch');
  });
});

describe('환경·룸 이름 정규화', () => {
  it('currentEnvironment 가 룸 이름에 안전한 문자만 돌려준다', async () => {
    const { currentEnvironment: fn } = await import('./persist');
    const saved = { ...process.env };
    try {
      delete process.env.REALTIME_ENV;
      process.env.VERCEL_ENV = 'preview';
      process.env.VERCEL_GIT_COMMIT_REF = 'feat/실시간-편집';
      const env = fn();
      // 토큰의 env 와 룸 이름의 env 가 달라지면 접속이 전부 막힌다
      expect(env).toMatch(/^[a-zA-Z0-9_-]+$/);
      expect(roomName(env, 1, 2026, 32, 1)).toContain(env);
    } finally {
      Object.assign(process.env, saved);
    }
  });

  it('선행 0 이 붙은 룸 이름은 정규화 왕복에서 걸러진다', () => {
    const weird = 'test-report-t1-2026-w032-g1';
    const key = parseRoomName(weird);
    expect(key).not.toBeNull();
    // 파싱은 되지만 되돌리면 원문과 다르다 → 라우트가 거부해야 한다
    expect(roomNameOf(key!)).not.toBe(weird);
  });

  it('정상 룸 이름은 왕복이 항등이다', () => {
    for (const env of ['production', 'preview-feat', 'test']) {
      const n = roomName(env, 3, 2026, 32, 2);
      expect(roomNameOf(parseRoomName(n)!)).toBe(n);
    }
  });
});
