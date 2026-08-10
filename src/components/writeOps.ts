'use client';

/**
 * 주간보고 작성 화면의 편집 연산 — 개인 작성과 공동 편집 양쪽에 같은 모양을 준다.
 *
 * 화면 코드가 모드를 따지지 않게 하려고 인터페이스를 하나로 맞췄다. 다만 **블록을 id 로 가리킨다** —
 * 인덱스로 가리키면 공동 편집에서 남이 위에 항목을 추가한 순간 엉뚱한 블록을 고친다.
 */
import * as Y from 'yjs';
import {
  type ContentBlock, type TableBlock, type SubBlock,
  createSubBlock, createTableBlock, generateId, isTableBlock,
  setCell as setCellLocal, setHeader as setHeaderLocal,
  addRow as addRowLocal, removeRow as removeRowLocal,
  addColumn as addColumnLocal, removeColumn as removeColumnLocal,
  mergeCells as mergeCellsLocal, unmergeCells as unmergeCellsLocal
} from '@/lib/reportBlocks';
import type { TableOps } from '@/components/TableBlock';
import type { Side } from '@/lib/realtime/schema';
import { BLOCK, ROOT } from '@/lib/realtime/schema';
import * as ops from '@/lib/realtime/yOps';

export type EditorState = Record<number | string, { current: ContentBlock[]; next: ContentBlock[] }>;

export interface Author {
  authorId: number | null;
  authorText: string;
}

export interface WriteOps {
  /** 공동 편집이면 true — 화면이 텍스트 입력을 Y.Text 에 직접 묶어야 한다 */
  collaborative: boolean;
  addSub(catId: number, side: Side): void;
  addTable(catId: number, side: Side): void;
  removeBlock(catId: number, side: Side, blockId: string): void;
  /** blockId 를 targetId 자리로 옮긴다 (targetId 앞) */
  moveBlock(catId: number, side: Side, blockId: string, targetId: string): void;
  setSubText(catId: number, side: Side, blockId: string, v: string): void;
  setAuthorText(catId: number, side: Side, blockId: string, v: string): void;
  addBullet(catId: number, side: Side, blockId: string): void;
  removeBullet(catId: number, side: Side, blockId: string, bulletId: string): void;
  setBulletText(catId: number, side: Side, blockId: string, bulletId: string, v: string): void;
  moveBullet(catId: number, side: Side, blockId: string, bulletId: string, targetId: string): void;
  copyCurrentToNext(catId: number, blocks: ContentBlock[]): void;
  tableOps(catId: number, side: Side, blockId: string): TableOps;
  /** 공동 편집에서 텍스트 입력을 직접 묶을 Y.Text (개인 작성이면 null) */
  subText(catId: number, side: Side, blockId: string): Y.Text | null;
  bulletText(catId: number, side: Side, blockId: string, bulletId: string): Y.Text | null;
}

// ── 개인 작성 (기존 방식) ─────────────────────────────────────

type SetState = (updater: (prev: EditorState) => EditorState) => void;

