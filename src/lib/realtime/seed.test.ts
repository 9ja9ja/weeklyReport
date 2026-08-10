/**
 * 주차 시드·이월 통합 테스트 — 실제 Postgres 필요.
 *
 * 기존에는 클라이언트가 접속할 때마다 개인별로 이월했다. 공유 문서에서는 그러면
 * 여러 사람이 각자 이월해 중복·소실이 나므로 서버가 원자적으로 한 번만 만든다.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { resolveTestDatabaseUrl } from './testDb';

const TEST_URL = resolveTestDatabaseUrl();
const d = TEST_URL ? describe : describe.skip;
if (TEST_URL) process.env.DATABASE_URL = TEST_URL;

let prisma: PrismaClient;
let ensureWeekDocument: typeof import('./seed').ensureWeekDocument;
let ensureCategoryContainers: typeof import('./seed').ensureCategoryContainers;

const ENV = 'test';
const YEAR = 2026;
const WEEK = 32;

d('ensureWeekDocument (실제 Postgres)', () => {
  let teamId = 0;
  let catA = 0;
  let catB = 0;

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: TEST_URL } } });
    ({ ensureWeekDocument, ensureCategoryContainers } = await import('./seed'));
  });
  afterAll(async () => { await prisma.$disconnect(); });

  beforeEach(async () => {
    await prisma.sharedDocSnapshot.deleteMany();
    await prisma.docActivity.deleteMany();
    await prisma.persistReceipt.deleteMany();
    await prisma.sharedDoc.deleteMany();
    await prisma.reportItem.deleteMany();
    await prisma.report.deleteMany();
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
    const a = await prisma.category.create({ data: { major: '운영', middle: '문의 대응', partId: part.id, teamId } });
    const b = await prisma.category.create({ data: { major: '운영', middle: '이용권 해지', partId: part.id, teamId } });
    catA = a.id; catB = b.id;
  });

  it('문서가 없으면 만들고 활성 카테고리 컨테이너를 모두 준비한다', async () => {
    const res = await ensureWeekDocument(ENV, teamId, YEAR, WEEK);
    expect(res.created).toBe(true);

    const row = await prisma.sharedDoc.findUniqueOrThrow({
      where: { environment_teamId_year_weekNum: { environment: ENV, teamId, year: YEAR, weekNum: WEEK } }
    });
    const contents = JSON.parse(row.contents);
    // 컨테이너를 서버가 미리 만들어야 클라이언트 동시 생성으로 블록이 사라지지 않는다
    expect(Object.keys(contents).sort()).toEqual([String(catA), String(catB)].sort());
    expect(contents[String(catA)]).toEqual({ current: [], next: [] });
  });

  it('두 번 호출해도 문서를 새로 만들지 않는다 (동시 진입 안전)', async () => {
    const first = await ensureWeekDocument(ENV, teamId, YEAR, WEEK);
    const second = await ensureWeekDocument(ENV, teamId, YEAR, WEEK);
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.reason).toBe('already-exists');
    expect(await prisma.sharedDoc.count()).toBe(1);
  });

  it('동시에 여러 번 호출해도 문서는 하나만 생긴다', async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, () => ensureWeekDocument(ENV, teamId, YEAR, WEEK))
    );
    expect(results.filter(r => r.created).length).toBe(1);
    expect(await prisma.sharedDoc.count()).toBe(1);
  });

  it('전주 차주계획을 금주 진행사항으로 이월한다', async () => {
    // 전주 문서를 만들고 next 에 내용을 넣는다
    await ensureWeekDocument(ENV, teamId, YEAR, WEEK - 1);
    const prevRow = await prisma.sharedDoc.findUniqueOrThrow({
      where: { environment_teamId_year_weekNum: { environment: ENV, teamId, year: YEAR, weekNum: WEEK - 1 } }
    });
    const prevContents = JSON.parse(prevRow.contents);
    prevContents[String(catA)].next = [
      { id: 'plan1', type: 'sub', subText: '전자계약 배포', authorText: '방수진', authorId: null, bullets: [] }
    ];
    await prisma.sharedDoc.update({
      where: { id: prevRow.id },
      data: { contents: JSON.stringify(prevContents) }
    });

    await ensureWeekDocument(ENV, teamId, YEAR, WEEK);
    const cur = JSON.parse((await prisma.sharedDoc.findUniqueOrThrow({
      where: { environment_teamId_year_weekNum: { environment: ENV, teamId, year: YEAR, weekNum: WEEK } }
    })).contents);

    expect(cur[String(catA)].current.length).toBe(1);
    expect(cur[String(catA)].current[0].subText).toBe('전자계약 배포');
    expect(cur[String(catA)].current[0].authorText).toBe('방수진');  // 원저자 유지
    expect(cur[String(catA)].next).toEqual([]);                      // 차주는 비운다
  });

  it('잠긴 주차에는 문서를 만들지 않는다', async () => {
    await prisma.summaryLock.create({ data: { teamId, year: YEAR, weekNum: WEEK, isLocked: true } });
    const res = await ensureWeekDocument(ENV, teamId, YEAR, WEEK);
    expect(res.created).toBe(false);
    expect(res.reason).toBe('locked');
    expect(await prisma.sharedDoc.count()).toBe(0);
  });

  it('주중에 생긴 새 카테고리 컨테이너를 서버가 추가한다', async () => {
    await ensureWeekDocument(ENV, teamId, YEAR, WEEK);
    // Phase 0 에서 중분류 추가 권한을 팀원에게 열었으므로 주중에 실제로 생긴다
    const part = await prisma.part.findFirstOrThrow();
    const fresh = await prisma.category.create({
      data: { major: '운영', middle: '신규 항목', partId: part.id, teamId }
    });

    const { added } = await ensureCategoryContainers(ENV, teamId, YEAR, WEEK);
    expect(added).toContain(String(fresh.id));

    const contents = JSON.parse((await prisma.sharedDoc.findFirstOrThrow()).contents);
    expect(contents[String(fresh.id)]).toEqual({ current: [], next: [] });
  });

  it('추가할 카테고리가 없으면 아무것도 하지 않는다', async () => {
    await ensureWeekDocument(ENV, teamId, YEAR, WEEK);
    const before = await prisma.sharedDoc.findFirstOrThrow();
    const { added } = await ensureCategoryContainers(ENV, teamId, YEAR, WEEK);
    expect(added).toEqual([]);
    const after = await prisma.sharedDoc.findFirstOrThrow();
    expect(after.revision).toBe(before.revision);   // 불필요한 저장이 없다
  });

  it('비활성 카테고리는 컨테이너를 만들지 않는다', async () => {
    await prisma.category.update({ where: { id: catB }, data: { isActive: false } });
    await ensureWeekDocument(ENV, teamId, YEAR, WEEK);
    const contents = JSON.parse((await prisma.sharedDoc.findFirstOrThrow()).contents);
    expect(contents[String(catA)]).toBeDefined();
    expect(contents[String(catB)]).toBeUndefined();
  });
});

describe('carryOver (순수 함수)', () => {
  it('next 를 current 로 옮기고 next 는 비운다', async () => {
    const { carryOver: fn } = await import('./seed');
    const prev = {
      '1': {
        current: [{ id: 'old', type: 'sub', subText: '지난 금주', authorText: '', bullets: [] }],
        next: [{ id: 'plan', type: 'sub', subText: '차주 계획', authorText: '가', bullets: [] }]
      }
    } as never;
    const got = fn(prev);
    expect(got['1'].current.map(b => b.id)).toEqual(['plan']);
    expect(got['1'].next).toEqual([]);
    // 지난 금주 내용은 넘어오지 않는다
    expect(JSON.stringify(got)).not.toContain('지난 금주');
  });

  it('빈 카테고리도 컨테이너를 유지한다', async () => {
    const { carryOver: fn } = await import('./seed');
    const got = fn({ '5': { current: [], next: [] } } as never);
    expect(got['5']).toEqual({ current: [], next: [] });
  });
});
