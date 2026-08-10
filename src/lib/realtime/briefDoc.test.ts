/**
 * 요약본 HTML ↔ Y.Doc 왕복 검증.
 *
 * 이 성질이 깨지면 기존 요약본을 실시간 문서로 옮길 때 표·색상·서식이 조용히 사라진다.
 * 서버가 만든 HTML 이 기존 화면과 같아야 하므로 최우선 검증 대상이다.
 */
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { buildBriefDoc, briefToHtml, briefTitle, briefSeedId } from './briefDoc';

/** 왕복 후 의미가 보존되는지 — 속성 순서 등 사소한 차이는 무시하고 구조로 비교 */
function roundtrip(html: string): string {
  return briefToHtml(buildBriefDoc(html, '', 'seed-1'));
}

describe('요약본 HTML 왕복', () => {
  it('빈 내용', () => {
    expect(roundtrip('')).toBe('');
    expect(roundtrip('   ')).toBe('');
  });

  it('문단과 줄바꿈', () => {
    const got = roundtrip('<p>첫 문단</p><p>둘째 문단</p>');
    expect(got).toContain('첫 문단');
    expect(got).toContain('둘째 문단');
  });

  it('제목·굵게·기울임·밑줄', () => {
    const got = roundtrip('<h2>제목</h2><p><strong>굵게</strong> <em>기울임</em> <u>밑줄</u></p>');
    expect(got).toContain('<h2>제목</h2>');
    expect(got).toContain('<strong>굵게</strong>');
    expect(got).toContain('<em>기울임</em>');
    expect(got).toContain('<u>밑줄</u>');
  });

  it('목록', () => {
    const got = roundtrip('<ul><li><p>항목1</p></li><li><p>항목2</p></li></ul>');
    expect(got).toContain('<ul>');
    expect(got).toContain('항목1');
    expect(got).toContain('항목2');
  });

  it('표 구조가 보존된다', () => {
    const html = '<table><tbody><tr><th><p>사유</p></th><th><p>건수</p></th></tr>' +
                 '<tr><td><p>기능</p></td><td><p>14</p></td></tr></tbody></table>';
    const got = roundtrip(html);
    // TipTap 은 표에 min-width·colspan 을 정규화해 붙인다 — 태그 존재로 확인한다
    expect(got).toMatch(/<table[^>]*>/);
    expect(got).toContain('사유');
    expect(got).toContain('건수');
    expect(got).toContain('기능');
    expect(got).toContain('14');
  });

  it('표 셀 배경색이 살아남는다 (커스텀 속성)', () => {
    const html = '<table><tbody><tr><td style="background-color: rgb(255, 235, 156)"><p>강조</p></td></tr></tbody></table>';
    const got = roundtrip(html);
    expect(got).toContain('background-color');
    expect(got).toContain('강조');
  });

  it('글자색·형광펜이 살아남는다', () => {
    const html = '<p><span style="color: rgb(220, 38, 38)">빨강</span> <mark data-color="yellow" style="background-color: yellow">형광</mark></p>';
    const got = roundtrip(html);
    expect(got).toContain('빨강');
    expect(got).toContain('형광');
    expect(got).toMatch(/color/);
  });

  it('정렬이 보존된다', () => {
    const got = roundtrip('<p style="text-align: center">가운데</p>');
    expect(got).toContain('가운데');
    expect(got).toMatch(/text-align/);
  });

  it('한글·특수문자·이모지 아닌 기호', () => {
    const text = '가나다 ABC 123 △▽ ✓ · — "인용" <태그아님>';
    const got = roundtrip(`<p>${text.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>`);
    expect(got).toContain('가나다');
    expect(got).toContain('△▽');
    expect(got).toContain('&lt;태그아님&gt;');
  });

  it('두 번 왕복해도 안정적이다 (수렴)', () => {
    const html = '<h2>주간 요약</h2><p><strong>핵심</strong> 내용</p>' +
                 '<table><tbody><tr><td><p>A</p></td><td><p>B</p></td></tr></tbody></table>';
    const once = roundtrip(html);
    const twice = roundtrip(once);
    expect(twice).toBe(once);
  });
});

