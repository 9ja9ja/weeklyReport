/**
 * 공유 문서 편집 연산.
 *
 * 기존 reportBlocks.ts 의 불변 연산(addRow/setCell 등)을 대체한다. 시그니처 개념은 맞춰
 * UI 코드 수정 범위를 좁혔다.
 *
 * 모든 연산은 origin 을 받아 doc.transact(fn, origin) 로 감싼다.
 * Y.UndoManager 가 trackedOrigins 로 "내 변경만" 되돌리려면 로컬 편집에 항상 같은 origin 이
 * 붙어야 한다.
 */
import * as Y from 'yjs';
import { generateKeyBetween } from 'fractional-indexing';
import { generateId } from '../reportBlocks';
import { BLOCK, MERGE, cellKey, compareOrdered, sortedEntries, type Side } from './schema';
import { readSideMap, sideMap } from './buildDoc';

export interface Author {
  authorId: number | null;
  authorText: string;
}

/**
 * 같은 두 항목 사이에 동시 삽입하면 generateKeyBetween 이 같은 order 를 만들 수 있다.
 * jitter 를 붙여 충돌 확률을 낮춘다. 그래도 같으면 (order, id) 정렬이 갈라준다.
 *
 * 주의 — jitter 는 반드시 '0' 이외의 문자로 끝나야 한다.
 * fractional-indexing 의 validateOrderKey 는 소수부가 digits[0]('0')로 끝나는 키를 무효로 보고
 * 예외를 던진다. 그런 키가 목록에 한 번 들어가면 그 키를 이웃으로 넘기는 이후의 모든
 * generateKeyBetween 호출이 실패해, 해당 목록에 영구히 추가·이동을 못 하게 된다.
 */
function jitterSuffix(): string {
  // 마지막 자리는 1~z 에서만 뽑아 '0' 으로 끝나지 않게 한다
  const head = Math.floor(Math.random() * 36 ** 3).toString(36).padStart(3, '0');
  const tail = (1 + Math.floor(Math.random() * 35)).toString(36); // 1..z
  return head + tail;
}

function keyBetween(prev: string | null, next: string | null): string {
  let base: string;
  try {
    base = generateKeyBetween(prev, next);
  } catch {
    // 이웃 order 가 손상됐거나 prev >= next 로 역전된 경우.
    // 경계를 한 단계 완화해 재시도하고, 그래도 안 되면 맨 끝으로 보낸다.
    try {
      base = generateKeyBetween(prev, null);
    } catch {
      base = generateKeyBetween(null, null);
    }
  }

  const candidate = base + jitterSuffix();
  // next 가 있으면 candidate < next 여야 한다. 접미사가 경계를 넘으면 base 를 그대로 쓴다.
  if (next !== null && !(candidate < next)) return base;
  return candidate;
}

/** 목록 끝에 붙일 order */
function orderAtEnd(map: Y.Map<unknown>): string {
  const entries = sortedEntries(map);
  const last = entries.length ? String(entries[entries.length - 1][1].get(BLOCK.order) ?? '') : null;
  return keyBetween(last || null, null);
}

/** 목록 맨 앞에 붙일 order — 표의 "행 위로 추가"(개선요청 4번)에 쓴다 */
function orderAtStart(map: Y.Map<unknown>): string {
  const entries = sortedEntries(map);
  const first = entries.length ? String(entries[0][1].get(BLOCK.order) ?? '') : null;
  return keyBetween(null, first || null);
}

function ytext(s = ''): Y.Text {
  const t = new Y.Text();
  if (s) t.insert(0, s);
  return t;
}

// ── 블록 ────────────────────────────────────────────────────

export function addSubBlock(
  doc: Y.Doc, catId: string | number, side: Side, author: Author, origin?: unknown
): string {
  const sm = sideMap(doc, catId, side, origin);
  const id = generateId();
  doc.transact(() => {
    const m = new Y.Map();
    m.set(BLOCK.type, 'sub');
    m.set(BLOCK.order, orderAtEnd(sm));
    m.set(BLOCK.authorId, author.authorId);
    m.set(BLOCK.authorText, author.authorText);
    m.set(BLOCK.subText, ytext());
    m.set(BLOCK.bullets, new Y.Map());
    sm.set(id, m);
  }, origin);
  return id;
}

