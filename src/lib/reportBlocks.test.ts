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
  clipboardForTablePaste, hasHtmlTable, isEditingTableCopy,
  tableToHtml, tableToText, HEADER_ROW,
  isNumericCell, numericCellColor, formatNumericCell, coloredDeltaParts,
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

/**
 * 붙여넣기를 표 교체로 볼지의 판정.
 *
 * 표를 넣는 실제 동작은 "셀을 클릭하고 Ctrl+V" 다 — 이때 커서는 셀 입력칸(textarea) 안에 있다.
 * 입력칸 안이라는 이유로 전부 넘겨버리면 표 전체 텍스트가 한 칸에 쏟아지고(제보된 증상),
 * 반대로 전부 표로 받으면 한 칸에 여러 줄 메모를 붙여넣는 것까지 표를 갈아엎는다.
 * 가르는 기준은 **클립보드에 진짜 표(text/html 의 <table>)가 실려 있는가** 하나다.
 */
describe('표 붙여넣기 판정', () => {
  /** 구글 독스·시트에서 표를 복사하면 이런 모양으로 들어온다 */
  const DOCS_HTML =
    '<meta charset="utf-8"><google-sheets-html-origin>' +
    '<table><tbody><tr><td>구분</td><td>Pharos</td></tr><tr><td>CMS등록</td><td>8</td></tr></tbody></table>';
  const DOCS_TSV = '구분\tPharos\nCMS등록\t8';

  it('셀 안에서 구글 독스·엑셀 표를 붙여넣으면 표 교체다', () => {
    // 여기서 null 이 나오면 브라우저 기본 붙여넣기가 실행돼 한 칸에 전부 쏟아진다
    expect(clipboardForTablePaste(DOCS_HTML, DOCS_TSV, 'cell')).toEqual({ html: DOCS_HTML, text: null });
  });

  it('셀 안에 여러 줄 텍스트를 붙여넣는 건 그 칸의 일이다', () => {
    expect(clipboardForTablePaste('<p>첫 줄</p><p>둘째 줄</p>', '첫 줄\n둘째 줄', 'cell')).toBeNull();
    // 탭·다중 공백이 섞인 텍스트도 표로 오인하지 않는다 (표가 아닌 이상 칸의 것이다)
    expect(clipboardForTablePaste(null, '가\t나\n다\t라', 'cell')).toBeNull();
    expect(clipboardForTablePaste('', '가  나\n다  라', 'cell')).toBeNull();
  });

  it('표 영역에 붙여넣으면 탭 구분 텍스트도 표로 받는다', () => {
    expect(clipboardForTablePaste(null, DOCS_TSV, 'outside')).toEqual({ html: null, text: DOCS_TSV });
    expect(clipboardForTablePaste(DOCS_HTML, DOCS_TSV, 'outside')).toEqual({ html: DOCS_HTML, text: DOCS_TSV });
  });

  it('표 제목·작성자 칸에 붙여넣는 건 표와 무관하다', () => {
    expect(clipboardForTablePaste(DOCS_HTML, DOCS_TSV, 'field')).toBeNull();
  });

  /**
   * 크롬이 실제로 준 값(편집 중인 표를 드래그 복사).
   * 칸에 친 값은 DOM 프로퍼티라 직렬화되지 않아 **빈 textarea** 만 실려온다.
   */
  const EDITING_COPY =
    "<meta charset='utf-8'><table style=\"color: rgb(0, 0, 0);\">" +
    '<thead><tr><th><textarea class="cell" rows="1"></textarea></th>' +
    '<th><textarea class="cell" rows="1"></textarea></th></tr></thead>' +
    '<tbody><tr><td><textarea class="cell" rows="1"></textarea></td>' +
    '<td><textarea class="cell" rows="1"></textarea></td></tr></tbody></table>';

  it('편집 중인 표를 긁어 복사한 것은 표로 되살릴 수 없다고 본다', () => {
    expect(isEditingTableCopy(EDITING_COPY)).toBe(true);
    // 값이 비어 있으니 파싱도 당연히 실패한다 — 그 자리에서 막아야 할 대상이다
    expect(clipboardForTablePaste(EDITING_COPY, '값0\n값1\n값2', 'cell')).not.toBeNull();
  });

  it('바깥에서 온 표는 막지 않는다', () => {
    expect(isEditingTableCopy(DOCS_HTML)).toBe(false);
    // 엑셀에서 한 칸만 복사한 것도 그 칸에 그대로 들어가야 한다
    expect(isEditingTableCopy('<table><tr><td>1,234</td></tr></table>')).toBe(false);
    expect(isEditingTableCopy('<p>표 아님</p>')).toBe(false);
    expect(isEditingTableCopy(null)).toBe(false);
  });

  it('클립보드에 표가 실렸는지는 <table> 로만 본다', () => {
    expect(hasHtmlTable('<TABLE border="1"><tr><td>1</td></tr></TABLE>')).toBe(true);
    expect(hasHtmlTable('<table>')).toBe(true);
    expect(hasHtmlTable('<p>표 정리 결과</p>')).toBe(false);
    expect(hasHtmlTable('<p>&lt;table&gt; 태그 설명</p>')).toBe(false);
    expect(hasHtmlTable(null)).toBe(false);
    expect(hasHtmlTable('')).toBe(false);
  });
});

