/**
 * 공유 문서에서의 표 셀 병합.
 *
 * 병합을 인덱스로 저장하면 **다른 사람이 위에 행을 넣는 순간 엉뚱한 칸을 덮는다.**
 * 그래서 양 끝 칸의 id 로 잡는다. 여기서 검증하는 건 그 성질이다 —
 * 동시 편집으로 행이 늘거나 줄어도 병합이 의도한 칸을 계속 덮는가.
 */
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { buildDocFromState, type EditorState } from './buildDoc';
import { materialize } from './materialize';
import { mergeCells, unmergeCells, insertRow, removeRow, insertColumn, removeColumn, rowIds, colIds } from './yOps';
import { isTableBlock, type TableBlock } from '../reportBlocks';
import { BLOCK } from './schema';

const CAT = '1';
const META = { teamId: 1, year: 2026, weekNum: 33, seedId: 's' };

/** rows x cols 표 하나를 담은 문서 */
function docWithTable(rows = 3, cols = 3, merges?: TableBlock['merges']): Y.Doc {
  const table: TableBlock = {
    id: 't1', type: 'table', caption: '표',
    headers: Array.from({ length: cols }, (_, c) => `h${c}`),
    rows: Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => `${r},${c}`)),
    ...(merges ? { merges } : {})
  };
  const state: EditorState = { [CAT]: { current: [table], next: [] } };
  return buildDocFromState(state, META);
}

function readTable(doc: Y.Doc): TableBlock {
  const b = materialize(doc)[CAT].current[0];
  if (!isTableBlock(b)) throw new Error('표가 아니다');
  return b;
}

/** 문서 안의 표 블록 Y.Map */
function tableMap(doc: Y.Doc): Y.Map<unknown> {
  const cats = doc.getMap('cats');
  const cm = cats.get(CAT) as Y.Map<unknown>;
  const sm = cm.get('current') as Y.Map<unknown>;
  return [...sm.values()][0] as Y.Map<unknown>;
}

describe('병합 왕복', () => {
  it('시드한 병합이 그대로 복원된다', () => {
    const doc = docWithTable(3, 3, [{ r: 0, c: 0, rowSpan: 2, colSpan: 2 }]);
    expect(readTable(doc).merges).toEqual([{ r: 0, c: 0, rowSpan: 2, colSpan: 2 }]);
  });

  it('병합이 없으면 필드 자체가 없다 (기존 데이터와 같은 모양)', () => {
    expect(readTable(docWithTable()).merges).toBeUndefined();
  });

  it('덮인 칸의 값은 그대로 남는다', () => {
    const doc = docWithTable(3, 3, [{ r: 0, c: 0, rowSpan: 1, colSpan: 2 }]);
    expect(readTable(doc).rows[0][1]).toBe('0,1');
  });

  it('표 밖으로 나가는 병합은 버린다', () => {
    const doc = docWithTable(2, 2, [{ r: 0, c: 0, rowSpan: 5, colSpan: 5 }]);
    expect(readTable(doc).merges).toBeUndefined();
  });
});

describe('병합 편집 연산', () => {
  it('범위를 병합하고 풀 수 있다', () => {
    const doc = docWithTable();
    mergeCells(doc, CAT, 'current', 't1', 1, 1, 2, 2);
    expect(readTable(doc).merges).toEqual([{ r: 1, c: 1, rowSpan: 2, colSpan: 2 }]);

    unmergeCells(doc, CAT, 'current', 't1', 2, 2);   // 덮인 칸을 눌러도 풀린다
    expect(readTable(doc).merges).toBeUndefined();
  });

  it('겹치는 범위를 병합하면 기존 것을 지우고 새 것만 남긴다', () => {
    const doc = docWithTable(4, 4);
    mergeCells(doc, CAT, 'current', 't1', 0, 0, 1, 1);
    mergeCells(doc, CAT, 'current', 't1', 1, 1, 2, 2);
    // 겹친 채로 두면 같은 칸을 둘이 덮어 표가 어긋난다
    expect(readTable(doc).merges).toEqual([{ r: 1, c: 1, rowSpan: 2, colSpan: 2 }]);
  });

  it('한 칸짜리 범위는 병합하지 않는다', () => {
    const doc = docWithTable();
    mergeCells(doc, CAT, 'current', 't1', 1, 1, 1, 1);
    expect(readTable(doc).merges).toBeUndefined();
  });
});