export function addTableBlock(
  doc: Y.Doc, catId: string | number, side: Side, author: Author,
  cols = 3, rows = 3, origin?: unknown
): string {
  const sm = sideMap(doc, catId, side, origin);
  const id = generateId();
  doc.transact(() => {
    const m = new Y.Map();
    m.set(BLOCK.type, 'table');
    m.set(BLOCK.order, orderAtEnd(sm));
    m.set(BLOCK.authorId, author.authorId);
    m.set(BLOCK.authorText, author.authorText);
    m.set(BLOCK.caption, ytext());

    const colMap = new Y.Map();
    let prev: string | null = null;
    for (let i = 0; i < cols; i++) {
      const cm = new Y.Map();
      prev = generateKeyBetween(prev, null);
      cm.set(BLOCK.order, prev);
      cm.set(BLOCK.header, '');
      colMap.set(generateId(), cm);
    }
    m.set(BLOCK.cols, colMap);

    const rowMap = new Y.Map();
    prev = null;
    for (let i = 0; i < rows; i++) {
      const rm = new Y.Map();
      prev = generateKeyBetween(prev, null);
      rm.set(BLOCK.order, prev);
      rowMap.set(generateId(), rm);
    }
    m.set(BLOCK.rows, rowMap);
    m.set(BLOCK.cells, new Y.Map());
    // 병합 컨테이너는 여기서 미리 만든다 — 두 사람이 동시에 만들면 한쪽이 통째로 사라진다
    m.set(BLOCK.merges, new Y.Map());
    sm.set(id, m);
  }, origin);
  return id;
}

export function removeBlock(doc: Y.Doc, catId: string | number, side: Side, blockId: string, origin?: unknown): void {
  // 기존 블록을 다루는 연산 — 컨테이너가 없으면 아무것도 만들지 않고 빠진다
  const sm = readSideMap(doc, catId, side);
  if (!sm) return;
  doc.transact(() => { sm.delete(blockId); }, origin);
}

/**
 * 블록을 prevId 와 nextId 사이로 옮긴다. 둘 다 null 이면 맨 앞/뒤.
 * Y.Array 의 delete+insert 와 달리 order 만 바꾸므로 동시 이동에도 복제되지 않는다.
 */
export function moveBlock(
  doc: Y.Doc, catId: string | number, side: Side,
  blockId: string, prevId: string | null, nextId: string | null, origin?: unknown
): void {
  // 기존 블록을 다루는 연산 — 컨테이너가 없으면 아무것도 만들지 않고 빠진다
  const sm = readSideMap(doc, catId, side);
  if (!sm) return;
  doc.transact(() => {
    const b = sm.get(blockId);
    if (!(b instanceof Y.Map)) return;
    const orderOf = (id: string | null): string | null => {
      if (!id) return null;
      const t = sm.get(id);
      return t instanceof Y.Map ? String(t.get(BLOCK.order) ?? '') || null : null;
    };
    b.set(BLOCK.order, keyBetween(orderOf(prevId), orderOf(nextId)));
  }, origin);
}

export function setAuthorText(
  doc: Y.Doc, catId: string | number, side: Side, blockId: string, v: string, origin?: unknown
): void {
  // 기존 블록을 다루는 연산 — 컨테이너가 없으면 아무것도 만들지 않고 빠진다
  const sm = readSideMap(doc, catId, side);
  if (!sm) return;
  doc.transact(() => {
    const b = sm.get(blockId);
    if (b instanceof Y.Map) b.set(BLOCK.authorText, v);
  }, origin);
}

// ── 불릿 ────────────────────────────────────────────────────

