/**
 * 백필 통합 테스트 — 실제 Postgres 필요.
 *   TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55432/wrtest npx vitest run src/lib/realtime/backfill.test.ts
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';

import { resolveTestDatabaseUrl } from './testDb';

// 안전장치: 로컬 test DB 가 아니면 실행하지 않는다 (매 케이스마다 전 테이블 deleteMany 를 하므로)
const TEST_URL = resolveTestDatabaseUrl();
const d = TEST_URL ? describe : describe.skip;
if (TEST_URL) process.env.DATABASE_URL = TEST_URL;

let prisma: PrismaClient;
let runBackfill: typeof import('./backfill').runBackfill;

const ENV = 'test';
const YEAR = 2026;
const WEEK = 30;

d('runBackfill (실제 Postgres)', () => {
  let teamId = 0;
  let catId = 0;
  let userA = 0;
  let userB = 0;

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: TEST_URL } } });
    ({ runBackfill } = await import('./backfill'));
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
    const cat = await prisma.category.create({
      data: { major: '서비스 운영', middle: '고객 문의', partId: part.id, teamId }
    });
    catId = cat.id;

    const a = await prisma.user.create({ data: { name: '방수진', teamId } });
    const b = await prisma.user.create({ data: { name: '허주희', teamId } });
    userA = a.id; userB = b.id;
    // 겸직 링크 — authorId 역매핑이 UserTeam 기준이어야 한다
    await prisma.userTeam.create({ data: { userId: userA, teamId, isPrimary: true } });
    await prisma.userTeam.create({ data: { userId: userB, teamId, isPrimary: true } });
  });

  const firstDoc = () => prisma.sharedDoc.findFirstOrThrow();

  const contentsOf = (subText: string, authorText: string) =>
    JSON.stringify({
      [String(catId)]: {
        current: [{ id: 'blk1', type: 'sub', subText, authorText, bullets: [{ id: 'b1', text: '불릿' }] }],
        next: []
      }
    });

  it('dry-run 은 아무것도 쓰지 않고 계획만 낸다', async () => {
    await prisma.summaryData.create({
      data: { teamId, year: YEAR, weekNum: WEEK, contents: contentsOf('취합본 내용', '방수진') }
    });

    const report = await runBackfill({ environment: ENV, dryRun: true });
    expect(report.dryRun).toBe(true);
    expect(report.scanned).toBe(1);
    expect(report.items[0].status).toBe('dry');
    expect(await prisma.sharedDoc.count()).toBe(0);
  });

  it('블록 수가 왕복에서 변하지 않는다 (diff 0)', async () => {
    await prisma.summaryData.create({
      data: { teamId, year: YEAR, weekNum: WEEK, contents: contentsOf('취합본 내용', '방수진') }
    });
    const report = await runBackfill({ environment: ENV, dryRun: true });
    expect(report.totals.diffNonZero).toBe(0);
    expect(report.items[0].blocks).toBe(1);
  });

  it('SummaryData 가 있으면 그것을 원본으로 쓴다', async () => {
    await prisma.summaryData.create({
      data: { teamId, year: YEAR, weekNum: WEEK, contents: contentsOf('마스터가 손본 내용', '방수진') }
    });
    // 개인 보고도 있지만 취합본이 우선이어야 한다
    const rep = await prisma.report.create({ data: { userId: userA, year: YEAR, weekNum: WEEK } });
    await prisma.reportItem.create({
      data: { reportId: rep.id, categoryId: catId, currentContents: JSON.stringify([{ id: 'x', subText: '개인 원본', bullets: [] }]), nextContents: '[]' }
    });

    const report = await runBackfill({ environment: ENV, dryRun: false });
    expect(report.items[0].source).toBe('summary');
    const row = await prisma.sharedDoc.findFirstOrThrow();
    expect(JSON.parse(row.contents)[String(catId)].current[0].subText).toBe('마스터가 손본 내용');
    expect(row.seededFrom).toBe('migrate:summary');
  });

  it('취합본이 없으면 개인 보고를 합쳐 만든다 (작성자명 자동 부여)', async () => {
    const r1 = await prisma.report.create({ data: { userId: userA, year: YEAR, weekNum: WEEK } });
    await prisma.reportItem.create({
      data: { reportId: r1.id, categoryId: catId, currentContents: JSON.stringify([{ id: 'x1', subText: 'A 작성', bullets: [] }]), nextContents: '[]' }
    });
    const r2 = await prisma.report.create({ data: { userId: userB, year: YEAR, weekNum: WEEK } });
    await prisma.reportItem.create({
      data: { reportId: r2.id, categoryId: catId, currentContents: JSON.stringify([{ id: 'x2', subText: 'B 작성', bullets: [] }]), nextContents: '[]' }
    });

    const report = await runBackfill({ environment: ENV, dryRun: false });
    expect(report.items[0].source).toBe('reports');

    const row = await firstDoc();
    const blocks = JSON.parse(row.contents)[String(catId)].current;
    expect(blocks.length).toBe(2);
    const byText = Object.fromEntries(blocks.map((b: { subText: string; authorText: string }) => [b.subText, b.authorText]));
    expect(byText['A 작성']).toBe('방수진');
    expect(byText['B 작성']).toBe('허주희');
  });

  it('authorText 를 UserTeam 기준으로 authorId 에 매핑한다 (겸직 누락 방지)', async () => {
    await prisma.summaryData.create({
      data: { teamId, year: YEAR, weekNum: WEEK, contents: contentsOf('내용', '방수진') }
    });
    const report = await runBackfill({ environment: ENV, dryRun: false });
    expect(report.authorMapping.total).toBe(1);
    expect(report.authorMapping.mapped).toBe(1);

    const row = await firstDoc();
    expect(JSON.parse(row.contents)[String(catId)].current[0].authorId).toBe(userA);
  });

  it('매칭 실패율이 임계를 넘으면 아무것도 쓰지 않고 중단한다', async () => {
    // 유일한 작성자가 자유 텍스트라 실패율 100%
    await prisma.summaryData.create({
      data: { teamId, year: YEAR, weekNum: WEEK, contents: contentsOf('내용', '방수진·허주희') }
    });
    const report = await runBackfill({ environment: ENV, dryRun: false });
    expect(report.authorMapping.unmapped).toBe(1);
    expect(report.authorMapping.unmappedSamples).toContain('방수진·허주희');
    expect(report.aborted).toBeTruthy();
    expect(await prisma.sharedDoc.count()).toBe(0);   // 한 건도 쓰지 않았다
  });

  it('매칭 실패가 임계 이하면 authorId null 로 두고 이름은 보존한다', async () => {
    // 매칭되는 작성자 4명 + 자유 텍스트 1명 = 실패율 20%
    const cats: string[] = [];
    for (let i = 0; i < 4; i++) cats.push(`{"id":"m${i}","type":"sub","subText":"내용","authorText":"방수진","bullets":[]}`);
    cats.push('{"id":"free","type":"sub","subText":"내용","authorText":"방수진·허주희","bullets":[]}');
    await prisma.summaryData.create({
      data: {
        teamId, year: YEAR, weekNum: WEEK,
        contents: `{"${catId}":{"current":[${cats.join(',')}],"next":[]}}`
      }
    });

    const report = await runBackfill({ environment: ENV, dryRun: false });
    expect(report.aborted).toBeUndefined();
    expect(report.authorMapping.unmapped).toBe(1);

    const row = await firstDoc();
    const blocks = JSON.parse(row.contents)[String(catId)].current;
    const free = blocks.find((b: { id: string }) => b.id === 'free');
    expect(free.authorId).toBeNull();
    expect(free.authorText).toBe('방수진·허주희');
    const mapped = blocks.find((b: { id: string }) => b.id === 'm0');
    expect(mapped.authorId).toBe(userA);
  });

  it('force 덮어쓰기는 세대를 올리고 덮기 전 스냅샷을 남긴다', async () => {
    await prisma.summaryData.create({
      data: { teamId, year: YEAR, weekNum: WEEK, contents: contentsOf('내용', '방수진') }
    });
    await runBackfill({ environment: ENV, dryRun: false });
    const before = await firstDoc();
    expect(before.docGeneration).toBe(1);

    await runBackfill({ environment: ENV, dryRun: false, force: true });
    const after = await firstDoc();
    expect(after.docGeneration).toBe(2);   // 접속 중인 클라이언트가 로컬 상태를 폐기하도록
    const snaps = await prisma.sharedDocSnapshot.findMany({ where: { reason: 'pre-restore' } });
    expect(snaps.length).toBe(1);
  });

  it('이미 문서가 있으면 기본적으로 건너뛴다', async () => {
    await prisma.summaryData.create({
      data: { teamId, year: YEAR, weekNum: WEEK, contents: contentsOf('내용', '방수진') }
    });
    await runBackfill({ environment: ENV, dryRun: false });
    const second = await runBackfill({ environment: ENV, dryRun: false });
    expect(second.items[0].status).toBe('skipped-exists');
  });

  it('편집 이력이 있으면 force 여도 덮어쓰지 않는다', async () => {
    await prisma.summaryData.create({
      data: { teamId, year: YEAR, weekNum: WEEK, contents: contentsOf('내용', '방수진') }
    });
    await runBackfill({ environment: ENV, dryRun: false });
    await prisma.docActivity.create({
      data: { environment: ENV, teamId, year: YEAR, weekNum: WEEK, userId: userA, lastEditedAt: new Date() }
    });

    const forced = await runBackfill({ environment: ENV, dryRun: false, force: true });
    expect(forced.items[0].status).toBe('skipped-edited');
  });

  it('빈 주차는 건너뛴다', async () => {
    await prisma.summaryData.create({ data: { teamId, year: YEAR, weekNum: WEEK, contents: '{}' } });
    const report = await runBackfill({ environment: ENV, dryRun: true });
    expect(report.items[0].status).toBe('skipped-empty');
  });
});
