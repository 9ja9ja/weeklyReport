/**
 * 과거 주차를 SharedDoc 으로 백필한다.
 *
 * 스크립트(prisma/*.mjs)가 아니라 라이브러리로 둔 이유: 백필은 buildDoc/materialize 와
 * 같은 변환 규칙을 써야 하는데, prisma 스크립트는 순수 node ESM 이라 TS 모듈을 import 할 수 없다.
 * 변환 로직을 두 벌 만들면 반드시 어긋나므로 보호된 API 라우트에서 이 함수를 호출한다.
 */
import * as Y from 'yjs';
import { prisma } from '../db';
import { buildDocFromState, type EditorState } from './buildDoc';
import { materialize } from './materialize';
import type { ContentBlock } from '../reportBlocks';

export interface BackfillOptions {
  environment: string;
  /** true 면 아무것도 쓰지 않고 계획만 돌려준다 */
  dryRun: boolean;
  /** 이미 SharedDoc 이 있는 키도 덮어쓴다. 편집 이력이 있으면 여전히 건너뛴다 */
  force?: boolean;
  /** 특정 팀만 */
  teamId?: number;
}

export interface BackfillItem {
  teamId: number;
  teamName: string;
  year: number;
  weekNum: number;
  source: 'summary' | 'reports' | null;
  categories: number;
  blocks: number;
  /** 원본 대비 블록 수 차이 — 0 이어야 정상 */
  diff: number;
  status: 'created' | 'updated' | 'skipped-exists' | 'skipped-edited' | 'skipped-empty' | 'skipped-diff' | 'error' | 'dry' | 'dry-update';
  note?: string;
}

export interface BackfillReport {
  dryRun: boolean;
  scanned: number;
  items: BackfillItem[];
  totals: { created: number; updated: number; skipped: number; diffNonZero: number };
  /** authorText → userId 역매핑 실패율. 높으면 중단하고 원인을 봐야 한다 */
  authorMapping: { total: number; mapped: number; unmapped: number; unmappedSamples: string[] };
  /** 임계 초과 등으로 쓰기를 하지 않고 중단했다면 사유 */
  aborted?: string;
}

/** 작성자 역매핑 실패율이 이 값을 넘으면 아무것도 쓰지 않는다 */
const AUTHOR_UNMAPPED_THRESHOLD = 0.2;

function safeParse(s: string | null | undefined): EditorState {
  if (!s) return {};
  try {
    const v = JSON.parse(s);
    return v && typeof v === 'object' ? (v as EditorState) : {};
  } catch { return {}; }
}

function countBlocks(state: EditorState): { categories: number; blocks: number } {
  let blocks = 0;
  const cats = Object.keys(state);
  for (const k of cats) {
    blocks += (state[k]?.current?.length ?? 0) + (state[k]?.next?.length ?? 0);
  }
  return { categories: cats.length, blocks };
}

/**
 * authorText → userId 역매핑.
 *
 * User.teamId 는 주 소속팀이라 겸직자를 놓친다. UserTeam 기준으로 찾아야
 * 다른 팀 소속 겸직자의 작성분이 누락되지 않는다.
 * 자유 텍스트("재영·민수" 등)는 매칭되지 않으며, 그 경우 null 로 두고 authorText 는 보존한다.
 */
async function buildAuthorMap(teamId: number): Promise<Map<string, number>> {
  const members = await prisma.user.findMany({
    where: { userTeams: { some: { teamId } } },
    select: { id: true, name: true }
  });
  const m = new Map<string, number>();
  const dup = new Set<string>();
  for (const u of members) {
    if (m.has(u.name)) dup.add(u.name);   // 동명이인은 매핑하지 않는다
    m.set(u.name, u.id);
  }
  for (const name of dup) m.delete(name);
  return m;
}

function stampAuthorIds(
  state: EditorState, authorMap: Map<string, number>, stats: { total: number; mapped: number; unmapped: string[] }
): EditorState {
  const out: EditorState = {};
  for (const [catId, cat] of Object.entries(state)) {
    const conv = (list: ContentBlock[] | undefined) =>
      (list ?? []).map(b => {
        const text = (b as { authorText?: string }).authorText ?? '';
        if (text) {
          stats.total++;
          const id = authorMap.get(text);
          if (id != null) stats.mapped++;
          else if (stats.unmapped.length < 20) stats.unmapped.push(text);
          return { ...b, authorId: id ?? null };
        }
        return { ...b, authorId: null };
      });
    out[catId] = { current: conv(cat?.current), next: conv(cat?.next) };
  }
  return out;
}

/** summaryGenerator 와 같은 규칙으로 개인 보고를 팀 단위로 합친다 */
async function mergeFromReports(teamId: number, year: number, weekNum: number): Promise<EditorState> {
  const reports = await prisma.report.findMany({
    where: { year, weekNum, items: { some: { category: { teamId } } } },
    include: { user: true, items: { where: { category: { teamId } } } }
  });

  const map: EditorState = {};
  for (const report of reports) {
    const userName = report.user.name;
    for (const item of report.items) {
      const key = String(item.categoryId);
      if (!map[key]) map[key] = { current: [], next: [] };
      const cur = safeArray(item.currentContents);
      const nxt = safeArray(item.nextContents);
      cur.forEach(b => map[key].current.push({ ...b, authorText: b.authorText || userName }));
      nxt.forEach(b => map[key].next.push({ ...b, authorText: b.authorText || userName }));
    }
  }
  return map;
}