export function addBullet(
  doc: Y.Doc, catId: string | number, side: Side, blockId: string, origin?: unknown
): string | null {
  // 기존 블록을 다루는 연산 — 컨테이너가 없으면 아무것도 만들지 않고 빠진다
  const sm = readSideMap(doc, catId, side);
  if (!sm) return null;
  let id: string | null = null;
  doc.transact(() => {
    const b = sm.get(blockId);
    if (!(b instanceof Y.Map)) return;
    const bullets = b.get(BLOCK.bullets);
    if (!(bullets instanceof Y.Map)) return;
    id = generateId();
    const bm = new Y.Map();
    bm.set(BLOCK.order, orderAtEnd(bullets));
    bm.set(BLOCK.text, ytext());
    bullets.set(id, bm);
  }, origin);
  return id;
}

export function removeBullet(
  doc: Y.Doc, catId: string | number, side: Side, blockId: string, bulletId: string, origin?: unknown
): void {
  // 기존 블록을 다루는 연산 — 컨테이너가 없으면 아무것도 만들지 않고 빠진다
  const sm = readSideMap(doc, catId, side);
  if (!sm) return;
  doc.transact(() => {
    const b = sm.get(blockId);
    const bullets = b instanceof Y.Map ? b.get(BLOCK.bullets) : null;
    if (bullets instanceof Y.Map) bullets.delete(bulletId);
  }, origin);
}

export function moveBullet(
  doc: Y.Doc, catId: string | number, side: Side, blockId: string,
  bulletId: string, prevId: string | null, nextId: string | null, origin?: unknown
): void {
  // 기존 블록을 다루는 연산 — 컨테이너가 없으면 아무것도 만들지 않고 빠진다
  const sm = readSideMap(doc, catId, side);
  if (!sm) return;
  doc.transact(() => {
    const b = sm.get(blockId);
    const bullets = b instanceof Y.Map ? b.get(BLOCK.bullets) : null;
    if (!(bullets instanceof Y.Map)) return;
    const bm = bullets.get(bulletId);
    if (!(bm instanceof Y.Map)) return;
    const orderOf = (id: string | null): string | null => {
      if (!id) return null;
      const t = bullets.get(id);
      return t instanceof Y.Map ? String(t.get(BLOCK.order) ?? '') || null : null;
    };
    bm.set(BLOCK.order, keyBetween(orderOf(prevId), orderOf(nextId)));
  }, origin);
}

// ── 표 ──────────────────────────────────────────────────────

/** 셀 편집 — 셀 단위 LWW. 빈 문자열은 키를 지워 문서 크기를 줄인다 */
export function setCell(
  doc: Y.Doc, catId: string | number, side: Side, blockId: string,
  rowId: string, colId: string, v: string, origin?: unknown
): void {
  // 기존 블록을 다루는 연산 — 컨테이너가 없으면 아무것도 만들지 않고 빠진다
  const sm = readSideMap(doc, catId, side);
  if (!sm) return;
  doc.transact(() => {
    const b = sm.get(blockId);
    const cells = b instanceof Y.Map ? b.get(BLOCK.cells) : null;
    if (!(cells instanceof Y.Map)) return;
    const k = cellKey(rowId, colId);
    if (v === '') cells.delete(k);
    else cells.set(k, v);
  }, origin);
}

export function setHeader(
  doc: Y.Doc, catId: string | number, side: Side, blockId: string,
  colId: string, v: string, origin?: unknown
): void {
  // 기존 블록을 다루는 연산 — 컨테이너가 없으면 아무것도 만들지 않고 빠진다
  const sm = readSideMap(doc, catId, side);
  if (!sm) return;
  doc.transact(() => {
    const b = sm.get(blockId);
    const cols = b instanceof Y.Map ? b.get(BLOCK.cols) : null;
    if (!(cols instanceof Y.Map)) return;
    const cm = cols.get(colId);
    if (cm instanceof Y.Map) cm.set(BLOCK.header, v);
  }, origin);
}

/**
 * 행 삽입. position 으로 위/아래를 고른다 — 개선요청 4번(매출정산은 최근 내역이 위로).
 * anchorRowId 를 주면 그 행의 바로 위/아래에 넣는다.
 */
