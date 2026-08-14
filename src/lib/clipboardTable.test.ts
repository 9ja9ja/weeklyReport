// @vitest-environment happy-dom
/**
 * 클립보드(HTML) 표 파싱 — 특히 **rowspan 이 있는 엑셀 표**.
 *
 * colspan 만 보고 rowspan 을 무시하면, 세로로 병합된 칸 아래 행들이 한 칸씩 왼쪽으로 밀려
 * 표 전체가 어긋난다. 엑셀의 2단 제목줄(그룹명 + 세부 항목)이 정확히 그 모양이라
 * 실무에서 붙여넣는 표가 통째로 깨졌다. DOM 이 필요해 happy-dom 위에서 돈다.
 */
import { describe, it, expect } from 'vitest';
import { parseClipboardTable, HEADER_ROW } from './reportBlocks';

/** 사용자가 제보한 모양 — 기준시점(세로 2칸) + 그룹 3개(각 가로 3칸) */
const EXCEL_2LEVEL = `
<table>
  <tr>
    <td rowspan="2">기준시점</td>
    <td colspan="3">전체사업자</td>
    <td colspan="3">CMS출금등록</td>
    <td colspan="3">하이웍스유료고객</td>
  </tr>
  <tr>
    <td>전체</td><td>법인</td><td>개인</td>
    <td>전체</td><td>법인</td><td>개인</td>
    <td>전체</td><td>법인</td><td>개인</td>
  </tr>
  <tr>
    <td>25년말</td>
    <td>1,000</td><td>400</td><td>600</td>
    <td>800</td><td>350</td><td>450</td>
    <td>300</td><td>120</td><td>180</td>
  </tr>
</table>`;

describe('엑셀 2단 제목줄 붙여넣기', () => {
  const parsed = parseClipboardTable(EXCEL_2LEVEL, null);

  it('그룹명이 제목줄에, 세부 항목이 첫 본문 행에 제자리로 들어간다', () => {
    expect(parsed).not.toBeNull();
    expect(parsed!.headers).toEqual([
      '기준시점', '전체사업자', '', '', 'CMS출금등록', '', '', '하이웍스유료고객', '', ''
    ]);
    // rowspan 을 무시하면 이 줄이 왼쪽으로 한 칸 밀려 '전체'가 기준시점 자리에 온다
    expect(parsed!.rows[0]).toEqual(['', '전체', '법인', '개인', '전체', '법인', '개인', '전체', '법인', '개인']);
    expect(parsed!.rows[1]).toEqual(['25년말', '1,000', '400', '600', '800', '350', '450', '300', '120', '180']);
  });

  it('그룹명의 가로 병합이 제목줄 병합으로 남는다', () => {
    expect(parsed!.merges).toEqual([
      { r: HEADER_ROW, c: 1, rowSpan: 1, colSpan: 3 },
      { r: HEADER_ROW, c: 4, rowSpan: 1, colSpan: 3 },
      { r: HEADER_ROW, c: 7, rowSpan: 1, colSpan: 3 }
    ]);
  });
});

describe('본문의 병합', () => {
  it('본문 세로 병합은 좌표를 한 줄 당겨 그대로 살린다', () => {
    const html = `<table>
      <tr><td>구분</td><td>항목</td><td>건수</td></tr>
      <tr><td rowspan="2">1월</td><td>가입</td><td>10</td></tr>
      <tr><td>해지</td><td>3</td></tr>
    </table>`;
    const p = parseClipboardTable(html, null)!;

    expect(p.headers).toEqual(['구분', '항목', '건수']);
    expect(p.rows).toEqual([['1월', '가입', '10'], ['', '해지', '3']]);
    // 제목줄 한 줄을 걷어냈으므로 r 은 1 이 아니라 0
    expect(p.merges).toEqual([{ r: 0, c: 0, rowSpan: 2, colSpan: 1 }]);
  });

  it('덮이는 칸은 빈칸으로 둔다 — 값을 반복하면 병합을 풀 때 같은 값이 여러 번 나온다', () => {
    const html = `<table>
      <tr><td>a</td><td>b</td></tr>
      <tr><td colspan="2">합계</td></tr>
    </table>`;
    const p = parseClipboardTable(html, null)!;
    expect(p.rows).toEqual([['합계', '']]);
  });
});

