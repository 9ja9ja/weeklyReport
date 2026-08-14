/**
 * 공유 문서(Y.Doc)의 내부 레이아웃 정의.
 *
 * 이 파일이 Y.Doc 구조의 단일 기준점이다. buildDoc(JSON → Y.Doc), materialize(Y.Doc → JSON),
 * yOps(편집 연산), party 서버가 모두 여기의 키·타입 상수를 쓴다.
 *
 * ── 레이아웃 ───────────────────────────────────────────────────
 *  meta: Y.Map { teamId, year, weekNum, docGeneration, seedId, schemaVersion, isLocked }
 *  cats: Y.Map<catId, Y.Map{ current: Y.Map<blockId, YBlock>, next: Y.Map<blockId, YBlock> }>
 *
 *  YBlock(sub)   = Y.Map { type:'sub',   order, authorId, authorText,
 *                          subText: Y.Text,
 *                          bullets: Y.Map<bulletId, Y.Map{ order, text: Y.Text }> }
 *  YBlock(table) = Y.Map { type:'table', order, authorId, authorText,
 *                          caption: Y.Text,
 *                          cols: Y.Map<colId, Y.Map{ order, header: string }>,
 *                          rows: Y.Map<rowId, Y.Map{ order }>,
 *                          cells: Y.Map<`${rowId}:${colId}`, string>,
 *                          merges: Y.Map<mergeId, Y.Map{ ar, ac, er, ec }> }
 *
 * ── 왜 Y.Array 가 아니라 Y.Map + order 인가 ────────────────────
 * Y.Array 에서 드래그 이동은 delete + insert 인데, 두 사람이 같은 블록을 동시에 옮기면
 * delete 는 병합되지만 insert 가 둘 다 살아남아 블록이 복제된다.
 * Y.Map + fractional order 는 동시 이동 시 한쪽 위치가 이길 뿐 복제·유실이 없다.
 *
 * ── 정렬은 (order, id) 복합 키 ─────────────────────────────────
 * 서로 다른 사용자가 같은 두 항목 사이에 동시 삽입하면 generateKeyBetween 이 같은 order 를
 * 만들 수 있다. id 로 tie-break 해야 모든 클라이언트가 같은 순서를 본다.
 */
import * as Y from 'yjs';

export const SCHEMA_VERSION = 1;

/** Y.Doc 최상위 키 */
export const ROOT = {
  meta: 'meta',
  cats: 'cats'
} as const;

/** meta 맵의 키 */
export const META = {
  teamId: 'teamId',
  year: 'year',
  weekNum: 'weekNum',
  docGeneration: 'docGeneration',
  seedId: 'seedId',
  schemaVersion: 'schemaVersion',
  /** 표시용 — 권한 판정의 진실원본이 아니다(클라이언트가 바꿀 수 있음). 서버가 항상 재확인한다 */
  isLocked: 'isLocked'
} as const;

/** 카테고리 아래 두 열 */
export type Side = 'current' | 'next';
export const SIDES: Side[] = ['current', 'next'];

/** 블록 공통 필드 */
export const BLOCK = {
  type: 'type',
  order: 'order',
  authorId: 'authorId',
  authorText: 'authorText',
  // sub
  subText: 'subText',
  bullets: 'bullets',
  // table
  caption: 'caption',
  cols: 'cols',
  rows: 'rows',
  cells: 'cells',
  merges: 'merges',
  // 공통 하위
  header: 'header',
  text: 'text'
} as const;

/** 표 셀 키 — rowId 와 colId 에는 ':' 가 들어가지 않는다(generateId 는 base36) */
export const cellKey = (rowId: string, colId: string) => `${rowId}:${colId}`;

/**
 * 병합 한 덩어리. **인덱스가 아니라 양 끝 칸의 id 로 잡는다.**
 *
 * 인덱스로 저장하면 다른 사람이 위에 행을 넣는 순간 좌표가 어긋나 엉뚱한 칸을 덮는다.
 * 끝점을 id 로 두면 안쪽에 행이 생기면 범위가 자연히 늘고, 지워지면 줄어든다.
 * 끝점 자체가 지워진 병합은 materialize 에서 버린다.
 */
export const MERGE = {
  anchorRow: 'ar',
  anchorCol: 'ac',
  endRow: 'er',
  endCol: 'ec'
} as const;

/**
 * 헤더 행의 가상 row ID.
 * 헤더는 rows Y.Map 에 없으므로 병합 끝점에 이 sentinel 을 쓴다.
 * generateId() 는 base36 만 만들어 '__' 로 시작하는 값과 절대 겹치지 않는다.
 */
export const HDR_ROW_ID = '__hdr__';

export type OrderedEntry<T> = { id: string; order: string; value: T };

/**
 * (order, id) 복합 키 정렬. order 가 같을 때 id 로 갈라 모든 클라이언트가 같은 순서를 본다.
 */
export function compareOrdered(a: { id: string; order: string }, b: { id: string; order: string }): number {
  if (a.order < b.order) return -1;
  if (a.order > b.order) return 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Y.Map<id, Y.Map> 을 (order, id) 순으로 정렬해 [id, Y.Map] 배열로 반환 */
export function sortedEntries(map: unknown): [string, Y.Map<unknown>][] {
  // 손상된 문서(컨테이너 자리에 원시값)에서도 예외를 던지지 않아야 한다.
  // materialize 는 저장 트랜잭션 안에서 돌기 때문에 여기서 던지면 그 문서는 영구히 저장 불가가 된다.
  if (!(map instanceof Y.Map)) return [];
  const rows: { id: string; order: string; m: Y.Map<unknown> }[] = [];
  map.forEach((v, id) => {
    if (!(v instanceof Y.Map)) return;
    rows.push({ id, order: String(v.get(BLOCK.order) ?? ''), m: v });
  });
  rows.sort(compareOrdered);
  return rows.map(r => [r.id, r.m]);
}

/** Y.Text 이든 문자열이든 문자열로 읽는다 (마이그레이션 중 혼재 대비) */
export function readText(v: unknown): string {
  if (v instanceof Y.Text) return v.toString();
  return typeof v === 'string' ? v : '';
}
