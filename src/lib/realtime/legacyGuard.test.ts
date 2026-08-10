/**
 * 공동 편집 주차에 레거시 저장 경로가 끼어들지 못하는지.
 *
 * 여기가 뚫리면 오래 열어둔 탭의 [저장] 한 번으로 팀이 함께 작성한 내용이 통째로 사라진다.
 * regenerateSummary 는 개인 Report 만으로 취합본을 **다시 만들기** 때문에,
 * 공동 문서에 있고 개인 Report 에는 없는 내용이 전부 날아간다. 되돌릴 방법이 없다.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { resolveTestDatabaseUrl } from './testDb';

const TEST_URL = resolveTestDatabaseUrl();
const d = TEST_URL ? describe : describe.skip;
if (TEST_URL) process.env.DATABASE_URL = TEST_URL;
process.env.REALTIME_ENV = 'test';

let prisma: PrismaClient;
let regenerateSummary: typeof import('../summaryGenerator').regenerateSummary;

const YEAR = 2026;
const WEEK = 33;

d('레거시 취합 재생성 차단', () => {
  let teamId = 0;
  let catId = 0;
  let userId = 0;

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: TEST_URL } } });
    ({ regenerateSummary } = await import('../summaryGenerator'));
  });
  afterAll(async () => { await prisma.$disconnect(); });

  beforeEach(async () => {
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
    const user = await prisma.user.create({
      data: { name: '방수진', password: 'x', role: 'teamMaster', teamId }
    });
    userId = user.id;
    const part = await prisma.part.create({ data: { name: '플랫폼', teamId } });
    const cat = await prisma.category.create({
      data: { major: '운영', middle: '문의 대응', partId: part.id, teamId }
    });
    catId = cat.id;
  });

  /** 팀이 함께 작성한 취합본(개인 Report 에는 없는 내용) */
  async function 공동작성본() {
    const contents = JSON.stringify({
      [String(catId)]: {
        current: [{ id: 'shared', type: 'sub', subText: '팀이 함께 작성한 내용', authorText: '이현우', bullets: [] }],
        next: []
      }
    });
    await prisma.summaryData.create({ data: { teamId, year: YEAR, weekNum: WEEK, contents } });
    // 같은 주차에 개인 보고도 하나 있다 — 재생성되면 이것만 남는다
    const report = await prisma.report.create({ data: { userId, year: YEAR, weekNum: WEEK } });
    await prisma.reportItem.create({
      data: {
        reportId: report.id, categoryId: catId,
        currentContents: JSON.stringify([{ id: 'mine', subText: '내 개인 보고', bullets: [] }]),
        nextContents: '[]'
      }
    });
    return contents;
  }

  const 현재취합본 = async () =>
    (await prisma.summaryData.findUniqueOrThrow({
      where: { teamId_year_weekNum: { teamId, year: YEAR, weekNum: WEEK } }
    })).contents;

  it('공동 편집 주차면 취합본을 다시 만들지 않는다', async () => {
    const original = await 공동작성본();
    await prisma.team.update({
      where: { id: teamId },
      data: { collabFromYear: YEAR, collabFromWeek: WEEK }
    });

    await regenerateSummary(YEAR, WEEK, teamId);

    expect(await 현재취합본()).toBe(original);
    expect(await 현재취합본()).toContain('팀이 함께 작성한 내용');
  });

  it('공동 편집을 끈 뒤의 주차는 기존대로 재생성한다', async () => {
    await 공동작성본();
    // 32주차까지만 공동 편집 → 33주차는 기존 방식
    await prisma.team.update({
      where: { id: teamId },
      data: {
        collabFromYear: YEAR, collabFromWeek: 30,
        collabUntilYear: YEAR, collabUntilWeek: 32
      }
    });

    await regenerateSummary(YEAR, WEEK, teamId);

    expect(await 현재취합본()).toContain('내 개인 보고');
  });

  it('끈 시점 이전 주차는 여전히 보호된다', async () => {
    const original = await 공동작성본();
    await prisma.team.update({
      where: { id: teamId },
      data: {
        collabFromYear: YEAR, collabFromWeek: 30,
        collabUntilYear: YEAR, collabUntilWeek: WEEK   // 33주차까지 공동 편집
      }
    });

    await regenerateSummary(YEAR, WEEK, teamId);

    expect(await 현재취합본()).toBe(original);
  });

  it('공동 편집을 쓰지 않는 팀은 종전 그대로 동작한다', async () => {
    await 공동작성본();
    await regenerateSummary(YEAR, WEEK, teamId);
    expect(await 현재취합본()).toContain('내 개인 보고');
  });

  it('잠긴 주차는 공동 편집 여부와 무관하게 재생성하지 않는다', async () => {
    const original = await 공동작성본();
    await prisma.summaryLock.create({
      data: { teamId, year: YEAR, weekNum: WEEK, isLocked: true }
    });
    await regenerateSummary(YEAR, WEEK, teamId);
    expect(await 현재취합본()).toBe(original);
  });
});
