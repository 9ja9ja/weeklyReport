/**
 * 공동 편집에서의 표 붙여넣기 — 행·열·값·병합을 통째로 갈아끼운다.
 *
 * 다른 연산과 달리 이건 문서의 행·열 id 를 전부 새로 만든다. 옛 id 가 한 조각이라도
 * 남으면 화면엔 안 보이는 값이 저장본에 따라붙거나, 지워진 행을 가리키는 병합이 남아
 * 표가 어긋난다. 붙여넣은 뒤 이어지는 편집이 새 좌표를 제대로 잡는지도 함께 본다.
 */
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { buildDocFromState, type EditorState } from './buildDoc';
import { materialize } from './materialize';
import { replaceTableContent, setCellAt, setHeaderAt, mergeCells } from './yOps';
import { isTableBlock, HEADER_ROW, type TableBlock } from '../reportBlocks';

const CAT = '1';
const META = { teamId: 1, year: 2026, weekNum: 33, seedId: 's' };

/** 팀원이 이미 채워 둔 3x3 표 */
function docWithTable(): Y.Doc {
  const table: TableBlock = {
    id: 't1', type: 'table', caption: '문의 대응',
    headers: ['h0', 'h1', 'h2'],
    rows: Array.from({ length: 3 }, (_, r) => Array.from({ length: 3 }, (_, c) => `${r},${c}`))
  };
  const state: EditorState = { [CAT]: { current: [table], next: [] } };
  return buildDocFromState(state, META);
}

const readTable = (doc: Y.Doc): TableBlock => {
  const b = materialize(doc)[CAT].current[0];
  if (!isTableBlock(b)) throw new Error('표가 아니다');
  return b;
};

/** 제보된 화면과 같은 모양 — 구글 독스에서 복사한 5열 표 */
const HEADERS = ['구분', 'Pharos', 'Hiworks', 'Stella', 'BizPharos'];
const ROWS = [
  ['CMS등록', '8', '3', '1', '0'],
  ['해지(탈퇴)', '15', '2', '0', '0'],
  ['합계', '279', '100', '16', '0']
];

describe('표 붙여넣기 — 통째 교체', () => {
  it('붙여넣은 표가 제목줄까지 그대로 들어온다', () => {
    const doc = docWithTable();
    replaceTableContent(doc, CAT, 'current', 't1', HEADERS, ROWS);

    const t = readTable(doc);
    expect(t.headers).toEqual(HEADERS);
    expect(t.rows).toEqual(ROWS);
  });

  it('표 크기가 줄어도 옛 행·열이 남지 않는다', () => {
    const doc = docWithTable();
    replaceTableContent(doc, CAT, 'current', 't1', ['a', 'b'], [['1', '2']]);

    const t = readTable(doc);
    expect(t.headers).toEqual(['a', 'b']);
    expect(t.rows).toEqual([['1', '2']]);
    // 옛 값이 안 보이는 곳에 살아남아 저장본에 따라붙으면 안 된다
    expect(JSON.stringify(t)).not.toContain('0,0');
  });

  it('옛 병합은 가리킬 곳이 없으므로 지운다', () => {
    const doc = docWithTable();
    mergeCells(doc, CAT, 'current', 't1', 0, 0, 1, 1);
    expect(readTable(doc).merges?.length).toBe(1);

    replaceTableContent(doc, CAT, 'current', 't1', HEADERS, ROWS);
    expect(readTable(doc).merges ?? []).toEqual([]);
  });

  it('빈 칸도 자리를 지킨다 (열 수가 흔들리면 안 된다)', () => {
    const doc = docWithTable();
    replaceTableContent(doc, CAT, 'current', 't1', ['구분', '건수', '비고'], [['등록', '', '']]);

    const t = readTable(doc);
    expect(t.rows).toEqual([['등록', '', '']]);
  });

  it('붙여넣은 뒤 이어지는 셀 편집이 새 좌표를 잡는다', () => {
    const doc = docWithTable();
    replaceTableContent(doc, CAT, 'current', 't1', HEADERS, ROWS);

    setCellAt(doc, CAT, 'current', 't1', 2, 1, '280');
    setHeaderAt(doc, CAT, 'current', 't1', 4, 'BizPharos(신규)');

    const t = readTable(doc);
    expect(t.rows[2][1]).toBe('280');
    expect(t.headers[4]).toBe('BizPharos(신규)');
    // 옆 칸을 건드리지 않았는지
    expect(t.rows[2][2]).toBe('100');
  });

  it('표 제목은 붙여넣기로 지우지 않는다 (내용만 바꾼다)', () => {
    const doc = docWithTable();
    replaceTableContent(doc, CAT, 'current', 't1', HEADERS, ROWS);
    expect(readTable(doc).caption).toBe('문의 대응');
  });
});

describe('붙여넣은 표의 병합', () => {
  it('제목줄 가로 병합이 새 열 id 로 다시 심긴다 (엑셀 2단 제목줄)', () => {
    const doc = docWithTable();
    replaceTableContent(
      doc, CAT, 'current', 't1',
      ['기준시점', '전체사업자', '', '', 'CMS출금등록', '', ''],
      [['', '전체', '법인', '개인', '전체', '법인', '개인'], ['25년말', '1', '2', '3', '4', '5', '6']],
      undefined,
      [
        { r: HEADER_ROW, c: 1, rowSpan: 1, colSpan: 3 },
        { r: HEADER_ROW, c: 4, rowSpan: 1, colSpan: 3 }
      ]
    );

    const t = readTable(doc);
    expect(t.merges).toEqual([
      { r: HEADER_ROW, c: 1, rowSpan: 1, colSpan: 3 },
      { r: HEADER_ROW, c: 4, rowSpan: 1, colSpan: 3 }
    ]);
  });

  it('본문 병합도 함께 들어온다', () => {
    const doc = docWithTable();
    replaceTableContent(
      doc, CAT, 'current', 't1',
      ['구분', '항목', '건수'],
      [['1월', '가입', '10'], ['', '해지', '3']],
      undefined,
      [{ r: 0, c: 0, rowSpan: 2, colSpan: 1 }]
    );
    expect(readTable(doc).merges).toEqual([{ r: 0, c: 0, rowSpan: 2, colSpan: 1 }]);
  });

  it('표 밖을 가리키는 병합은 버린다', () => {
    const doc = docWithTable();
    replaceTableContent(
      doc, CAT, 'current', 't1', ['a', 'b'], [['1', '2']],
      undefined,
      [
        { r: 0, c: 0, rowSpan: 3, colSpan: 1 },          // 행 밖
        { r: 0, c: 1, rowSpan: 1, colSpan: 4 },          // 열 밖
        { r: HEADER_ROW, c: 0, rowSpan: 2, colSpan: 1 }  // 제목줄↔본문 교차
      ]
    );
    expect(readTable(doc).merges).toBeUndefined();
  });

  it('병합을 안 주면 옛 병합이 남지 않는다', () => {
    const doc = docWithTable();
    mergeCells(doc, CAT, 'current', 't1', 0, 0, 1, 1);
    expect(readTable(doc).merges).toHaveLength(1);

    replaceTableContent(doc, CAT, 'current', 't1', HEADERS, ROWS);
    expect(readTable(doc).merges).toBeUndefined();
  });
});