function safeArray(s: string): (ContentBlock & { authorText?: string })[] {
  try {
    const v = typeof s === 'string' ? JSON.parse(s) : s;
    return Array.isArray(v) ? v : [];
  } catch { return []; }
}

export async function runBackfill(opts: BackfillOptions): Promise<BackfillReport> {
  // 1패스: 계획과 작성자 매핑 통계를 먼저 계산한다.
  // 매핑 실패율이 높으면 아무것도 쓰지 않고 중단해야 하는데, 쓰기와 같은 루프에서 누적하면
  // 이미 절반쯤 쓴 뒤에야 알게 된다.
  const plan = await scan(opts, true);
  if (opts.dryRun) return plan;

  const { total, mapped } = plan.authorMapping;
  const rate = total > 0 ? (total - mapped) / total : 0;
  if (rate > AUTHOR_UNMAPPED_THRESHOLD) {
    return {
      ...plan,
      aborted:
        `작성자 역매핑 실패율 ${(rate * 100).toFixed(1)}% 가 임계 ` +
        `${(AUTHOR_UNMAPPED_THRESHOLD * 100).toFixed(0)}% 를 넘어 아무것도 쓰지 않았습니다. ` +
        `팀원 명단과 취합본의 작성자 표기를 확인해주세요.`
    };
  }

  // 2패스: 실제 쓰기
  return scan(opts, false);
}

