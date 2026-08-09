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
import { BLOCK, cellKey, compareOrdered, sortedEntries, type Side } from './schema';
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
export function rowIds(block: Y.Map<unknown>): string[] {
  return sortedEntries(block.get(BLOCK.rows) as Y.Map<unknown> | undefined).map(([id]) => id);
}
export function colIds(block: Y.Map<unknown>): string[] {
  return sortedEntries(block.get(BLOCK.cols) as Y.Map<unknown> | undefined).map(([id]) => id);
}

export { compareOrdered };