describe('제목줄 병합 (r = -1)', () => {
  it('제목줄끼리 가로로 병합된다', () => {
    const t = mergeCells(grid(2, 4), HEADER_ROW, 1, HEADER_ROW, 3);
    expect(t.merges).toEqual([{ r: HEADER_ROW, c: 1, rowSpan: 1, colSpan: 3 }]);
    expect(spanAt(t, HEADER_ROW, 1)).toEqual({ rowSpan: 1, colSpan: 3 });
    expect(isCovered(t, HEADER_ROW, 2)).toBe(true);
    expect(isCovered(t, HEADER_ROW, 1)).toBe(false);
    // 본문 첫 행은 건드리지 않는다
    expect(isCovered(t, 0, 2)).toBe(false);
  });

  it('제목줄과 본문에 걸친 병합은 거부한다 (thead/tbody 를 넘을 수 없다)', () => {
    const t = grid(2, 3);
    expect(mergeCells(t, HEADER_ROW, 0, 1, 0)).toBe(t);
    expect(mergeCells(t, 0, 0, HEADER_ROW, 0)).toBe(t);
  });

  it('제목줄 한 칸만 고른 것은 병합이 아니다', () => {
    const t = grid(2, 3);
    expect(mergeCells(t, HEADER_ROW, 1, HEADER_ROW, 1)).toBe(t);
  });

  it('행을 넣고 빼도 제목줄 병합은 그대로다', () => {
    let t = mergeCells(grid(2, 4), HEADER_ROW, 0, HEADER_ROW, 1);
    t = addRow(t, 0);
    expect(t.merges).toEqual([{ r: HEADER_ROW, c: 0, rowSpan: 1, colSpan: 2 }]);
    t = removeRow(t, 0);
    expect(t.merges).toEqual([{ r: HEADER_ROW, c: 0, rowSpan: 1, colSpan: 2 }]);
  });

  it('열을 넣고 빼면 제목줄 병합도 따라 움직인다', () => {
    let t = mergeCells(grid(2, 4), HEADER_ROW, 1, HEADER_ROW, 3);
    t = addColumn(t, 0);
    expect(t.merges).toEqual([{ r: HEADER_ROW, c: 2, rowSpan: 1, colSpan: 3 }]);
    t = removeColumn(t, 0);
    expect(t.merges).toEqual([{ r: HEADER_ROW, c: 1, rowSpan: 1, colSpan: 3 }]);
    // 병합 안쪽 열이 빠지면 범위가 줄고, 한 칸만 남으면 병합이 사라진다
    t = removeColumn(t, 1);
    expect(t.merges).toEqual([{ r: HEADER_ROW, c: 1, rowSpan: 1, colSpan: 2 }]);
    t = removeColumn(t, 1);
    expect(t.merges).toBeUndefined();
  });

  it('제목줄 병합을 풀 수 있다', () => {
    const t = mergeCells(grid(2, 3), HEADER_ROW, 0, HEADER_ROW, 2);
    expect(unmergeCells(t, HEADER_ROW, 1).merges).toBeUndefined();
  });

  it('본문 병합과 제목줄 병합은 서로를 삼키지 않는다', () => {
    let t = mergeCells(grid(3, 3), HEADER_ROW, 0, HEADER_ROW, 1);
    t = mergeCells(t, 0, 0, 1, 1);
    expect(t.merges).toEqual([
      { r: HEADER_ROW, c: 0, rowSpan: 1, colSpan: 2 },
      { r: 0, c: 0, rowSpan: 2, colSpan: 2 }
    ]);
  });
});

