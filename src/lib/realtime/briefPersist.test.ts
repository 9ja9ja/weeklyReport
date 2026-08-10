/**
 * 요약본 저장 경로 통합 검증 (실제 Postgres).
 *
 * 여기서 막지 못하면 확정된 요약본이 조용히 덮이거나, 잠근 뒤에도 저장이 통과한다.
 * WebSocket 의 읽기전용 판정은 /api/realtime/save 직접 호출을 막지 못하므로
 * **잠금 검사는 반드시 이 트랜잭션 안**에 있어야 한다.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import * as Y from 'yjs';
import { PrismaClient } from '@prisma/client';
import { resolveTestDatabaseUrl } from './testDb';
import { buildBriefDoc } from './briefDoc';

const TEST_URL = resolveTestDatabaseUrl();
const d = TEST_URL ? describe : describe.skip;
if (TEST_URL) process.env.DATABASE_URL = TEST_URL;
process.env.REALTIME_ENV = 'test';

let prisma: PrismaClient;
let persistBriefUpdate: typeof import('./briefPersist').persistBriefUpdate;
let ensureBriefDocument: typeof import('./briefSeed').ensureBriefDocument;

const ENV = 'test';
const YEAR = 2026;
const WEEK = 32;

/** 시드 문서를 만들고 저장까지 한 뒤 그 Y.Doc 을 돌려준다 */
async function seed(html = '<p>초기 내용</p>', title = '초기 제목') {
  const doc = buildBriefDoc(html, title, 'seed-1');
  const res = await persistBriefUpdate({
    environment: ENV, year: YEAR, weekNum: WEEK,
    update: Y.encodeStateAsUpdate(doc), requestId: 'r-seed', op: 'seed', seedId: 'seed-1'
  });
  expect(res.ok).toBe(true);
  return doc;
}

/** 문서를 고친 뒤 증분 업데이트만 뽑는다 (룸이 보내는 것과 같은 모양) */
function edit(doc: Y.Doc, fn: () => void): Uint8Array {
  const before = Y.encodeStateVector(doc);
  fn();
  return Y.encodeStateAsUpdate(doc, before);
}

function appendParagraph(doc: Y.Doc, text: string) {
  const frag = doc.getXmlFragment('default');
  const p = new Y.XmlElement('paragraph');
  p.insert(0, [new Y.XmlText(text)]);
  frag.insert(frag.length, [p]);
}