export function localWriteOps(setState: SetState, readOnly: boolean): WriteOps {
  const update = (catId: number, side: Side, fn: (list: ContentBlock[]) => ContentBlock[]) => {
    if (readOnly) return;
    setState(prev => {
      const cat = prev[catId] ?? { current: [], next: [] };
      return { ...prev, [catId]: { ...cat, [side]: fn([...cat[side]]) } };
    });
  };
  const atId = (list: ContentBlock[], blockId: string) => list.findIndex(b => b.id === blockId);
  const updateSub = (catId: number, side: Side, blockId: string, fn: (s: SubBlock) => SubBlock) =>
    update(catId, side, list => {
      const i = atId(list, blockId);
      const b = list[i];
      if (!b || isTableBlock(b)) return list;
      list[i] = fn(b);
      return list;
    });
  const updateTable = (catId: number, side: Side, blockId: string, fn: (t: TableBlock) => TableBlock) =>
    update(catId, side, list => {
      const i = atId(list, blockId);
      const b = list[i];
      if (!b || !isTableBlock(b)) return list;
      list[i] = fn(b);
      return list;
    });

  return {
    collaborative: false,
    addSub: (catId, side) => update(catId, side, l => [...l, createSubBlock()]),
    addTable: (catId, side) => update(catId, side, l => [...l, createTableBlock()]),
    removeBlock: (catId, side, blockId) => update(catId, side, l => l.filter(b => b.id !== blockId)),
    moveBlock: (catId, side, blockId, targetId) => update(catId, side, l => {
      const from = atId(l, blockId);
      const to = atId(l, targetId);
      if (from < 0 || to < 0 || from === to) return l;
      const n = [...l];
      const [it] = n.splice(from, 1);
      n.splice(to, 0, it);
      return n;
    }),
    setSubText: (catId, side, blockId, v) => updateSub(catId, side, blockId, s => ({ ...s, subText: v })),
    setAuthorText: (catId, side, blockId, v) => update(catId, side, l => {
      const i = atId(l, blockId);
      if (i < 0) return l;
      l[i] = { ...l[i], authorText: v } as ContentBlock;
      return l;
    }),
    addBullet: (catId, side, blockId) =>
      updateSub(catId, side, blockId, s => ({ ...s, bullets: [...s.bullets, { id: generateId(), text: '' }] })),
    removeBullet: (catId, side, blockId, bulletId) =>
      updateSub(catId, side, blockId, s => ({ ...s, bullets: s.bullets.filter(b => b.id !== bulletId) })),
    setBulletText: (catId, side, blockId, bulletId, v) =>
      updateSub(catId, side, blockId, s => ({
        ...s,
        bullets: s.bullets.map(b => (b.id === bulletId ? { ...b, text: v } : b))
      })),
    moveBullet: (catId, side, blockId, bulletId, targetId) =>
      updateSub(catId, side, blockId, s => {
        const from = s.bullets.findIndex(b => b.id === bulletId);
        const to = s.bullets.findIndex(b => b.id === targetId);
        if (from < 0 || to < 0 || from === to) return s;
        const n = [...s.bullets];
        const [it] = n.splice(from, 1);
        n.splice(to, 0, it);
        return { ...s, bullets: n };
      }),
    copyCurrentToNext: (catId, blocks) => update(catId, 'next', () =>
      blocks.map(b => (isTableBlock(b)
        ? { ...b, id: generateId(), headers: [...b.headers], rows: b.rows.map(r => [...r]) }
        : { id: generateId(), type: 'sub' as const, subText: b.subText, bullets: b.bullets.map(x => ({ id: generateId(), text: x.text })) }))
    ),
    tableOps: (catId, side, blockId): TableOps => ({
      setCaption: v => updateTable(catId, side, blockId, t => ({ ...t, caption: v })),
      setHeader: (c, v) => updateTable(catId, side, blockId, t => setHeaderLocal(t, c, v)),
      setCell: (r, c, v) => updateTable(catId, side, blockId, t => setCellLocal(t, r, c, v)),
      addRow: at => updateTable(catId, side, blockId, t => addRowLocal(t, at)),
      removeRow: r => updateTable(catId, side, blockId, t => removeRowLocal(t, r)),
      addColumn: () => updateTable(catId, side, blockId, t => addColumnLocal(t)),
      removeColumn: c => updateTable(catId, side, blockId, t => removeColumnLocal(t, c)),
      merge: (r1, c1, r2, c2) => updateTable(catId, side, blockId, t => mergeCellsLocal(t, r1, c1, r2, c2)),
      unmerge: (r, c) => updateTable(catId, side, blockId, t => unmergeCellsLocal(t, r, c)),
      replaceAll: (headers, rows) => updateTable(catId, side, blockId, t => ({ ...t, headers, rows, merges: undefined }))
    }),
    subText: () => null,
    bulletText: () => null
  };
}

// ── 공동 편집 ────────────────────────────────────────────────

/** 문서에서 블록 Y.Map 을 꺼낸다 (없으면 null) */
function blockMap(doc: Y.Doc, catId: number, side: Side, blockId: string): Y.Map<unknown> | null {
  const cats = doc.getMap(ROOT.cats);
  const cm = cats.get(String(catId));
  if (!(cm instanceof Y.Map)) return null;
  const sm = cm.get(side);
  if (!(sm instanceof Y.Map)) return null;
  const b = sm.get(blockId);
  return b instanceof Y.Map ? b : null;
}

/** 이동 대상 앞/뒤 이웃 id — order 를 그 사이로 잡아야 순서가 의도대로 바뀐다 */
function neighborsFor(
  list: ContentBlock[], blockId: string, targetId: string
): { prev: string | null; next: string | null } {
  const from = list.findIndex(b => b.id === blockId);
  const to = list.findIndex(b => b.id === targetId);
  if (from < 0 || to < 0) return { prev: null, next: null };
  const without = list.filter(b => b.id !== blockId);
  const insertAt = without.findIndex(b => b.id === targetId) + (from < to ? 1 : 0);
  return {
    prev: without[insertAt - 1]?.id ?? null,
    next: without[insertAt]?.id ?? null
  };
}

