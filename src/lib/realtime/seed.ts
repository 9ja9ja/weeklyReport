/**
 * 주차 문서 시드 — 전주 차주계획을 금주 진행사항으로 이월한다.
 *
 * 기존에는 클라이언트가 접속할 때마다 개인별로 이월했다(write/page.tsx). 공유 문서에서는
 * 그러면 여러 사람이 각자 이월해 중복·소실이 난다. **서버에서 원자적으로 한 번만** 만든다.
 *
 * 시드는 반드시 persistUpdate(op:'seed') 를 거친다 — advisory lock 이 동시 생성을 직렬화하고,
 * 잠긴 주차에는 만들지 않으며, 이미 있으면 seedId 로 재시드를 걸러낸다.
 */
import * as Y from 'yjs';
import { prisma } from '../db';
import { getPrevWeek } from '../weekUtils';
import { buildDocFromState, type EditorState } from './buildDoc';
import { persistUpdate } from './persist';
import type { ContentBlock } from '../reportBlocks';

export interface SeedResult {
  created: boolean;
  reason?: 'locked' | 'already-exists' | 'failed';
  seedId?: string;
  carriedFrom?: { year: number; weekNum: number } | null;
}

function safeParse(s: string | null | undefined): EditorState {
  if (!s) return {};
  try {
    const v = JSON.parse(s);
    return v && typeof v === 'object' ? (v as EditorState) : {};
  } catch { return {}; }
}

/**
 * 전주 문서의 `next`(차주 진행예정)를 금주 `current`(금주 진행사항)로 옮긴다.
 * 블록 id 는 새로 발급하지 않는다 — 같은 문서 안에서 유일하면 되고, 원본 id 를 유지해야
 * "지난주에 쓴 그 항목"임을 추적할 수 있다. authorId/authorText 는 원저자를 유지한다.
 */
export function carryOver(prev: EditorState): EditorState {
  const out: EditorState = {};
  for (const [catId, cat] of Object.entries(prev ?? {})) {
    const next = Array.isArray(cat?.next) ? (cat.next as ContentBlock[]) : [];
    // 카테고리 컨테이너는 전부 만들어 둔다. 런타임에 클라이언트가 만들면
    // 동시 생성 시 한쪽 블록이 통째로 사라진다(Y.Map 키 LWW).
    out[catId] = { current: next.map(b => ({ ...b })), next: [] };
  }
  return out;
}

/**
 * 해당 팀·주차의 활성 카테고리를 모두 컨테이너로 준비한다.
 * 이월 대상이 없는 카테고리도 미리 만들어 둬야, 주중에 사용자가 처음 쓸 때
 * 클라이언트가 컨테이너를 만들지 않는다.
 */
async function activeCategoryIds(teamId: number): Promise<string[]> {
  const cats = await prisma.category.findMany({
    where: { teamId, isActive: true },
    select: { id: true }
  });
  return cats.map(c => String(c.id));
}

/**
 * 문서가 없으면 만든다. 이미 있으면 아무것도 하지 않는다.
 * 룸 콜드스타트(onLoad)와 사용자 진입 양쪽에서 호출해도 안전하다.
 */
export async function ensureWeekDocument(
  environment: string, teamId: number, year: number, weekNum: number
): Promise<SeedResult> {
  const existing = await prisma.sharedDoc.findUnique({
    where: { environment_teamId_year_weekNum: { environment, teamId, year, weekNum } },
    select: { id: true, seedId: true }
  });
  if (existing) return { created: false, reason: 'already-exists', seedId: existing.seedId };

  // 전주 문서에서 이월. 없으면 빈 문서로 시작한다.
  const prev = getPrevWeek(year, weekNum);
  const prevDoc = await prisma.sharedDoc.findUnique({
    where: {
      environment_teamId_year_weekNum: { environment, teamId, year: prev.year, weekNum: prev.weekNum }
    },
    select: { contents: true }
  });

  const carried = prevDoc ? carryOver(safeParse(prevDoc.contents)) : {};

  // 활성 카테고리 컨테이너를 빠짐없이 준비한다
  for (const catId of await activeCategoryIds(teamId)) {
    if (!carried[catId]) carried[catId] = { current: [], next: [] };
  }

  const seedId = `seed-${teamId}-${year}-${weekNum}-${crypto.randomUUID()}`;
  const seededFrom = prevDoc ? `carry:${prev.year}-${prev.weekNum}` : '';
  const doc = buildDocFromState(carried, { teamId, year, weekNum, seedId });

  const res = await persistUpdate({
    environment, teamId, year, weekNum,
    update: Y.encodeStateAsUpdate(doc),
    requestId: `seed-${crypto.randomUUID()}`,
    op: 'seed',
    seedId,
    seededFrom
  });

  if (!res.ok) {
    return {
      created: false,
      reason: res.reason === 'locked' ? 'locked' : res.reason === 'already-seeded' ? 'already-exists' : 'failed'
    };
  }
  return { created: true, seedId, carriedFrom: prevDoc ? prev : null };
}

/**
 * 런타임에 새 카테고리가 생겼을 때 컨테이너만 추가한다.
 *
 * Phase 0 에서 중분류 추가 권한을 팀원에게 열었으므로 주중에 새 카테고리가 생긴다.
 * 두 클라이언트가 동시에 컨테이너를 만들면 한쪽 블록이 사라지므로 서버가 만든다.
 */
export async function ensureCategoryContainers(
  environment: string, teamId: number, year: number, weekNum: number
): Promise<{ added: string[] }> {
  const row = await prisma.sharedDoc.findUnique({
    where: { environment_teamId_year_weekNum: { environment, teamId, year, weekNum } },
    select: { ydoc: true, contents: true, docGeneration: true, writeEpoch: true }
  });
  if (!row) return { added: [] };

  const present = new Set(Object.keys(safeParse(row.contents)));
  const missing = (await activeCategoryIds(teamId)).filter(id => !present.has(id));
  if (!missing.length) return { added: [] };

  // 기존 문서 위에 컨테이너만 추가하는 증분 update 를 만든다
  const doc = new Y.Doc();
  Y.applyUpdate(doc, new Uint8Array(row.ydoc));
  const before = Y.encodeStateVector(doc);

  doc.transact(() => {
    const cats = doc.getMap('cats');
    for (const id of missing) {
      if (cats.get(id)) continue;
      const cm = new Y.Map();
      cm.set('current', new Y.Map());
      cm.set('next', new Y.Map());
      cats.set(id, cm);
    }
  });

  const res = await persistUpdate({
    environment, teamId, year, weekNum,
    update: Y.encodeStateAsUpdate(doc, before),
    requestId: `cats-${crypto.randomUUID()}`,
    op: 'normal',
    docGeneration: row.docGeneration,
    writeEpoch: row.writeEpoch
  });

  return { added: res.ok ? missing : [] };
}
