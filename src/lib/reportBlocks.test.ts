/**
 * 표 편집 연산 — 특히 **셀 병합 좌표가 행·열 증감을 따라가는지**.
 *
 * 이걸 놓치면 행 하나만 추가해도 병합이 엉뚱한 칸을 덮어 표가 통째로 어긋난다.
 * 화면·클립보드·문서 내보내기가 전부 같은 좌표를 쓰므로 여기가 진실원본이다.
 */
import { describe, it, expect } from 'vitest';
import {
  createTableBlock, addRow, removeRow, addColumn, removeColumn,
  mergeCells, unmergeCells, mergeAt, isCovered, spanAt, setCell,
  type TableBlock
} from './reportBlocks';

/** 3x3 표 — 값은 "r,c" 로 채워 이동을 눈으로 확인할 수 있게 한다 */
function grid(rows = 3, cols = 3): TableBlock {
  let t = createTableBlock(cols, rows);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) t = setCell(t, r, c, `${r},${c}`);
  return t;
}

describe('행 삽입 위치', () => {
  it('위치를 안 주면 맨 아래', () => {
    const t = addRow(grid(2, 2));
    expect(t.rows.length).toBe(3);
    expect(t.rows[2]).toEqual(['', '']);
  });

  it('맨 위에 넣을 수 있다 (최신순 정산표)', () => {
    const t = addRow(grid(2, 2), 0);
    expect(t.rows[0]).toEqual(['', '']);
    expect(t.rows[1]).toEqual(['0,0', '0,1']);
  });

  it('가운데에 끼워 넣는다', () => {
    const t = addRow(grid(3, 1), 1);
    expect(t.rows.map(r => r[0])).toEqual(['0,0', '', '1,0', '2,0']);
  });

  it('범위를 벗어난 위치는 끝으로 잘린다', () => {
    expect(addRow(grid(2, 1), 99).rows.length).toBe(3);
    expect(addRow(grid(2, 1), -5).rows[0]).toEqual(['']);
  });
});

describe('셀 병합 — 기본', () => {
  it('병합하면 기준칸만 그려지고 나머지는 덮인다', () => {
    const t = mergeCells(grid(), 0, 0, 1, 1);
    expect(spanAt(t, 0, 0)).toEqual({ rowSpan: 2, colSpan: 2 });
    expect(isCovered(t, 0, 0)).toBe(false);
    expect(isCovered(t, 0, 1)).toBe(true);
    expect(isCovered(t, 1, 0)).toBe(true);
    expect(isCovered(t, 1, 1)).toBe(true);
    expect(isCovered(t, 2, 2)).toBe(false);
  });

  it('덮인 칸의 값은 지우지 않는다 (병합 해제 시 복원)', () => {
    const t = mergeCells(grid(), 0, 0, 0, 1);
    expect(t.rows[0][1]).toBe('0,1');
    const back = unmergeCells(t, 0, 0);
    expect(back.merges).toBeUndefined();
    expect(isCovered(back, 0, 1)).toBe(false);
    expect(back.rows[0][1]).toBe('0,1');
  });

  it('덮인 칸을 눌러도 병합이 풀린다', () => {
    const t = mergeCells(grid(), 0, 0, 1, 1);
    expect(unmergeCells(t, 1, 1).merges).toBeUndefined();
  });

  it('한 칸만 고르면 병합하지 않는다', () => {
    expect(mergeCells(grid(), 1, 1, 1, 1).merges).toBeUndefined();
  });

  it('범위를 거꾸로 골라도 된다', () => {
    const t = mergeCells(grid(), 2, 2, 1, 1);
    expect(mergeAt(t, 1, 1)).toEqual({ r: 1, c: 1, rowSpan: 2, colSpan: 2 });
  });

  it('표 밖으로 나가는 범위는 무시한다', () => {
    expect(mergeCells(grid(), 0, 0, 9, 9).merges).toBeUndefined();
  });
});

