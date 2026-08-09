/**
 * EditorState JSON → Y.Doc
 *
 * 시드(주차 이월·마이그레이션 백필)와 테스트에서만 쓴다. 런타임 편집은 yOps 를 통한다.
 *
 * 주의: 이 함수로 만든 문서를 두 번 만들어 병합하면 안 된다.
 * Yjs 는 내용이 같아도 다른 clientID 로 만든 문서를 합칠 때 Y.Text 는 문자 단위로 중복시키고
 * Y.Map 컨테이너는 한쪽을 통째로 버린다(실측 확인). meta.seedId 가 그 방어선이다.
 */
import * as Y from 'yjs';
import { generateKeyBetween } from 'fractional-indexing';
import { generateId, isTableBlock, type ContentBlock } from '../reportBlocks';
import { BLOCK, META, ROOT, SCHEMA_VERSION, SIDES, cellKey, type Side } from './schema';

/** ReportItem/SummaryData 의 contents 형태 */
export type EditorState = Record<string, { current: ContentBlock[]; next: ContentBlock[] }>;

export interface SeedMeta {
  teamId: number;
  year: number;
  weekNum: number;
  seedId: string;
  docGeneration?: number;
  isLocked?: boolean;
}

/** n개 항목에 매길 fractional order 를 순서대로 생성 */
function orderKeys(n: number): string[] {
  const keys: string[] = [];
  let prev: string | null = null;
  for (let i = 0; i < n; i++) {
    prev = generateKeyBetween(prev, null);
    keys.push(prev);
  }
  return keys;
}

function ytext(s: string): Y.Text {
  const t = new Y.Text();
  if (s) t.insert(0, s);
  return t;
}

function buildSubBlock(b: Extract<ContentBlock, { type?: 'sub' }>, order: string): Y.Map<unknown> {
  const m = new Y.Map();
  m.set(BLOCK.type, 'sub');
  m.set(BLOCK.order, order);
  m.set(BLOCK.authorId, (b as { authorId?: number | null }).authorId ?? null);
  m.set(BLOCK.authorText, b.authorText ?? '');
  m.set(BLOCK.subText, ytext(b.subText ?? ''));

  const bullets = new Y.Map();
  const bulletList = Array.isArray(b.bullets) ? b.bullets : [];
  const bkeys = orderKeys(bulletList.length);
  const usedBulletIds = new Set<string>();
  bulletList.forEach((bu, i) => {
    let bid = bu?.id;
    if (!bid || usedBulletIds.has(bid)) bid = generateId();
    usedBulletIds.add(bid);
    const bm = new Y.Map();
    bm.set(BLOCK.order, bkeys[i]);
    bm.set(BLOCK.text, ytext(String(bu?.text ?? '')));
    bullets.set(bid, bm);
  });
  m.set(BLOCK.bullets, bullets);
  return m;
}

function buildTableBlock(b: Extract<ContentBlock, { type: 'table' }>, order: string): Y.Map<unknown> {
  const m = new Y.Map();
  m.set(BLOCK.type, 'table');
  m.set(BLOCK.order, order);
  m.set(BLOCK.authorId, (b as { authorId?: number | null }).authorId ?? null);
  m.set(BLOCK.authorText, b.authorText ?? '');
  m.set(BLOCK.caption, ytext(b.caption ?? ''));

  // 열: headers 배열 인덱스를 안정적인 colId 로 바꾼다
  const headers = b.headers ?? [];
  const colIds = headers.map((_, i) => `c${i}`);
  const colKeys = orderKeys(headers.length);
  const cols = new Y.Map();
  headers.forEach((h, i) => {
    const cm = new Y.Map();
    cm.set(BLOCK.order, colKeys[i]);
    cm.set(BLOCK.header, h ?? '');
    cols.set(colIds[i], cm);
  });
  m.set(BLOCK.cols, cols);

  // 행
  const bodyRows = b.rows ?? [];
  const rowIds = bodyRows.map((_, i) => `r${i}`);
  const rowKeys = orderKeys(bodyRows.length);
  const rows = new Y.Map();
  bodyRows.forEach((_, i) => {
    const rm = new Y.Map();
    rm.set(BLOCK.order, rowKeys[i]);
    rows.set(rowIds[i], rm);
  });
  m.set(BLOCK.rows, rows);

  // 셀 — 값이 있는 칸만 넣는다. 빈 칸은 materialize 에서 '' 로 복원된다
  const cells = new Y.Map();
  bodyRows.forEach((row, ri) => {
    (row ?? []).forEach((v, ci) => {
      if (ci >= colIds.length) return; // 헤더보다 긴 행은 잘라낸다(materialize 와 폭을 맞추기 위해)
      if (v === '' || v == null) return;
      cells.set(cellKey(rowIds[ri], colIds[ci]), v);
    });
  });
  m.set(BLOCK.cells, cells);
  return m;
}