export function insertRow(
  doc: Y.Doc, catId: string | number, side: Side, blockId: string,
  position: 'top' | 'bottom' | 'above' | 'below' = 'bottom',
  anchorRowId?: string, origin?: unknown
): string | null {
  // 기존 블록을 다루는 연산 — 컨테이너가 없으면 아무것도 만들지 않고 빠진다
  const sm = readSideMap(doc, catId, side);
  if (!sm) return null;
  let id: string | null = null;
  doc.transact(() => {
    const b = sm.get(blockId);
    const rows = b instanceof Y.Map ? b.get(BLOCK.rows) : null;
    if (!(rows instanceof Y.Map)) return;

    let order: string;
    if (position === 'top') order = orderAtStart(rows);
    else if (position === 'bottom') order = orderAtEnd(rows);
    else {
      const entries = sortedEntries(rows);
      const idx = entries.findIndex(([rid]) => rid === anchorRowId);
      if (idx < 0) order = orderAtEnd(rows);
      else {
        const at = (i: number) => (i >= 0 && i < entries.length ? String(entries[i][1].get(BLOCK.order) ?? '') || null : null);
        order = position === 'above' ? keyBetween(at(idx - 1), at(idx)) : keyBetween(at(idx), at(idx + 1));
      }
    }
    id = generateId();
    const rm = new Y.Map();
    rm.set(BLOCK.order, order);
    rows.set(id, rm);
  }, origin);
  return id;
}

export function removeRow(
  doc: Y.Doc, catId: string | number, side: Side, blockId: string, rowId: string, origin?: unknown
): void {
  // 기존 블록을 다루는 연산 — 컨테이너가 없으면 아무것도 만들지 않고 빠진다
  const sm = readSideMap(doc, catId, side);
  if (!sm) return;
  doc.transact(() => {
    const b = sm.get(blockId);
    if (!(b instanceof Y.Map)) return;
    const rows = b.get(BLOCK.rows);
    const cells = b.get(BLOCK.cells);
    if (rows instanceof Y.Map) rows.delete(rowId);
    // 고아 셀 정리 — 남겨도 materialize 가 무시하지만 문서가 계속 커진다
    if (cells instanceof Y.Map) {
      const dead: string[] = [];
      cells.forEach((_v, k) => { if (k.startsWith(`${rowId}:`)) dead.push(k); });
      dead.forEach(k => cells.delete(k));
    }
  }, origin);
}

export function insertColumn(
  doc: Y.Doc, catId: string | number, side: Side, blockId: string,
  position: 'start' | 'end' = 'end', origin?: unknown
): string | null {
  // 기존 블록을 다루는 연산 — 컨테이너가 없으면 아무것도 만들지 않고 빠진다
  const sm = readSideMap(doc, catId, side);
  if (!sm) return null;
  let id: string | null = null;
  doc.transact(() => {
    const b = sm.get(blockId);
    const cols = b instanceof Y.Map ? b.get(BLOCK.cols) : null;
    if (!(cols instanceof Y.Map)) return;
    id = generateId();
    const cm = new Y.Map();
    cm.set(BLOCK.order, position === 'start' ? orderAtStart(cols) : orderAtEnd(cols));
    cm.set(BLOCK.header, '');
    cols.set(id, cm);
  }, origin);
  return id;
}

export function removeColumn(
  doc: Y.Doc, catId: string | number, side: Side, blockId: string, colId: string, origin?: unknown
): void {
  // 기존 블록을 다루는 연산 — 컨테이너가 없으면 아무것도 만들지 않고 빠진다
  const sm = readSideMap(doc, catId, side);
  if (!sm) return;
  doc.transact(() => {
    const b = sm.get(blockId);
    if (!(b instanceof Y.Map)) return;
    const cols = b.get(BLOCK.cols);
    const cells = b.get(BLOCK.cells);
    if (cols instanceof Y.Map) cols.delete(colId);
    if (cells instanceof Y.Map) {
      const dead: string[] = [];
      cells.forEach((_v, k) => { if (k.endsWith(`:${colId}`)) dead.push(k); });
      dead.forEach(k => cells.delete(k));
    }
  }, origin);
}

/** 정렬된 행/열 id 목록 — UI 렌더용 */
/**
 * 사각 범위를 하나로 합친다. 화면이 주는 인덱스를 **양 끝 칸의 id 로 바꿔** 저장한다.
 *
 * 겹치는 기존 병합은 지운다. 남겨두면 같은 칸을 둘이 덮어 rowspan 이 어긋난 표가 나온다.
 * 덮이는 칸의 값은 지우지 않는다 — 병합을 풀면 그대로 돌아와야 한다.
 */