describe('셀 병합 — 겹침 처리', () => {
  it('기존 병합과 반쯤 겹치면 그것까지 삼켜 하나로 만든다', () => {
    // 반쪽만 겹친 채로 두면 같은 칸을 두 병합이 덮어 렌더가 어긋난다
    let t = mergeCells(grid(4, 4), 0, 0, 1, 1);
    t = mergeCells(t, 1, 1, 2, 2);
    expect(t.merges).toHaveLength(1);
    expect(t.merges![0]).toEqual({ r: 0, c: 0, rowSpan: 3, colSpan: 3 });
  });

  it('겹치지 않는 병합은 따로 남는다', () => {
    let t = mergeCells(grid(4, 4), 0, 0, 0, 1);
    t = mergeCells(t, 2, 2, 3, 3);
    expect(t.merges).toHaveLength(2);
  });

  it('완전히 포함하는 범위로 다시 병합하면 하나로 합쳐진다', () => {
    let t = mergeCells(grid(4, 4), 1, 1, 1, 2);
    t = mergeCells(t, 0, 0, 3, 3);
    expect(t.merges).toEqual([{ r: 0, c: 0, rowSpan: 4, colSpan: 4 }]);
  });
});

describe('셀 병합 — 행·열 증감 추적', () => {
  it('병합 위에 행을 넣으면 병합이 통째로 내려간다', () => {
    const t = addRow(mergeCells(grid(4, 4), 2, 1, 3, 2), 0);
    expect(t.merges![0]).toEqual({ r: 3, c: 1, rowSpan: 2, colSpan: 2 });
  });

  it('병합 안에 행을 넣으면 병합 범위가 넓어진다', () => {
    const t = addRow(mergeCells(grid(4, 4), 1, 0, 2, 0), 2);
    expect(t.merges![0]).toEqual({ r: 1, c: 0, rowSpan: 3, colSpan: 1 });
  });

  it('병합 아래에 행을 넣으면 그대로', () => {
    const t = addRow(mergeCells(grid(4, 4), 0, 0, 1, 1), 3);
    expect(t.merges![0]).toEqual({ r: 0, c: 0, rowSpan: 2, colSpan: 2 });
  });

  it('병합 위의 행을 지우면 병합이 올라온다', () => {
    const t = removeRow(mergeCells(grid(4, 4), 2, 0, 3, 0), 0);
    expect(t.merges![0]).toEqual({ r: 1, c: 0, rowSpan: 2, colSpan: 1 });
  });

  it('병합 안의 행을 지우면 범위가 줄고, 1칸이 되면 병합이 사라진다', () => {
    const two = mergeCells(grid(4, 1), 1, 0, 2, 0);
    expect(removeRow(two, 1).merges).toBeUndefined();   // 2행 병합에서 1행 삭제 → 병합 아님

    const three = mergeCells(grid(4, 1), 0, 0, 2, 0);
    expect(removeRow(three, 1).merges![0]).toEqual({ r: 0, c: 0, rowSpan: 2, colSpan: 1 });
  });

  it('열도 같은 규칙을 따른다', () => {
    const t = mergeCells(grid(3, 4), 0, 1, 0, 2);
    expect(addColumn(t, 0).merges![0]).toEqual({ r: 0, c: 2, rowSpan: 1, colSpan: 2 });
    expect(addColumn(t, 2).merges![0]).toEqual({ r: 0, c: 1, rowSpan: 1, colSpan: 3 });
    expect(removeColumn(t, 0).merges![0]).toEqual({ r: 0, c: 0, rowSpan: 1, colSpan: 2 });
    expect(removeColumn(t, 1).merges).toBeUndefined();
  });

  it('열 추가는 기본이 맨 뒤라 병합에 영향이 없다', () => {
    const t = addColumn(mergeCells(grid(3, 3), 0, 0, 0, 1));
    expect(t.headers.length).toBe(4);
    expect(t.merges![0]).toEqual({ r: 0, c: 0, rowSpan: 1, colSpan: 2 });
  });
});

describe('셀 병합 — 기존 데이터 호환', () => {
  it('merges 가 없는 표도 그대로 동작한다', () => {
    const legacy = { id: 'x', type: 'table' as const, caption: '', headers: ['a', 'b'], rows: [['1', '2']] };
    expect(mergeAt(legacy, 0, 0)).toBeNull();
    expect(isCovered(legacy, 0, 1)).toBe(false);
    expect(spanAt(legacy, 0, 0)).toEqual({ rowSpan: 1, colSpan: 1 });
    expect(addRow(legacy, 0).rows.length).toBe(2);
  });
});