describe('들여쓰기 보존', () => {
  // 저장·잠금 후 다시 열면 계단식 목차가 통째로 평평해지던 문제.
  // HTML 을 다시 파싱하는 순간 선행 공백은 접히고 margin-left 는 스키마에 없어 버려졌다.
  it('들여쓰기 단계가 왕복에서 살아남는다', () => {
    const got = roundtrip('<p data-indent="2">2단 들여쓴 줄</p>');
    expect(got).toContain('data-indent="2"');
    expect(got).toContain('2단 들여쓴 줄');
  });

  it('두 번 왕복해도 단계가 유지된다', () => {
    const once = roundtrip('<p data-indent="3">세 단계</p>');
    expect(roundtrip(once)).toBe(once);
  });

  it('붙여넣은 margin-left 를 단계로 환산한다', () => {
    // 워드·한글에서 붙여넣으면 px/pt 로 들어온다
    expect(roundtrip('<p style="margin-left:24px">한 단계</p>')).toContain('data-indent="1"');
    expect(roundtrip('<p style="margin-left:48px">두 단계</p>')).toContain('data-indent="2"');
    expect(roundtrip('<p style="margin-left:36pt">두 단계</p>')).toContain('data-indent="2"');
    expect(roundtrip('<p style="text-indent:1.5em">한 단계</p>')).toContain('data-indent="1"');
  });

  it('들여쓰기가 없으면 속성을 붙이지 않는다', () => {
    const got = roundtrip('<p>평범한 줄</p>');
    expect(got).not.toContain('data-indent');
    expect(got).not.toContain('margin-left');
  });

  it('공백으로 만든 기존 들여쓰기도 지워지지 않는다', () => {
    // 이미 저장돼 있는 내용은 공백으로 들여쓴 것들이다. 파서가 접으면 그대로 사라진다.
    const got = roundtrip('<p>    공백으로 들여쓴 줄</p>');
    expect(got).toContain('공백으로 들여쓴 줄');
    expect(got).toMatch(/<p>\s{2,}공백으로/);
  });

  it('제목에도 들여쓰기가 붙는다', () => {
    expect(roundtrip('<h2 data-indent="1">들여쓴 제목</h2>')).toContain('data-indent="1"');
  });
});

describe('요약본 메타', () => {
  it('제목과 seedId 를 보관한다', () => {
    const doc = buildBriefDoc('<p>본문</p>', '2026년 32주차 요약', 'seed-abc');
    expect(briefTitle(doc)).toBe('2026년 32주차 요약');
    expect(briefSeedId(doc)).toBe('seed-abc');
  });

  it('제목이 비어도 안전하다', () => {
    const doc = buildBriefDoc('', '', 's');
    expect(briefTitle(doc)).toBe('');
  });
});

describe('공동 편집 성질', () => {
  it('같은 문서에서 두 사람이 다른 위치를 고치면 둘 다 남는다', () => {
    const seed = buildBriefDoc('<p>원본 문장</p>', '제목', 's');
    const a = new Y.Doc(); Y.applyUpdate(a, Y.encodeStateAsUpdate(seed));
    const b = new Y.Doc(); Y.applyUpdate(b, Y.encodeStateAsUpdate(seed));

    // A 는 문단을 하나 추가, B 는 제목을 고친다
    const fragA = a.getXmlFragment('default');
    a.transact(() => {
      const p = new Y.XmlElement('paragraph');
      p.insert(0, [new Y.XmlText('A 가 추가한 문단')]);
      fragA.insert(fragA.length, [p]);
    });
    const titleB = b.getMap('meta').get('title') as Y.Text;
    b.transact(() => { titleB.insert(titleB.length, ' (수정)'); });

    // 양방향 동기화
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)));
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)));

    expect(briefToHtml(a)).toBe(briefToHtml(b));
    expect(briefToHtml(a)).toContain('A 가 추가한 문단');
    expect(briefToHtml(a)).toContain('원본 문장');
    expect(briefTitle(a)).toBe('제목 (수정)');
  });

  it('같은 문단을 동시에 고치면 문자 단위로 병합된다', () => {
    const seed = buildBriefDoc('<p>공통</p>', '', 's');
    const a = new Y.Doc(); Y.applyUpdate(a, Y.encodeStateAsUpdate(seed));
    const b = new Y.Doc(); Y.applyUpdate(b, Y.encodeStateAsUpdate(seed));

    const textOf = (d: Y.Doc) =>
      (d.getXmlFragment('default').get(0) as Y.XmlElement).get(0) as Y.XmlText;
    textOf(a).insert(0, '[A]');
    textOf(b).insert(2, '[B]');

    Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)));
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)));

    const ha = briefToHtml(a), hb = briefToHtml(b);
    expect(ha).toBe(hb);              // 수렴
    expect(ha).toContain('[A]');      // 양쪽 편집 보존
    expect(ha).toContain('[B]');
    expect(ha).toContain('공통');
  });
});