export function mergeCells(
  doc: Y.Doc, catId: string | number, side: Side, blockId: string,
  r1: number, c1: number, r2: number, c2: number, origin?: unknown
): void {
  const sm = readSideMap(doc, catId, side);
  if (!sm) return;
  doc.transact(() => {
    const b = sm.get(blockId);
    if (!(b instanceof Y.Map)) return;
    const rows = b.get(BLOCK.rows);
    const cols = b.get(BLOCK.cols);
    if (!(rows instanceof Y.Map) || !(cols instanceof Y.Map)) return;

    const rids = sortedEntries(rows).map(([id]) => id);
    const cids = sortedEntries(cols).map(([id]) => id);
    const top = Math.min(r1, r2), bottom = Math.max(r1, r2);
    const left = Math.min(c1, c2), right = Math.max(c1, c2);
    if (top < 0 || left < 0 || bottom >= rids.length || right >= cids.length) return;
    if ((bottom - top + 1) * (right - left + 1) <= 1) return;

    // 컨테이너는 시드·표 생성 시점에 만들어져 있다. 여기서 만드는 건 그 이전에 만들어진
    // 문서를 위한 폴백이며, 그 경우에만 동시 생성 위험이 남는다.
    let merges = b.get(BLOCK.merges);
    if (!(merges instanceof Y.Map)) {
      merges = new Y.Map();
      b.set(BLOCK.merges, merges);
    }
    const mm = merges as Y.Map<unknown>;

    // 새 범위와 겹치는 기존 병합 제거
    const rowIdx = new Map(rids.map((id, i) => [id, i]));
    const colIdx = new Map(cids.map((id, i) => [id, i]));
    const dead: string[] = [];
    mm.forEach((entry, mid) => {
      if (!(entry instanceof Y.Map)) { dead.push(mid); return; }
      const er1 = rowIdx.get(String(entry.get(MERGE.anchorRow) ?? ''));
      const er2 = rowIdx.get(String(entry.get(MERGE.endRow) ?? ''));
      const ec1 = colIdx.get(String(entry.get(MERGE.anchorCol) ?? ''));
      const ec2 = colIdx.get(String(entry.get(MERGE.endCol) ?? ''));
      if (er1 === undefined || er2 === undefined || ec1 === undefined || ec2 === undefined) {
        dead.push(mid);   // 끝점이 사라진 병합은 이참에 정리한다
        return;
      }
      const overlap =
        Math.min(er1, er2) <= bottom && Math.max(er1, er2) >= top &&
        Math.min(ec1, ec2) <= right && Math.max(ec1, ec2) >= left;
      if (overlap) dead.push(mid);
    });
    dead.forEach(k => mm.delete(k));

    const em = new Y.Map();
    em.set(MERGE.anchorRow, rids[top]);
    em.set(MERGE.anchorCol, cids[left]);
    em.set(MERGE.endRow, rids[bottom]);
    em.set(MERGE.endCol, cids[right]);
    mm.set(generateId(), em);
  }, origin);
}

/** (r,c) 를 덮는 병합을 푼다 */
export function unmergeCells(
  doc: Y.Doc, catId: string | number, side: Side, blockId: string,
  r: number, c: number, origin?: unknown
): void {
  const sm = readSideMap(doc, catId, side);
  if (!sm) return;
  doc.transact(() => {
    const b = sm.get(blockId);
    if (!(b instanceof Y.Map)) return;
    const rows = b.get(BLOCK.rows);
    const cols = b.get(BLOCK.cols);
    const merges = b.get(BLOCK.merges);
    if (!(rows instanceof Y.Map) || !(cols instanceof Y.Map) || !(merges instanceof Y.Map)) return;

    const rowIdx = new Map(sortedEntries(rows).map(([id], i) => [id, i]));
    const colIdx = new Map(sortedEntries(cols).map(([id], i) => [id, i]));
    const dead: string[] = [];
    merges.forEach((entry, mid) => {
      if (!(entry instanceof Y.Map)) { dead.push(mid); return; }
      const r1 = rowIdx.get(String(entry.get(MERGE.anchorRow) ?? ''));
      const r2 = rowIdx.get(String(entry.get(MERGE.endRow) ?? ''));
      const c1 = colIdx.get(String(entry.get(MERGE.anchorCol) ?? ''));
      const c2 = colIdx.get(String(entry.get(MERGE.endCol) ?? ''));
      if (r1 === undefined || r2 === undefined || c1 === undefined || c2 === undefined) return;
      if (r >= Math.min(r1, r2) && r <= Math.max(r1, r2) &&
          c >= Math.min(c1, c2) && c <= Math.max(c1, c2)) dead.push(mid);
    });
    dead.forEach(k => merges.delete(k));
  }, origin);
}

