/**
 * 표 제목 동시 편집.
 *
 * 제목은 Y.Text 인데도 타이핑 한 글자마다 setCaptionText(= 전체 delete 후 insert)로 나갔다.
 * 그러면 같은 순간 상대가 넣은 글자까지 내가 지운 것으로 병합돼 **한쪽 제목이 통째로 사라지거나
 * 두 제목이 이어붙는다**. 이제 소분류·불릿과 같이 바뀐 구간만 반영한다(useYTextBinding).
 * 여기서는 그 두 경로를 같은 상황에 넣고 결과를 비교한다.
 */
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { buildDocFromState, type EditorState } from './buildDoc';
import { materialize } from './materialize';
import { setCaptionText } from './yOps';
import { BLOCK, ROOT } from './schema';
import { textDiff } from '@/components/useSharedDoc';
import { isTableBlock, type TableBlock } from '../reportBlocks';

const CAT = '1';
const META = { teamId: 1, year: 2026, weekNum: 33, seedId: 's' };
const BASE = '실적';

/** 같은 문서를 보고 있는 두 사람 */
function twoClients(): { a: Y.Doc; b: Y.Doc } {
  const table: TableBlock = {
    id: 't1', type: 'table', caption: BASE, headers: ['구분'], rows: [['']]
  };
  const state: EditorState = { [CAT]: { current: [table], next: [] } };
  const a = buildDocFromState(state, META);
  const b = new Y.Doc();
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  return { a, b };
}

function sync(a: Y.Doc, b: Y.Doc): void {
  const fromA = Y.encodeStateAsUpdate(a, Y.encodeStateVector(b));
  const fromB = Y.encodeStateAsUpdate(b, Y.encodeStateVector(a));
  Y.applyUpdate(b, fromA);
  Y.applyUpdate(a, fromB);
}

function captionText(doc: Y.Doc): Y.Text {
  const cats = doc.getMap(ROOT.cats);
  const cm = cats.get(CAT) as Y.Map<unknown>;
  const sm = cm.get('current') as Y.Map<unknown>;
  const b = sm.get('t1') as Y.Map<unknown>;
  const t = b.get(BLOCK.caption);
  if (!(t instanceof Y.Text)) throw new Error('제목이 Y.Text 가 아니다');
  return t;
}

const captionOf = (doc: Y.Doc): string => {
  const b = materialize(doc)[CAT].current[0];
  if (!isTableBlock(b)) throw new Error('표가 아니다');
  return b.caption;
};

/** 입력칸 바인딩이 하는 일 — 직전 로컬 값과의 차이만 문서에 반영한다 */
function typeInto(doc: Y.Doc, prev: string, next: string): void {
  const t = captionText(doc);
  const { index, removed, added } = textDiff(prev, next);
  const at = Math.min(index, t.length);
  const del = Math.min(removed, t.length - at);
  doc.transact(() => {
    if (del > 0) t.delete(at, del);
    if (added) t.insert(at, added);
  });
}

describe('표 제목 동시 편집', () => {
  it('둘이 서로 다른 자리를 고치면 둘 다 남는다', () => {
    const { a, b } = twoClients();
    typeInto(a, BASE, `${BASE} 정리`);    // A 는 뒤에 붙이고
    typeInto(b, BASE, `월간 ${BASE}`);     // B 는 앞에 붙인다
    sync(a, b);

    expect(captionOf(a)).toBe('월간 실적 정리');
    expect(captionOf(b)).toBe('월간 실적 정리');
  });

  it('한 글자씩 이어 쳐도 상대 글자를 지우지 않는다', () => {
    const { a, b } = twoClients();
    // A 가 " 정리" 를 한 글자씩 (타이핑 그대로)
    typeInto(a, BASE, `${BASE} `);
    typeInto(a, `${BASE} `, `${BASE} 정`);
    typeInto(a, `${BASE} 정`, `${BASE} 정리`);
    // 그 사이 B 는 앞을 고친다
    typeInto(b, BASE, `월간 ${BASE}`);
    sync(a, b);

    expect(captionOf(a)).toBe('월간 실적 정리');
    expect(captionOf(b)).toBe(captionOf(a));
  });

  it('옛 경로(통째 교체)는 한쪽 편집을 삼킨다 — 이래서 바꿨다', () => {
    const { a, b } = twoClients();
    setCaptionText(a, CAT, 'current', 't1', `${BASE} 정리`);
    setCaptionText(b, CAT, 'current', 't1', `월간 ${BASE}`);
    sync(a, b);

    // 둘 다 살아남지 못한다 (한쪽이 사라지거나 뒤엉킨 문자열이 된다)
    expect(captionOf(a)).not.toBe('월간 실적 정리');
    expect(captionOf(a)).toBe(captionOf(b));   // 수렴은 한다 — 내용이 틀릴 뿐이다
  });

  it('붙여넣기·전주 복사처럼 의도적인 통째 교체는 그대로 동작한다', () => {
    const { a } = twoClients();
    setCaptionText(a, CAT, 'current', 't1', '월간 실적 정리');
    expect(captionOf(a)).toBe('월간 실적 정리');
  });
});
