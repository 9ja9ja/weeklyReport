/**
 * Y.Doc → EditorState JSON (조회용 파생 모델)
 *
 * 출력은 기존 SummaryData.contents 와 형태가 같다. 그래야 overview/PDF/드라이브 내보내기와
 * 숫자 포맷(reportBlocks)이 테이블만 바꿔 그대로 동작한다.
 *
 * 이 변환은 **Next 서버에서만** 수행한다. Worker 가 계산해 보낸 JSON 을 믿으면
 * 룸이 오염됐을 때 그대로 DB 에 실린다. Worker 는 ydoc 바이트만 보낸다.
 */
import * as Y from 'yjs';
import { HEADER_ROW, type CellMerge, type ContentBlock, type SubBlock, type TableBlock } from '../reportBlocks';
import { BLOCK, HDR_ROW_ID, MERGE, META, ROOT, SIDES, cellKey, readText, sortedEntries } from './schema';
import type { EditorState } from './buildDoc';

export interface DocMeta {
  teamId: number | null;
  year: number | null;
  weekNum: number | null;
  seedId: string;
  docGeneration: number;
  schemaVersion: number;
  isLocked: boolean;
}

export function readMeta(doc: Y.Doc): DocMeta {
  const m = doc.getMap(ROOT.meta);
  const num = (k: string): number | null => {
    const v = m.get(k);
    return typeof v === 'number' ? v : null;
  };
  return {
    teamId: num(META.teamId),
    year: num(META.year),
    weekNum: num(META.weekNum),
    seedId: String(m.get(META.seedId) ?? ''),
    docGeneration: num(META.docGeneration) ?? 1,
    schemaVersion: num(META.schemaVersion) ?? 1,
    isLocked: m.get(META.isLocked) === true
  };
}

function materializeSub(id: string, b: Y.Map<unknown>): SubBlock & { authorId?: number | null } {
  const bullets = sortedEntries(b.get(BLOCK.bullets) as Y.Map<unknown> | undefined).map(
    ([bid, bm]) => ({ id: bid, text: readText(bm.get(BLOCK.text)) })
  );
  const authorId = b.get(BLOCK.authorId);
  return {
    id,
    type: 'sub',
    subText: readText(b.get(BLOCK.subText)),
    authorText: String(b.get(BLOCK.authorText) ?? ''),
    authorId: typeof authorId === 'number' ? authorId : null,
    bullets
  };
}

/**
 * 병합 목록을 화면이 쓰는 인덱스 좌표로 되돌린다.
 *
 * 두 사람이 겹치는 범위를 동시에 병합할 수 있는데, 겹친 채로 두면 같은 칸을 두 병합이 덮어
 * rowspan/colspan 이 어긋난 표가 나온다. **id 순으로 먼저 온 것을 남기고 겹치는 것을 버려**
 * 모든 클라이언트가 같은 표를 보게 한다.
 */
function materializeMerges(
  b: Y.Map<unknown>, rowIds: string[], colIds: string[]
): CellMerge[] | undefined {
  const raw = b.get(BLOCK.merges);
  if (!(raw instanceof Y.Map) || raw.size === 0) return undefined;

  const rowIdx = new Map<string, number>(rowIds.map((id, i) => [id, i]));
  rowIdx.set(HDR_ROW_ID, HEADER_ROW);   // 제목줄은 rows 밖이라 sentinel 로 들어와 있다
  const colIdx = new Map(colIds.map((id, i) => [id, i]));

  const candidates: { id: string; m: CellMerge }[] = [];
  raw.forEach((entry, mid) => {
    if (!(entry instanceof Y.Map)) return;
    const r1 = rowIdx.get(String(entry.get(MERGE.anchorRow) ?? ''));
    const r2 = rowIdx.get(String(entry.get(MERGE.endRow) ?? ''));
    const c1 = colIdx.get(String(entry.get(MERGE.anchorCol) ?? ''));
    const c2 = colIdx.get(String(entry.get(MERGE.endCol) ?? ''));
    // 끝점 행·열이 지워진 병합은 버린다 — 남기면 어디를 덮는지 알 수 없다
    if (r1 === undefined || r2 === undefined || c1 === undefined || c2 === undefined) return;

    const top = Math.min(r1, r2), bottom = Math.max(r1, r2);
    const left = Math.min(c1, c2), right = Math.max(c1, c2);
    const rowSpan = bottom - top + 1;
    const colSpan = right - left + 1;
    if (rowSpan * colSpan <= 1) return;   // 안쪽이 지워져 한 칸만 남았다 = 병합 아님
    candidates.push({ id: mid, m: { r: top, c: left, rowSpan, colSpan } });
  });

  candidates.sort((a, b2) => (a.id < b2.id ? -1 : a.id > b2.id ? 1 : 0));

  const kept: CellMerge[] = [];
  for (const { m } of candidates) {
    const clash = kept.some(k =>
      m.r <= k.r + k.rowSpan - 1 && m.r + m.rowSpan - 1 >= k.r &&
      m.c <= k.c + k.colSpan - 1 && m.c + m.colSpan - 1 >= k.c
    );
    if (!clash) kept.push(m);
  }
  return kept.length ? kept : undefined;
}