async function scan(opts: BackfillOptions, dryRunPass: boolean): Promise<BackfillReport> {
  const { environment, force = false, teamId: onlyTeam } = opts;
  const dryRun = dryRunPass;

  // 대상 키 = SummaryData 의 (teamId, year, week) ∪ 개인 보고가 있는 (teamId, year, week)
  const summaries = await prisma.summaryData.findMany({
    where: onlyTeam ? { teamId: onlyTeam } : {},
    select: { teamId: true, year: true, weekNum: true }
  });
  // ReportItem 전 행을 메모리로 끌어오지 않는다. @@unique([reportId, categoryId]) 때문에
  // distinct 가 한 행도 줄이지 못해 수십만 행이 그대로 올라온다. DB 에서 집계한다.
  const reportKeys = onlyTeam
    ? await prisma.$queryRaw<{ teamId: number; year: number; weekNum: number }[]>`
        SELECT DISTINCT c."teamId" AS "teamId", r."year" AS "year", r."weekNum" AS "weekNum"
        FROM "ReportItem" ri
        JOIN "Category" c ON c."id" = ri."categoryId"
        JOIN "Report" r ON r."id" = ri."reportId"
        WHERE c."teamId" = ${onlyTeam}`
    : await prisma.$queryRaw<{ teamId: number; year: number; weekNum: number }[]>`
        SELECT DISTINCT c."teamId" AS "teamId", r."year" AS "year", r."weekNum" AS "weekNum"
        FROM "ReportItem" ri
        JOIN "Category" c ON c."id" = ri."categoryId"
        JOIN "Report" r ON r."id" = ri."reportId"`;

  const keySet = new Map<string, { teamId: number; year: number; weekNum: number }>();
  for (const s of summaries) keySet.set(`${s.teamId}:${s.year}:${s.weekNum}`, s);
  for (const r of reportKeys) {
    keySet.set(`${r.teamId}:${r.year}:${r.weekNum}`, { teamId: r.teamId, year: r.year, weekNum: r.weekNum });
  }

  const teams = new Map<number, string>();
  for (const t of await prisma.team.findMany({ select: { id: true, name: true } })) teams.set(t.id, t.name);

  const items: BackfillItem[] = [];
  const authorStats = { total: 0, mapped: 0, unmapped: [] as string[] };
  const authorMapCache = new Map<number, Map<string, number>>();

  for (const key of keySet.values()) {
    const { teamId, year, weekNum } = key;
    const teamName = teams.get(teamId) ?? `팀#${teamId}`;
    try {

    const existing = await prisma.sharedDoc.findUnique({
      where: { environment_teamId_year_weekNum: { environment, teamId, year, weekNum } },
      select: { id: true, docGeneration: true, revision: true }
    });

    // 이미 공동 편집이 일어난 문서는 --force 라도 덮지 않는다
    if (existing) {
      const edited = await prisma.docActivity.count({
        where: { environment, teamId, year, weekNum, lastEditedAt: { not: null } }
      });
      if (edited > 0) {
        items.push({ teamId, teamName, year, weekNum, source: null, categories: 0, blocks: 0, diff: 0,
          status: 'skipped-edited', note: `편집 이력 ${edited}건` });
        continue;
      }
      if (!force) {
        items.push({ teamId, teamName, year, weekNum, source: null, categories: 0, blocks: 0, diff: 0,
          status: 'skipped-exists' });
        continue;
      }
    }

    // 원본 결정 — 마스터가 손본 취합본이 우선
    const summary = await prisma.summaryData.findUnique({
      where: { teamId_year_weekNum: { teamId, year, weekNum } },
      select: { contents: true }
    });
    let source: 'summary' | 'reports' = 'summary';
    let state = safeParse(summary?.contents);
    if (Object.keys(state).length === 0) {
      source = 'reports';
      state = await mergeFromReports(teamId, year, weekNum);
    }

    const before = countBlocks(state);
    if (before.blocks === 0) {
      items.push({ teamId, teamName, year, weekNum, source, categories: before.categories, blocks: 0, diff: 0,
        status: 'skipped-empty' });
      continue;
    }

    if (!authorMapCache.has(teamId)) authorMapCache.set(teamId, await buildAuthorMap(teamId));
    const stamped = stampAuthorIds(state, authorMapCache.get(teamId)!, authorStats);

    // 왕복 검증 — 백필로 내용이 바뀌면 안 된다
    const seedId = `migrate-${teamId}-${year}-${weekNum}`;
    // 잠긴 과거 주차는 문서 meta 에도 잠금으로 표시한다(표시용 — 권한 판정은 서버가 다시 한다)
    const lockRow = await prisma.summaryLock.findUnique({
      where: { teamId_year_weekNum: { teamId, year, weekNum } },
      select: { isLocked: true }
    });
    const doc = buildDocFromState(stamped, {
      teamId, year, weekNum, seedId, isLocked: lockRow?.isLocked === true
    });
    const after = countBlocks(materialize(doc));
    const diff = after.blocks - before.blocks;

    if (dryRun) {
      items.push({
        teamId, teamName, year, weekNum, source,
        categories: before.categories, blocks: before.blocks, diff,
        status: existing ? 'dry-update' : 'dry',
        note: diff !== 0 ? `왕복에서 블록 수가 ${before.blocks}→${after.blocks} 로 변합니다 (쓰기 대상 제외)` : undefined
      });
      continue;
    }

    // 왕복에서 내용이 변하면 절대 쓰지 않는다.
    // 되돌리기 어려운 마이그레이션에서 조용한 소실을 만드는 것보다 건너뛰고 보고하는 편이 낫다.
    if (diff !== 0) {
      items.push({
        teamId, teamName, year, weekNum, source,
        categories: before.categories, blocks: before.blocks, diff,
        status: 'skipped-diff', note: `블록 ${before.blocks}→${after.blocks}`
      });
      continue;
    }

    const ydoc = Buffer.from(Y.encodeStateAsUpdate(doc));
    const contents = JSON.stringify(materialize(doc));
    const seededFrom = source === 'summary' ? 'migrate:summary' : 'migrate:reports';

    if (existing) {
      // 덮어쓰기는 사실상 복원과 같다. 세대를 올려 접속 중인 클라이언트가 로컬 상태를 폐기하게 하고,
      // 덮기 전 상태를 스냅샷으로 남겨 되돌릴 수 있게 한다.
      await prisma.$transaction(async tx => {
        const cur = await tx.sharedDoc.findUniqueOrThrow({ where: { id: existing.id } });
        await tx.sharedDocSnapshot.create({
          data: {
            docId: cur.id, ydoc: cur.ydoc,
            docGeneration: cur.docGeneration, revision: cur.revision, reason: 'pre-restore'
          }
        });
        await tx.sharedDoc.update({
          where: { id: cur.id },
          data: {
            ydoc, contents, seedId, seededFrom,
            revision: { increment: 1 },
            docGeneration: { increment: 1 },
            writeEpoch: 1
          }
        });
      });
      items.push({ teamId, teamName, year, weekNum, source, categories: before.categories, blocks: before.blocks, diff, status: 'updated' });
    } else {
      await prisma.sharedDoc.create({
        data: { environment, teamId, year, weekNum, ydoc, contents, seedId, seededFrom, revision: 1 }
      });
      items.push({ teamId, teamName, year, weekNum, source, categories: before.categories, blocks: before.blocks, diff, status: 'created' });
    }
    } catch (e) {
      // 한 주차가 깨져도 나머지는 계속 진행한다. 어디서 멈췄는지 보고서로 남긴다.
      items.push({
        teamId, teamName, year, weekNum, source: null, categories: 0, blocks: 0, diff: 0,
        status: 'error', note: String(e).slice(0, 200)
      });
    }
  }

  const totals = {
    created: items.filter(i => i.status === 'created').length,
    updated: items.filter(i => i.status === 'updated').length,
    skipped: items.filter(i => i.status.startsWith('skipped')).length,
    diffNonZero: items.filter(i => i.diff !== 0).length
  };

  return {
    dryRun,
    scanned: keySet.size,
    items,
    totals,
    authorMapping: {
      total: authorStats.total,
      mapped: authorStats.mapped,
      unmapped: authorStats.total - authorStats.mapped,
      unmappedSamples: authorStats.unmapped
    }
  };
}