// ── 프로그램에서 값을 통째로 넣을 때 ─────────────────────────
//
// 사람이 타이핑하는 경로가 아니다(그쪽은 Y.Text 를 직접 묶는다).
// 전주차 복사·표 붙여넣기처럼 **의도적으로 통째 교체**하는 동작에만 쓴다.

function setTextValue(t: unknown, v: string): void {
  if (!(t instanceof Y.Text)) return;
  if (t.toString() === v) return;
  if (t.length > 0) t.delete(0, t.length);
  if (v) t.insert(0, v);
}

export function setSubTextValue(
  doc: Y.Doc, catId: string | number, side: Side, blockId: string, v: string, origin?: unknown
): void {
  const sm = readSideMap(doc, catId, side);
  if (!sm) return;
  doc.transact(() => {
    const b = sm.get(blockId);
    if (b instanceof Y.Map) setTextValue(b.get(BLOCK.subText), v);
  }, origin);
}

export function setCaptionText(
  doc: Y.Doc, catId: string | number, side: Side, blockId: string, v: string, origin?: unknown
): void {
  const sm = readSideMap(doc, catId, side);
  if (!sm) return;
  doc.transact(() => {
    const b = sm.get(blockId);
    if (b instanceof Y.Map) setTextValue(b.get(BLOCK.caption), v);
  }, origin);
}

export function setBulletTextValue(
  doc: Y.Doc, catId: string | number, side: Side, blockId: string,
  bulletId: string, v: string, origin?: unknown
): void {
  const sm = readSideMap(doc, catId, side);
  if (!sm) return;
  doc.transact(() => {
    const b = sm.get(blockId);
    const bullets = b instanceof Y.Map ? b.get(BLOCK.bullets) : null;
    if (!(bullets instanceof Y.Map)) return;
    const bm = bullets.get(bulletId);
    if (bm instanceof Y.Map) setTextValue(bm.get(BLOCK.text), v);
  }, origin);
}

/**
 * 표 내용을 통째로 갈아엎는다 (외부 표 붙여넣기).
 *
 * 행·열 id 를 새로 만들기 때문에 같은 순간 남이 고치던 칸은 사라진다.
 * 파괴적인 동작이라 화면에서 한 번 묻고 호출한다.
 */
export function replaceTableContent(
  doc: Y.Doc, catId: string | number, side: Side, blockId: string,
  headers: string[], rows: string[][], origin?: unknown
): void {
  const sm = readSideMap(doc, catId, side);
  if (!sm) return;
  doc.transact(() => {
    const b = sm.get(blockId);
    if (!(b instanceof Y.Map)) return;

    const colMap = new Y.Map();
    const newColIds: string[] = [];
    let prev: string | null = null;
    headers.forEach(h => {
      const id = generateId();
      newColIds.push(id);
      const cm = new Y.Map();
      prev = generateKeyBetween(prev, null);
      cm.set(BLOCK.order, prev);
      cm.set(BLOCK.header, h ?? '');
      colMap.set(id, cm);
    });
    b.set(BLOCK.cols, colMap);

    const rowMap = new Y.Map();
    const newRowIds: string[] = [];
    prev = null;
    rows.forEach(() => {
      const id = generateId();
      newRowIds.push(id);
      const rm = new Y.Map();
      prev = generateKeyBetween(prev, null);
      rm.set(BLOCK.order, prev);
      rowMap.set(id, rm);
    });
    b.set(BLOCK.rows, rowMap);

    const cellMap = new Y.Map();
    rows.forEach((row, ri) => (row ?? []).forEach((v, ci) => {
      if (ci >= newColIds.length || !v) return;
      cellMap.set(cellKey(newRowIds[ri], newColIds[ci]), v);
    }));
    b.set(BLOCK.cells, cellMap);

    // 행·열이 전부 바뀌었으므로 기존 병합은 가리킬 곳이 없다
    b.set(BLOCK.merges, new Y.Map());
  }, origin);
}