function materializeTable(id: string, b: Y.Map<unknown>): TableBlock & { authorId?: number | null } {
  const colEntries = sortedEntries(b.get(BLOCK.cols) as Y.Map<unknown> | undefined);
  const rowEntries = sortedEntries(b.get(BLOCK.rows) as Y.Map<unknown> | undefined);
  const cells = b.get(BLOCK.cells);
  const cellMap = cells instanceof Y.Map ? cells : null;

  const headers = colEntries.map(([, cm]) => String(cm.get(BLOCK.header) ?? ''));
  const rows = rowEntries.map(([rid]) =>
    colEntries.map(([cid]) => {
      const v = cellMap?.get(cellKey(rid, cid));
      return typeof v === 'string' ? v : '';
    })
  );
  const merges = materializeMerges(b, rowEntries.map(([rid]) => rid), colEntries.map(([cid]) => cid));

  const authorId = b.get(BLOCK.authorId);
  return {
    id,
    type: 'table',
    caption: readText(b.get(BLOCK.caption)),
    headers,
    rows,
    ...(merges ? { merges } : {}),
    authorText: String(b.get(BLOCK.authorText) ?? ''),
    authorId: typeof authorId === 'number' ? authorId : null
  };
}

function materializeBlock(id: string, b: Y.Map<unknown>): ContentBlock {
  return b.get(BLOCK.type) === 'table' ? materializeTable(id, b) : materializeSub(id, b);
}

/**
 * Y.Doc → EditorState.
 * 카테고리 키는 문자열이지만 기존 소비처가 숫자 키 객체로 다루므로 값 형태는 그대로 맞춘다.
 */
export function materialize(doc: Y.Doc): EditorState {
  const out: EditorState = {};
  const cats = doc.getMap(ROOT.cats);

  cats.forEach((cm, catId) => {
    if (!(cm instanceof Y.Map)) return;
    const entry = { current: [] as ContentBlock[], next: [] as ContentBlock[] };
    for (const side of SIDES) {
      const sm = cm.get(side);
      if (!(sm instanceof Y.Map)) continue;
      entry[side] = sortedEntries(sm).map(([id, b]) => materializeBlock(id, b));
    }
    // 양쪽 다 비어 있어도 키는 남긴다 — 기존 contents 도 빈 배열을 담고 있었다
    out[catId] = entry;
  });

  return out;
}

/** materialize 결과를 DB 에 넣을 JSON 문자열로 */
export function materializeToJson(doc: Y.Doc): string {
  return JSON.stringify(materialize(doc));
}

/** 편집 참여자 집계 등에 쓸 authorId 목록 (이월 블록 포함이므로 기여 판정에는 쓰지 않는다) */
export function collectAuthorIds(doc: Y.Doc): number[] {
  const ids = new Set<number>();
  const cats = doc.getMap(ROOT.cats);
  cats.forEach(cm => {
    if (!(cm instanceof Y.Map)) return;
    for (const side of SIDES) {
      const sm = cm.get(side);
      if (!(sm instanceof Y.Map)) continue;
      sm.forEach(b => {
        if (!(b instanceof Y.Map)) return;
        const a = b.get(BLOCK.authorId);
        if (typeof a === 'number') ids.add(a);
      });
    }
  });
  return [...ids];
}