describe('행·열이 변해도 병합이 따라간다', () => {
  it('병합 위에 행을 넣으면 병합이 내려간다', () => {
    const doc = docWithTable(4, 4, [{ r: 2, c: 1, rowSpan: 2, colSpan: 2 }]);
    insertRow(doc, CAT, 'current', 't1', 'top');
    expect(readTable(doc).merges).toEqual([{ r: 3, c: 1, rowSpan: 2, colSpan: 2 }]);
  });

  it('병합 안에 행이 생기면 범위가 넓어진다', () => {
    const doc = docWithTable(4, 1, [{ r: 0, c: 0, rowSpan: 3, colSpan: 1 }]);
    const rids = rowIds(tableMap(doc));
    insertRow(doc, CAT, 'current', 't1', 'below', rids[0]);
    expect(readTable(doc).merges).toEqual([{ r: 0, c: 0, rowSpan: 4, colSpan: 1 }]);
  });

  it('병합 안의 행이 지워지면 범위가 줄어든다', () => {
    const doc = docWithTable(4, 1, [{ r: 0, c: 0, rowSpan: 3, colSpan: 1 }]);
    const rids = rowIds(tableMap(doc));
    removeRow(doc, CAT, 'current', 't1', rids[1]);
    expect(readTable(doc).merges).toEqual([{ r: 0, c: 0, rowSpan: 2, colSpan: 1 }]);
  });

  it('끝점 행이 지워지면 병합을 버린다', () => {
    const doc = docWithTable(4, 1, [{ r: 1, c: 0, rowSpan: 2, colSpan: 1 }]);
    const rids = rowIds(tableMap(doc));
    removeRow(doc, CAT, 'current', 't1', rids[2]);   // 끝점
    expect(readTable(doc).merges).toBeUndefined();
  });

  it('열도 같은 규칙을 따른다', () => {
    const doc = docWithTable(2, 4, [{ r: 0, c: 1, rowSpan: 1, colSpan: 2 }]);
    insertColumn(doc, CAT, 'current', 't1', 'start');
    expect(readTable(doc).merges).toEqual([{ r: 0, c: 2, rowSpan: 1, colSpan: 2 }]);

    const cids = colIds(tableMap(doc));
    removeColumn(doc, CAT, 'current', 't1', cids[0]);
    expect(readTable(doc).merges).toEqual([{ r: 0, c: 1, rowSpan: 1, colSpan: 2 }]);
  });
});

describe('동시 편집', () => {
  it('한쪽이 병합하는 동안 다른 쪽이 위에 행을 넣어도 의도한 칸을 덮는다', () => {
    // 인덱스로 저장했다면 여기서 병합이 한 칸 위를 덮어 표가 어긋난다
    const seed = docWithTable(4, 3);
    const a = new Y.Doc(); Y.applyUpdate(a, Y.encodeStateAsUpdate(seed));
    const b = new Y.Doc(); Y.applyUpdate(b, Y.encodeStateAsUpdate(seed));

    mergeCells(a, CAT, 'current', 't1', 2, 0, 3, 1);   // A: 아래쪽 2x2 병합
    insertRow(b, CAT, 'current', 't1', 'top');          // B: 맨 위에 행 추가

    Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)));
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)));

    const ta = readTable(a);
    const tb = readTable(b);
    expect(ta.merges).toEqual(tb.merges);                        // 수렴
    expect(ta.merges).toEqual([{ r: 3, c: 0, rowSpan: 2, colSpan: 2 }]);
    // 병합된 칸의 값이 원래 그 칸 그대로인지 — 좌표가 밀리지 않았다는 뜻
    expect(ta.rows[3][0]).toBe('2,0');
  });

  it('겹치는 범위를 동시에 병합하면 모두가 같은 결과로 수렴한다', () => {
    const seed = docWithTable(4, 4);
    const a = new Y.Doc(); Y.applyUpdate(a, Y.encodeStateAsUpdate(seed));
    const b = new Y.Doc(); Y.applyUpdate(b, Y.encodeStateAsUpdate(seed));

    mergeCells(a, CAT, 'current', 't1', 0, 0, 1, 1);
    mergeCells(b, CAT, 'current', 't1', 1, 1, 2, 2);

    Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)));
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)));

    const ma = readTable(a).merges;
    const mb = readTable(b).merges;
    expect(ma).toEqual(mb);          // 같은 표를 본다
    expect(ma).toHaveLength(1);      // 겹친 둘 중 하나만 살아남는다
  });

  it('두 사람이 같은 표의 다른 칸을 병합하면 둘 다 남는다', () => {
    const seed = docWithTable(4, 4);
    const a = new Y.Doc(); Y.applyUpdate(a, Y.encodeStateAsUpdate(seed));
    const b = new Y.Doc(); Y.applyUpdate(b, Y.encodeStateAsUpdate(seed));

    mergeCells(a, CAT, 'current', 't1', 0, 0, 0, 1);
    mergeCells(b, CAT, 'current', 't1', 3, 2, 3, 3);

    Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)));
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)));

    expect(readTable(a).merges).toHaveLength(2);
    expect(readTable(a).merges).toEqual(readTable(b).merges);
  });
});

describe('고아 병합 정리', () => {
  it('끝점이 사라진 병합은 다음 병합 때 함께 치운다', () => {
    const doc = docWithTable(4, 2, [{ r: 0, c: 0, rowSpan: 2, colSpan: 1 }]);
    const rids = rowIds(tableMap(doc));
    removeRow(doc, CAT, 'current', 't1', rids[1]);   // 끝점 제거 → 화면에서는 이미 사라짐

    const before = tableMap(doc).get(BLOCK.merges) as Y.Map<unknown>;
    expect(before.size).toBe(1);                      // 데이터에는 아직 남아 있다

    mergeCells(doc, CAT, 'current', 't1', 1, 0, 2, 0);
    const after = tableMap(doc).get(BLOCK.merges) as Y.Map<unknown>;
    expect(after.size).toBe(1);                       // 새 것만 남는다
  });
});