// ── 인덱스 → id 래퍼 ─────────────────────────────────────────
//
// 화면은 행·열을 인덱스로 다루고 문서는 id 로 다룬다. 변환을 호출할 때마다 하면
// 곳곳에 흩어지므로 여기 한 곳에 모은다. 인덱스는 **호출 시점의 로컬 문서 기준**으로
// 즉시 id 로 바뀌므로, 그 뒤 원격 편집이 들어와도 엉뚱한 칸을 건드리지 않는다.

function blockOf(doc: Y.Doc, catId: string | number, side: Side, blockId: string): Y.Map<unknown> | null {
  const sm = readSideMap(doc, catId, side);
  const b = sm?.get(blockId);
  return b instanceof Y.Map ? b : null;
}

export function setCellAt(
  doc: Y.Doc, catId: string | number, side: Side, blockId: string,
  r: number, c: number, value: string, origin?: unknown
): void {
  const b = blockOf(doc, catId, side, blockId);
  if (!b) return;
  const rid = rowIds(b)[r];
  const cid = colIds(b)[c];
  if (!rid || !cid) return;
  setCell(doc, catId, side, blockId, rid, cid, value, origin);
}

export function setHeaderAt(
  doc: Y.Doc, catId: string | number, side: Side, blockId: string,
  c: number, value: string, origin?: unknown
): void {
  const b = blockOf(doc, catId, side, blockId);
  if (!b) return;
  const cid = colIds(b)[c];
  if (!cid) return;
  setHeader(doc, catId, side, blockId, cid, value, origin);
}

/** at 을 주면 그 위치 위에 삽입, 없으면 맨 아래 */
export function insertRowAt(
  doc: Y.Doc, catId: string | number, side: Side, blockId: string,
  at?: number, origin?: unknown
): void {
  const b = blockOf(doc, catId, side, blockId);
  if (!b) return;
  if (at === undefined) {
    insertRow(doc, catId, side, blockId, 'bottom', undefined, origin);
    return;
  }
  const ids = rowIds(b);
  if (at <= 0 || ids.length === 0) {
    insertRow(doc, catId, side, blockId, 'top', undefined, origin);
    return;
  }
  const anchor = ids[Math.min(at, ids.length - 1)];
  if (at >= ids.length) insertRow(doc, catId, side, blockId, 'bottom', undefined, origin);
  else insertRow(doc, catId, side, blockId, 'above', anchor, origin);
}

export function removeRowAt(
  doc: Y.Doc, catId: string | number, side: Side, blockId: string, r: number, origin?: unknown
): void {
  const b = blockOf(doc, catId, side, blockId);
  if (!b) return;
  const rid = rowIds(b)[r];
  if (!rid) return;
  removeRow(doc, catId, side, blockId, rid, origin);
}

export function removeColumnAt(
  doc: Y.Doc, catId: string | number, side: Side, blockId: string, c: number, origin?: unknown
): void {
  const b = blockOf(doc, catId, side, blockId);
  if (!b) return;
  const cid = colIds(b)[c];
  if (!cid) return;
  removeColumn(doc, catId, side, blockId, cid, origin);
}

export function rowIds(block: Y.Map<unknown>): string[] {
  return sortedEntries(block.get(BLOCK.rows) as Y.Map<unknown> | undefined).map(([id]) => id);
}
export function colIds(block: Y.Map<unknown>): string[] {
  return sortedEntries(block.get(BLOCK.cols) as Y.Map<unknown> | undefined).map(([id]) => id);
}

export { compareOrdered };