describe('기존 동작 유지', () => {
  it('병합 없는 표는 병합 목록을 만들지 않는다', () => {
    const html = '<table><tr><td>구분</td><td>건수</td></tr><tr><td>가입</td><td>10</td></tr></table>';
    const p = parseClipboardTable(html, null)!;
    expect(p.headers).toEqual(['구분', '건수']);
    expect(p.rows).toEqual([['가입', '10']]);
    expect(p.merges).toBeUndefined();
  });

  it('빈 줄이 섞여 와도 걷어낸다', () => {
    const html = `<table>
      <tr><td>구분</td><td>건수</td></tr>
      <tr><td></td><td></td></tr>
      <tr><td>가입</td><td>10</td></tr>
    </table>`;
    const p = parseClipboardTable(html, null)!;
    expect(p.rows).toEqual([['가입', '10']]);
  });

  it('표 안에 표가 들어 있어도 바깥 표의 모양이 유지된다', () => {
    // 안쪽 표까지 훑으면 그 행·칸이 딸려와 좌표가 통째로 어긋난다 (구글 독스가 이렇게 내보낸다)
    const html = `<table>
      <tr><td>a</td><td>b</td></tr>
      <tr><td><table><tr><td>속</td><td>안</td></tr></table></td><td>c</td></tr>
    </table>`;
    const p = parseClipboardTable(html, null)!;
    expect(p.headers).toEqual(['a', 'b']);
    expect(p.rows).toEqual([['속안', 'c']]);
  });

  it('남은 행보다 큰 rowspan 은 브라우저처럼 잘라낸다', () => {
    // 그대로 두면 있지도 않은 행을 만들어 빈 줄이 줄줄이 붙는다
    const html = `<table>
      <tr><td>a</td><td>b</td></tr>
      <tr><td rowspan="5">x</td><td>y</td></tr>
    </table>`;
    const p = parseClipboardTable(html, null)!;
    expect(p.rows).toEqual([['x', 'y']]);
    expect(p.merges).toBeUndefined();
  });

  it('망가진 span 값(0·음수·문자)은 1 로 본다', () => {
    const html = `<table>
      <tr><td colspan="0">a</td><td colspan="-3">b</td><td colspan="abc">c</td></tr>
      <tr><td>1</td><td>2</td><td>3</td></tr>
    </table>`;
    const p = parseClipboardTable(html, null)!;
    expect(p.headers).toEqual(['a', 'b', 'c']);
    expect(p.rows).toEqual([['1', '2', '3']]);
  });

  it('thead/tbody 로 갈라 보내도 제목줄 판정은 같다 (엑셀·시트)', () => {
    const html = `<table>
      <thead><tr><th rowspan="2">기준</th><th colspan="2">그룹</th></tr>
             <tr><th>가</th><th>나</th></tr></thead>
      <tbody><tr><td>25년말</td><td>1</td><td>2</td></tr></tbody>
    </table>`;
    const p = parseClipboardTable(html, null)!;
    expect(p.headers).toEqual(['기준', '그룹', '']);
    expect(p.rows).toEqual([['', '가', '나'], ['25년말', '1', '2']]);
    expect(p.merges).toEqual([{ r: HEADER_ROW, c: 1, rowSpan: 1, colSpan: 2 }]);
  });

  it('칸이 하나뿐이면 표가 아니다 (일반 텍스트 붙여넣기)', () => {
    expect(parseClipboardTable('<table><tr><td>메모</td></tr></table>', null)).toBeNull();
  });

  it('HTML 이 없으면 탭 구분 텍스트로 떨어진다', () => {
    const p = parseClipboardTable(null, '구분\t건수\n가입\t10')!;
    expect(p.headers).toEqual(['구분', '건수']);
    expect(p.rows).toEqual([['가입', '10']]);
    expect(p.merges).toBeUndefined();
  });
});
