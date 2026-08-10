/**
 * 낡은 인덱스로 들어온 파괴적 표 연산 차단.
 *
 * 화면은 한 프레임 묶어 다시 그리고, 병합은 범위를 고른 뒤 버튼을 누를 때까지 수 초가 걸린다.
 * 그 사이 다른 사람이 행·열을 넣거나 빼면 화면의 인덱스가 문서와 어긋난다.
 * 그대로 실행하면 **엉뚱한 행이 사라지거나 엉뚱한 칸이 병합**되고 되돌릴 방법이 없다.
 */
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { buildDocFromState, type EditorState } from './buildDoc';
import { materialize } from './materialize';
import { insertRowAt, removeRowAt, removeColumnAt, mergeCells, blockIds } from './yOps';
import { isTableBlock, type TableBlock } from '../reportBlocks';

const CAT = '1';
const META = { teamId: 1, year: 2026, weekNum: 33, seedId: 's' };

function docWithTable(rows = 3, cols = 3): Y.Doc {
  const table: TableBlock = {
    id: 't1', type: 'table', caption: '',
    headers: Array.from({ length: cols }, (_, c) => `h${c}`),
    rows: Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => `${r},${c}`))
  };
  const state: EditorState = { [CAT]: { current: [table], next: [] } };
  return buildDocFromState(state, META);
}

const readTable = (doc: Y.Doc): TableBlock => {
  const b = materialize(doc)[CAT].current[0];
  if (!isTableBlock(b)) throw new Error('표가 아니다');
  return b;
};

describe('행 삭제 — 화면이 본 크기와 다르면 하지 않는다', () => {
  it('원격이 행을 추가한 뒤엔 삭제를 거부한다', () => {
    const doc = docWithTable(3, 2);
    insertRowAt(doc, CAT, 'current', 't1', 0);            // 원격이 맨 위에 추가 → 이제 4행

    // 화면은 아직 3행일 때의 인덱스(2 = 마지막 행)를 넘긴다
    const ok = removeRowAt(doc, CAT, 'current', 't1', 2, undefined, 3);
    expect(ok).toBe(false);
    expect(readTable(doc).rows.length).toBe(4);           // 아무것도 지워지지 않았다
  });

  it('크기가 같으면 정상 삭제한다', () => {
    const doc = docWithTable(3, 2);
    expect(removeRowAt(doc, CAT, 'current', 't1', 1, undefined, 3)).toBe(true);
    const t = readTable(doc);
    expect(t.rows.length).toBe(2);
    expect(t.rows.map(r => r[0])).toEqual(['0,0', '2,0']);
  });

  it('기대 크기를 안 주면 종전대로 동작한다 (개인 작성 경로)', () => {
    const doc = docWithTable(3, 2);
    expect(removeRowAt(doc, CAT, 'current', 't1', 0)).toBe(true);
    expect(readTable(doc).rows.length).toBe(2);
  });
});

describe('열 삭제 — 같은 규칙', () => {
  it('원격이 열을 바꿨으면 거부한다', () => {
    const doc = docWithTable(2, 3);
    removeColumnAt(doc, CAT, 'current', 't1', 0);          // 원격이 한 열 제거 → 2열
    expect(removeColumnAt(doc, CAT, 'current', 't1', 2, undefined, 3)).toBe(false);
    expect(readTable(doc).headers.length).toBe(2);
  });
});

describe('병합 — 고른 뒤 표가 바뀌었으면 하지 않는다', () => {
  it('행이 늘어난 뒤의 병합은 무시한다', () => {
    const doc = docWithTable(3, 3);
    insertRowAt(doc, CAT, 'current', 't1', 0);             // 원격 삽입 → 4행

    mergeCells(doc, CAT, 'current', 't1', 0, 0, 1, 1, undefined, { rows: 3, cols: 3 });
    expect(readTable(doc).merges).toBeUndefined();
  });

  it('표가 그대로면 병합한다', () => {
    const doc = docWithTable(3, 3);
    mergeCells(doc, CAT, 'current', 't1', 0, 0, 1, 1, undefined, { rows: 3, cols: 3 });
    expect(readTable(doc).merges).toEqual([{ r: 0, c: 0, rowSpan: 2, colSpan: 2 }]);
  });
});

describe('블록 id 목록', () => {
  it('문서 순서대로 돌려준다', () => {
    const state: EditorState = {
      [CAT]: {
        current: [
          { id: 'a', type: 'sub', subText: '1', bullets: [] },
          { id: 'b', type: 'sub', subText: '2', bullets: [] }
        ],
        next: []
      }
    };
    const doc = buildDocFromState(state, META);
    expect(blockIds(doc, CAT, 'current')).toEqual(['a', 'b']);
    expect(blockIds(doc, CAT, 'next')).toEqual([]);
  });
});