function buildBlock(b: ContentBlock, order: string): Y.Map<unknown> {
  return isTableBlock(b) ? buildTableBlock(b, order) : buildSubBlock(b, order);
}

/**
 * 빈 문서에 상태를 채워 넣는다. 이미 내용이 있는 doc 에 쓰면 안 된다(중복·소실).
 * 트랜잭션 하나로 묶어 관찰자가 중간 상태를 보지 않게 한다.
 */
export function applyStateToDoc(doc: Y.Doc, state: EditorState, meta: SeedMeta, origin?: unknown): void {
  doc.transact(() => {
    const m = doc.getMap(ROOT.meta);
    m.set(META.teamId, meta.teamId);
    m.set(META.year, meta.year);
    m.set(META.weekNum, meta.weekNum);
    m.set(META.seedId, meta.seedId);
    m.set(META.docGeneration, meta.docGeneration ?? 1);
    m.set(META.schemaVersion, SCHEMA_VERSION);
    m.set(META.isLocked, meta.isLocked ?? false);

    const cats = doc.getMap(ROOT.cats);
    for (const [catId, cat] of Object.entries(state ?? {})) {
      const cm = new Y.Map();
      for (const side of SIDES) {
        // 손상된 입력(배열이 아님)에도 백필 전체가 멈추지 않게 방어한다
        const list: ContentBlock[] = Array.isArray(cat?.[side]) ? (cat[side] as ContentBlock[]) : [];
        const keys = orderKeys(list.length);
        const sideMap = new Y.Map();
        const usedIds = new Set<string>();
        list.forEach((b, i) => {
          // id 가 없거나 중복이면 새로 발급한다. 그대로 두면 Y.Map 키가 겹쳐 블록이 사라진다.
          let id = b?.id;
          if (!id || usedIds.has(id)) id = generateId();
          usedIds.add(id);
          sideMap.set(id, buildBlock(b, keys[i]));
        });
        cm.set(side, sideMap);
      }
      cats.set(String(catId), cm);
    }
  }, origin);
}

/** EditorState → 새 Y.Doc */
export function buildDocFromState(state: EditorState, meta: SeedMeta): Y.Doc {
  const doc = new Y.Doc();
  applyStateToDoc(doc, state, meta);
  return doc;
}

/**
 * 런타임에 새 카테고리 컨테이너를 만든다.
 *
 * 컨테이너를 통째로 set 하면 두 클라이언트가 동시에 만들 때 한쪽 블록이 전부 사라진다(Y.Map LWW).
 * 이미 있으면 건드리지 않는 이 함수를 단일 진입점으로 쓴다.
 */
export function ensureCategory(doc: Y.Doc, catId: string | number, origin?: unknown): Y.Map<unknown> {
  const cats = doc.getMap(ROOT.cats);
  const key = String(catId);
  const existing = cats.get(key);
  if (existing instanceof Y.Map) return existing;

  let created!: Y.Map<unknown>;
  doc.transact(() => {
    // 트랜잭션 안에서 한 번 더 확인 — 같은 틱에 두 번 호출되는 경우 대비
    const again = cats.get(key);
    if (again instanceof Y.Map) { created = again; return; }
    const cm = new Y.Map();
    for (const side of SIDES) cm.set(side, new Y.Map());
    cats.set(key, cm);
    created = cm;
  }, origin);
  return created;
}

/**
 * 조회 전용 — 없으면 undefined 를 돌려주고 **아무것도 만들지 않는다.**
 *
 * 기존 블록을 고치는 연산(수정·삭제·이동)은 반드시 이걸 써야 한다.
 * 아직 시드를 못 받은 클라이언트에서 컨테이너를 만들어 버리면, 그 빈 컨테이너가 병합 시
 * Y.Map 키 LWW 로 서버의 컨테이너를 이겨 그 카테고리의 블록이 통째로 사라진다.
 */
export function readSideMap(doc: Y.Doc, catId: string | number, side: Side): Y.Map<unknown> | undefined {
  const cm = doc.getMap(ROOT.cats).get(String(catId));
  if (!(cm instanceof Y.Map)) return undefined;
  const sm = cm.get(side);
  return sm instanceof Y.Map ? sm : undefined;
}

/**
 * 특정 카테고리의 한쪽 열 맵을 얻는다(없으면 만든다).
 * **새 블록을 추가하는 경로에서만** 쓴다 — readSideMap 주석 참고.
 */
export function sideMap(doc: Y.Doc, catId: string | number, side: Side, origin?: unknown): Y.Map<unknown> {
  const cm = ensureCategory(doc, catId, origin);
  const existing = cm.get(side);
  if (existing instanceof Y.Map) return existing;
  let created!: Y.Map<unknown>;
  doc.transact(() => {
    const again = cm.get(side);
    if (again instanceof Y.Map) { created = again; return; }
    const sm = new Y.Map();
    cm.set(side, sm);
    created = sm;
  }, origin);
  return created;
}