d('요약본 저장 (실제 Postgres)', () => {
  let userId = 0;

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: TEST_URL } } });
    ({ persistBriefUpdate } = await import('./briefPersist'));
    ({ ensureBriefDocument } = await import('./briefSeed'));
  });
  afterAll(async () => { await prisma.$disconnect(); });

  beforeEach(async () => {
    await prisma.persistReceipt.deleteMany();
    await prisma.briefDoc.deleteMany();
    await prisma.brief.deleteMany();
    await prisma.userTeam.deleteMany();
    await prisma.user.deleteMany();
    await prisma.team.deleteMany();

    const team = await prisma.team.create({ data: { name: `팀-${YEAR}-${Math.random()}` } });
    const user = await prisma.user.create({
      data: { name: '방수진', password: 'x', role: 'teamMaster', teamId: team.id }
    });
    userId = user.id;
  });

  it('시드가 기존 확정 요약본을 덮어쓰지 않는다', async () => {
    await prisma.brief.create({
      data: { year: YEAR, weekNum: WEEK, title: '확정 제목', content: '<p>확정 본문</p>', createdBy: userId }
    });

    await seed('<p>다른 내용</p>', '다른 제목');

    const brief = await prisma.brief.findUniqueOrThrow({ where: { year_weekNum: { year: YEAR, weekNum: WEEK } } });
    expect(brief.content).toBe('<p>확정 본문</p>');
    expect(brief.title).toBe('확정 제목');
  });

  it('같은 seedId 재시드는 멱등, 다른 seedId 는 거부', async () => {
    const doc = await seed();

    const same = await persistBriefUpdate({
      environment: ENV, year: YEAR, weekNum: WEEK,
      update: Y.encodeStateAsUpdate(doc), requestId: 'r-seed-again', op: 'seed', seedId: 'seed-1'
    });
    expect(same.ok).toBe(true);
    if (same.ok) expect(same.deduped).toBe(true);

    const other = await persistBriefUpdate({
      environment: ENV, year: YEAR, weekNum: WEEK,
      update: Y.encodeStateAsUpdate(doc), requestId: 'r-seed-other', op: 'seed', seedId: 'seed-2'
    });
    expect(other.ok).toBe(false);
    if (!other.ok) expect(other.reason).toBe('already-seeded');
  });

  it('비운영 환경에서는 Brief 미러를 쓰지 않는다 (환경 격리)', async () => {
    // Brief 에는 environment 컬럼이 없다. 프리뷰/개발이 미러를 쓰면 운영 요약본을 덮는다.
    const doc = await seed();
    const res = await persistBriefUpdate({
      environment: ENV, year: YEAR, weekNum: WEEK,
      update: edit(doc, () => appendParagraph(doc, '프리뷰에서 친 글')),
      requestId: 'r-preview', op: 'normal', docGeneration: 1, writeEpoch: 1,
      actorUserId: userId
    });
    expect(res.ok).toBe(true);
    expect(await prisma.brief.findUnique({ where: { year_weekNum: { year: YEAR, weekNum: WEEK } } })).toBeNull();
  });

  it('운영 환경의 일반 저장이 Brief 미러를 갱신한다', async () => {
    const doc = buildBriefDoc('<p>초기 내용</p>', '초기 제목', 'seed-prod');
    await persistBriefUpdate({
      environment: 'production', year: YEAR, weekNum: WEEK,
      update: Y.encodeStateAsUpdate(doc), requestId: 'r-seed-prod', op: 'seed', seedId: 'seed-prod'
    });
    const update = edit(doc, () => appendParagraph(doc, '추가된 문단'));

    const res = await persistBriefUpdate({
      environment: 'production', year: YEAR, weekNum: WEEK,
      update, requestId: 'r-1', op: 'normal', docGeneration: 1, writeEpoch: 1,
      actorUserId: userId
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.revision).toBe(2);

    const brief = await prisma.brief.findUniqueOrThrow({ where: { year_weekNum: { year: YEAR, weekNum: WEEK } } });
    expect(brief.content).toContain('추가된 문단');
    expect(brief.content).toContain('초기 내용');
    expect(brief.title).toBe('초기 제목');

    const stored = await prisma.briefDoc.findUniqueOrThrow({
      where: { environment_year_weekNum: { environment: 'production', year: YEAR, weekNum: WEEK } }
    });
    expect(stored.html).toContain('추가된 문단');
  });

  it('룸이 알던 문서가 교체됐으면 저장을 거부한다 (재시드 병합 방지)', async () => {
    // 행을 지웠다 다시 만들면 세대·에폭이 1 로 되돌아가 fencing 이 통하지 않는다.
    // 그대로 얹으면 독립 생성된 두 Y.Doc 이 병합돼 본문이 두 벌이 되고 제목은 한쪽이 사라진다.
    const doc = await seed();
    const res = await persistBriefUpdate({
      environment: ENV, year: YEAR, weekNum: WEEK,
      update: edit(doc, () => appendParagraph(doc, '구 룸이 보낸 편집')),
      requestId: 'r-stale-room', op: 'normal', docGeneration: 1, writeEpoch: 1,
      expectedSeedId: 'seed-그전것'
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('seed-mismatch');
  });

  it('광역 삭제 직전 상태를 스냅샷으로 남긴다', async () => {
    const long = '<p>' + '요약 내용 '.repeat(60) + '</p>';
    const doc = buildBriefDoc(long, '제목', 'seed-snap');
    await persistBriefUpdate({
      environment: ENV, year: YEAR, weekNum: WEEK,
      update: Y.encodeStateAsUpdate(doc), requestId: 'r-snap-seed', op: 'seed', seedId: 'seed-snap'
    });

    // 전체 삭제
    const wipe = edit(doc, () => { const f = doc.getXmlFragment('default'); f.delete(0, f.length); });
    const res = await persistBriefUpdate({
      environment: ENV, year: YEAR, weekNum: WEEK,
      update: wipe, requestId: 'r-wipe', op: 'normal', docGeneration: 1, writeEpoch: 1
    });
    expect(res.ok).toBe(true);

    const snaps = await prisma.briefDocSnapshot.findMany({ where: { reason: 'bulk-delete' } });
    expect(snaps.length).toBe(1);
    // 스냅샷은 '지운 뒤'가 아니라 '지우기 직전' 상태여야 복구에 쓸 수 있다
    const before = new Y.Doc();
    Y.applyUpdate(before, new Uint8Array(snaps[0].ydoc));
    expect(before.getXmlFragment('default').length).toBeGreaterThan(0);
  });

  it('잠긴 주차는 직접 저장을 호출해도 거부된다', async () => {
    const doc = await seed();
    // 잠금의 진실원본은 Brief 다 (요약본 잠금 UI 가 그 값을 쓴다)
    await prisma.brief.create({
      data: { year: YEAR, weekNum: WEEK, title: 't', content: '<p>확정</p>', isLocked: true, createdBy: userId }
    });
    const before = await prisma.briefDoc.findUniqueOrThrow({
      where: { environment_year_weekNum: { environment: ENV, year: YEAR, weekNum: WEEK } }
    });

    const update = edit(doc, () => appendParagraph(doc, '잠긴 뒤 편집'));
    const res = await persistBriefUpdate({
      environment: ENV, year: YEAR, weekNum: WEEK,
      update, requestId: 'r-locked', op: 'normal', docGeneration: 1, writeEpoch: 1
    });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('locked');

    const after = await prisma.briefDoc.findUniqueOrThrow({
      where: { environment_year_weekNum: { environment: ENV, year: YEAR, weekNum: WEEK } }
    });
    expect(after.revision).toBe(before.revision);
    expect(after.html).not.toContain('잠긴 뒤 편집');
  });

  it('세대·에폭이 어긋난 저장은 거부된다', async () => {
    const doc = await seed();
    const update = edit(doc, () => appendParagraph(doc, 'x'));

    const gen = await persistBriefUpdate({
      environment: ENV, year: YEAR, weekNum: WEEK,
      update, requestId: 'r-gen', op: 'normal', docGeneration: 2, writeEpoch: 1
    });
    expect(gen.ok).toBe(false);
    if (!gen.ok) expect(gen.reason).toBe('generation-mismatch');

    const epoch = await persistBriefUpdate({
      environment: ENV, year: YEAR, weekNum: WEEK,
      update, requestId: 'r-epoch', op: 'normal', docGeneration: 1, writeEpoch: 7
    });
    expect(epoch.ok).toBe(false);
    if (!epoch.ok) expect(epoch.reason).toBe('epoch-mismatch');
  });

  it('같은 requestId 재전송은 revision 을 중복 증가시키지 않는다', async () => {
    const doc = await seed();
    const update = edit(doc, () => appendParagraph(doc, '한 번만'));

    const a = await persistBriefUpdate({
      environment: ENV, year: YEAR, weekNum: WEEK,
      update, requestId: 'r-same', op: 'normal', docGeneration: 1, writeEpoch: 1
    });
    const b = await persistBriefUpdate({
      environment: ENV, year: YEAR, weekNum: WEEK,
      update, requestId: 'r-same', op: 'normal', docGeneration: 1, writeEpoch: 1
    });
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(b.revision).toBe(a.revision);
      expect(b.deduped).toBe(true);
    }

    const stored = await prisma.briefDoc.findUniqueOrThrow({
      where: { environment_year_weekNum: { environment: ENV, year: YEAR, weekNum: WEEK } }
    });
    expect(stored.revision).toBe(2);
    // 내용도 한 벌이어야 한다
    expect(stored.html.match(/한 번만/g)?.length).toBe(1);
  });

  it('멱등 재전송이 잠금 이후 올라간 에폭을 흘리지 않는다', async () => {
    const doc = await seed();
    const update = edit(doc, () => appendParagraph(doc, 'y'));
    await persistBriefUpdate({
      environment: ENV, year: YEAR, weekNum: WEEK,
      update, requestId: 'r-fence', op: 'normal', docGeneration: 1, writeEpoch: 1
    });

    await prisma.briefDoc.updateMany({
      where: { environment: ENV, year: YEAR, weekNum: WEEK }, data: { writeEpoch: 5 }
    });

    const retry = await persistBriefUpdate({
      environment: ENV, year: YEAR, weekNum: WEEK,
      update, requestId: 'r-fence', op: 'normal', docGeneration: 1, writeEpoch: 1
    });
    expect(retry.ok).toBe(true);
    if (retry.ok) expect(retry.writeEpoch).toBe(1);   // 최신값 5 를 돌려주면 fencing 이 뚫린다
  });

  it('문서가 없으면 일반 저장은 not-found', async () => {
    const doc = buildBriefDoc('<p>없는 문서</p>', '', 's');
    const res = await persistBriefUpdate({
      environment: ENV, year: YEAR, weekNum: WEEK,
      update: Y.encodeStateAsUpdate(doc), requestId: 'r-nf', op: 'normal'
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('not-found');
  });

  it('Brief 행이 없고 작성자를 모르면 미러를 만들지 않는다', async () => {
    const doc = await seed();
    const update = edit(doc, () => appendParagraph(doc, '작성자 미상'));

    const res = await persistBriefUpdate({
      environment: ENV, year: YEAR, weekNum: WEEK,
      update, requestId: 'r-anon', op: 'normal', docGeneration: 1, writeEpoch: 1
    });
    expect(res.ok).toBe(true);
    // createdBy 에 의미 없는 값을 넣느니 미러를 건너뛴다
    expect(await prisma.brief.findUnique({ where: { year_weekNum: { year: YEAR, weekNum: WEEK } } })).toBeNull();
  });

  it('restore 는 병합이 아니라 치환이다', async () => {
    const doc = await seed('<p>원본</p>', 't');
    await persistBriefUpdate({
      environment: ENV, year: YEAR, weekNum: WEEK,
      update: edit(doc, () => appendParagraph(doc, '나중에 지울 문단')),
      requestId: 'r-a', op: 'normal', docGeneration: 1, writeEpoch: 1
    });

    // 과거 스냅샷(추가 이전 상태)으로 되돌린다
    const snapshot = buildBriefDoc('<p>원본</p>', 't', 'seed-1');
    const res = await persistBriefUpdate({
      environment: ENV, year: YEAR, weekNum: WEEK,
      update: Y.encodeStateAsUpdate(snapshot), requestId: 'r-restore', op: 'restore',
      actorUserId: userId
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.docGeneration).toBe(2);   // 새 세대 → 구 룸의 늦은 저장 차단
      expect(res.writeEpoch).toBe(1);
    }

    const stored = await prisma.briefDoc.findUniqueOrThrow({
      where: { environment_year_weekNum: { environment: ENV, year: YEAR, weekNum: WEEK } }
    });
    // Yjs update 는 가산적이라 얹기만 하면 삭제가 되돌아오지 않는다
    expect(stored.html).not.toContain('나중에 지울 문단');
    expect(stored.html).toContain('원본');
  });
});

d('요약본 시드', () => {
  let userId = 0;

  beforeAll(async () => {
    prisma = prisma ?? new PrismaClient({ datasources: { db: { url: TEST_URL } } });
    ({ persistBriefUpdate } = await import('./briefPersist'));
    ({ ensureBriefDocument } = await import('./briefSeed'));
  });

  beforeEach(async () => {
    await prisma.persistReceipt.deleteMany();
    await prisma.briefDoc.deleteMany();
    await prisma.brief.deleteMany();
    await prisma.userTeam.deleteMany();
    await prisma.user.deleteMany();
    await prisma.team.deleteMany();
    const team = await prisma.team.create({ data: { name: `팀-s-${Math.random()}` } });
    const user = await prisma.user.create({
      data: { name: '이현우', password: 'x', role: 'teamMaster', teamId: team.id }
    });
    userId = user.id;
  });

  it('기존 요약본 내용으로 시드되고, 두 번째 호출은 아무것도 하지 않는다', async () => {
    await prisma.brief.create({
      data: {
        year: YEAR, weekNum: WEEK, title: '2026년 32주차 요약',
        content: '<h2>주요 성과</h2><table><tbody><tr><td><p>지표</p></td></tr></tbody></table>',
        createdBy: userId
      }
    });

    const first = await ensureBriefDocument(ENV, YEAR, WEEK, userId);
    expect(first.created).toBe(true);
    expect(first.seededFromExisting).toBe(true);

    const doc = await prisma.briefDoc.findUniqueOrThrow({
      where: { environment_year_weekNum: { environment: ENV, year: YEAR, weekNum: WEEK } }
    });
    expect(doc.title).toBe('2026년 32주차 요약');
    expect(doc.html).toContain('주요 성과');
    expect(doc.html).toMatch(/<table[^>]*>/);   // 표가 살아 있어야 한다

    const second = await ensureBriefDocument(ENV, YEAR, WEEK, userId);
    expect(second.created).toBe(false);
    expect(second.reason).toBe('already-exists');

    const after = await prisma.briefDoc.findUniqueOrThrow({
      where: { environment_year_weekNum: { environment: ENV, year: YEAR, weekNum: WEEK } }
    });
    expect(after.revision).toBe(doc.revision);
  });

  it('잠긴 주차는 시드하지 않는다', async () => {
    await prisma.brief.create({
      data: { year: YEAR, weekNum: WEEK, title: 't', content: '<p>확정</p>', isLocked: true, createdBy: userId }
    });
    const res = await ensureBriefDocument(ENV, YEAR, WEEK, userId);
    expect(res.created).toBe(false);
    expect(res.reason).toBe('locked');
    expect(await prisma.briefDoc.count()).toBe(0);
  });

  it('기존 요약본이 없어도 빈 문서로 시작할 수 있다', async () => {
    const res = await ensureBriefDocument(ENV, YEAR, WEEK, userId);
    expect(res.created).toBe(true);
    expect(res.seededFromExisting).toBe(false);
    // 빈 시드가 기존 Brief 를 만들어내면 안 된다 (조회 화면에 빈 요약본이 생긴다)
    expect(await prisma.brief.count()).toBe(0);
  });
});