export function sharedWriteOps(
  doc: Y.Doc, origin: unknown, author: Author, snapshot: EditorState, readOnly: boolean
): WriteOps {
  const blocksOf = (catId: number, side: Side): ContentBlock[] => snapshot[catId]?.[side] ?? [];
  const guard = <T extends unknown[]>(fn: (...a: T) => void) => (...a: T) => { if (!readOnly) fn(...a); };

  return {
    collaborative: true,
    addSub: guard((catId: number, side: Side) => { ops.addSubBlock(doc, catId, side, author, origin); }),
    addTable: guard((catId: number, side: Side) => { ops.addTableBlock(doc, catId, side, author, 3, 3, origin); }),
    removeBlock: guard((catId: number, side: Side, blockId: string) =>
      ops.removeBlock(doc, catId, side, blockId, origin)),
    moveBlock: guard((catId: number, side: Side, blockId: string, targetId: string) => {
      const { prev, next } = neighborsFor(blocksOf(catId, side), blockId, targetId);
      ops.moveBlock(doc, catId, side, blockId, prev, next, origin);
    }),
    // 서술 항목·불릿의 본문은 Y.Text 로 직접 묶는다. 여기로는 오지 않는다.
    setSubText: () => {},
    setAuthorText: guard((catId: number, side: Side, blockId: string, v: string) =>
      ops.setAuthorText(doc, catId, side, blockId, v, origin)),
    addBullet: guard((catId: number, side: Side, blockId: string) => {
      ops.addBullet(doc, catId, side, blockId, origin);
    }),
    removeBullet: guard((catId: number, side: Side, blockId: string, bulletId: string) =>
      ops.removeBullet(doc, catId, side, blockId, bulletId, origin)),
    setBulletText: () => {},
    moveBullet: guard((catId: number, side: Side, blockId: string, bulletId: string, targetId: string) => {
      const block = blocksOf(catId, side).find(b => b.id === blockId);
      if (!block || isTableBlock(block)) return;
      const list = block.bullets.map(b => ({ id: b.id })) as ContentBlock[];
      const { prev, next } = neighborsFor(list, bulletId, targetId);
      ops.moveBullet(doc, catId, side, blockId, bulletId, prev, next, origin);
    }),
    copyCurrentToNext: guard((catId: number, blocks: ContentBlock[]) => {
      doc.transact(() => {
        // 기존 차주 내용을 비우고 금주 내용을 복사한다
        for (const b of blocksOf(catId, 'next')) ops.removeBlock(doc, catId, 'next', b.id, origin);
        for (const b of blocks) {
          if (isTableBlock(b)) {
            const id = ops.addTableBlock(doc, catId, 'next', author, b.headers.length, b.rows.length, origin);
            ops.setCaptionText(doc, catId, 'next', id, b.caption, origin);
            b.headers.forEach((h, c) => ops.setHeaderAt(doc, catId, 'next', id, c, h, origin));
            b.rows.forEach((row, r) => row.forEach((v, c) => {
              if (v) ops.setCellAt(doc, catId, 'next', id, r, c, v, origin);
            }));
          } else {
            const id = ops.addSubBlock(doc, catId, 'next', author, origin);
            ops.setSubTextValue(doc, catId, 'next', id, b.subText, origin);
            b.bullets.forEach(x => {
              const bid = ops.addBullet(doc, catId, 'next', id, origin);
              if (bid) ops.setBulletTextValue(doc, catId, 'next', id, bid, x.text, origin);
            });
          }
        }
      }, origin);
    }),
    tableOps: (catId, side, blockId): TableOps => ({
      setCaption: v => { if (!readOnly) ops.setCaptionText(doc, catId, side, blockId, v, origin); },
      setHeader: (c, v) => { if (!readOnly) ops.setHeaderAt(doc, catId, side, blockId, c, v, origin); },
      setCell: (r, c, v) => { if (!readOnly) ops.setCellAt(doc, catId, side, blockId, r, c, v, origin); },
      addRow: at => { if (!readOnly) ops.insertRowAt(doc, catId, side, blockId, at, origin); },
      removeRow: r => { if (!readOnly) ops.removeRowAt(doc, catId, side, blockId, r, origin); },
      addColumn: () => { if (!readOnly) ops.insertColumn(doc, catId, side, blockId, 'end', origin); },
      removeColumn: c => { if (!readOnly) ops.removeColumnAt(doc, catId, side, blockId, c, origin); },
      merge: (r1, c1, r2, c2) => { if (!readOnly) ops.mergeCells(doc, catId, side, blockId, r1, c1, r2, c2, origin); },
      unmerge: (r, c) => { if (!readOnly) ops.unmergeCells(doc, catId, side, blockId, r, c, origin); },
      replaceAll: (headers, rows) => {
        if (readOnly) return;
        ops.replaceTableContent(doc, catId, side, blockId, headers, rows, origin);
      }
    }),
    subText: (catId, side, blockId) => {
      const b = blockMap(doc, catId, side, blockId);
      const t = b?.get(BLOCK.subText);
      return t instanceof Y.Text ? t : null;
    },
    bulletText: (catId, side, blockId, bulletId) => {
      const b = blockMap(doc, catId, side, blockId);
      const bullets = b?.get(BLOCK.bullets);
      if (!(bullets instanceof Y.Map)) return null;
      const bm = bullets.get(bulletId);
      const t = bm instanceof Y.Map ? bm.get(BLOCK.text) : null;
      return t instanceof Y.Text ? t : null;
    }
  };
}