describe('제목줄 병합 내보내기', () => {
  it('HTML 로 내보낼 때 제목줄에 colspan 이 붙고 덮인 칸은 빠진다', () => {
    const t = mergeCells(grid(1, 3), HEADER_ROW, 0, HEADER_ROW, 1);
    const html = tableToHtml(t);
    const head = html.slice(html.indexOf('<tr>'), html.indexOf('</tr>'));
    expect(head).toContain('colspan="2"');
    expect((head.match(/<td/g) ?? []).length).toBe(2);   // 3열 중 하나는 덮여 사라진다
  });

  it('탭 텍스트로 내보낼 때 덮인 제목 칸은 빈칸이 된다', () => {
    const t = mergeCells(grid(1, 3), HEADER_ROW, 0, HEADER_ROW, 1);
    const headerLine = tableToText(t, '').split('\n')[0];
    expect(headerLine.split('\t')).toEqual(['', '', '']);   // createTableBlock 의 제목은 빈 문자열
  });
});

describe('증감 표기 — "값(증감)" 형태 (예: "5(+3)")', () => {
  it.each([
    ['5(+3)', '+'],
    ['3(-2)', '-'],
    ['11(-9)', '-'],
    ['12(+1)', '+'],
    ['0(±0)', '±'],
    ['0(+/-0)', '+/-']
  ])('%s 는 숫자 셀로 인식된다', raw => {
    expect(isNumericCell(raw)).toBe(true);
  });

  it('증가(+)는 빨강, 감소(-)는 파랑, 변화없음(±·+/-)은 무채색 — 증감 부분만', () => {
    expect(coloredDeltaParts('5(+3)')).toEqual({ prefix: '5(', delta: '+3', color: '#dc2626', suffix: ')' });
    expect(coloredDeltaParts('3(-2)')).toEqual({ prefix: '3(', delta: '-2', color: '#2563eb', suffix: ')' });
    expect(coloredDeltaParts('0(±0)')).toEqual({ prefix: '0(', delta: '±0', color: null, suffix: ')' });
    expect(coloredDeltaParts('0(+/-0)')).toEqual({ prefix: '0(', delta: '+/-0', color: null, suffix: ')' });
  });

  it('값 부분은 numericCellColor 로 통째로 칠하지 않는다 (증감만 따로 칠해야 하므로)', () => {
    expect(numericCellColor('5(+3)')).toBeNull();
    expect(numericCellColor('3(-2)')).toBeNull();
  });

  it('값·증감 양쪽에 천단위 콤마를 넣는다', () => {
    expect(formatNumericCell('5000(+300)')).toBe('5,000(+300)');
    expect(formatNumericCell('12000(-1500)')).toBe('12,000(-1,500)');
  });

  it('단위가 괄호 뒤에 붙어도 유지된다', () => {
    expect(coloredDeltaParts('5(+3)건')).toEqual({ prefix: '5(', delta: '+3', color: '#dc2626', suffix: ')건' });
  });

  it('HTML 내보내기는 증감 부분만 <span> 으로 색을 입힌다', () => {
    const t = setCell(createTableBlock(1, 1), 0, 0, '5(+3)');
    const html = tableToHtml(t);
    expect(html).toContain('5(<span style="color:#dc2626;font-weight:bold;">+3</span>)');
  });
});
