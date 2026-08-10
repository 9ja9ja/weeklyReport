/**
 * 제목 diff 검증.
 *
 * 여기서 틀리면 두 가지가 조용히 깨진다.
 *  1. 같이 편집 중인 상대가 방금 친 글자가 사라진다.
 *  2. 이모지를 바꿀 때 서로게이트 페어가 반쪽만 지워져 U+FFFD 와 lone surrogate 가 남는다.
 *     그 문자열은 화면 깨짐으로 끝나지 않고 JSON 직렬화 경로에서 요청 자체를 거부시킨다.
 */
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { textDiff } from './useBriefRealtime';

/** textDiff 를 실제 Y.Text 에 적용해 결과 문자열을 돌려준다 (훅이 하는 것과 같은 순서) */
function applyDiff(ytext: Y.Text, prevLocal: string, nextLocal: string): string {
  const { index, removed, added } = textDiff(prevLocal, nextLocal);
  const len = ytext.length;
  const at = Math.min(index, len);
  const del = Math.min(removed, len - at);
  ytext.doc?.transact(() => {
    if (del > 0) ytext.delete(at, del);
    if (added) ytext.insert(at, added);
  });
  return ytext.toString();
}

function newText(initial: string): Y.Text {
  const doc = new Y.Doc();
  const t = doc.getText('t');
  if (initial) t.insert(0, initial);
  return t;
}

/** 짝 없는 서로게이트가 남았는가 — 남으면 API 요청이 깨진다 */
function hasLoneSurrogate(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const n = s.charCodeAt(i + 1);
      if (!(n >= 0xdc00 && n <= 0xdfff)) return true;
      i++;
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      return true;
    }
  }
  return false;
}

describe('제목 diff — 기본', () => {
  it('끝에 덧붙이기', () => {
    expect(textDiff('주간보고', '주간보고서')).toEqual({ index: 4, removed: 0, added: '서' });
  });

  it('가운데 끼워넣기', () => {
    expect(textDiff('주간보고', '주간업무보고')).toEqual({ index: 2, removed: 0, added: '업무' });
  });

  it('앞에서 지우기', () => {
    expect(textDiff('[긴급] 보고', '보고')).toEqual({ index: 0, removed: 5, added: '' });
  });

  it('변화 없음', () => {
    expect(textDiff('같음', '같음')).toEqual({ index: 2, removed: 0, added: '' });
  });

  it('전체 교체', () => {
    const d = textDiff('가나다', '라마바');
    expect(d.index).toBe(0);
    expect(d.removed).toBe(3);
    expect(d.added).toBe('라마바');
  });
});

describe('제목 diff — 이모지(서로게이트 페어)', () => {
  it('이모지 하나를 다른 이모지로 바꿔도 깨지지 않는다', () => {
    // U+1F600 과 U+1F601 은 high surrogate 가 같아, 코드유닛 단위로 자르면 반쪽만 지워진다
    const t = newText('😀');
    const got = applyDiff(t, '😀', '😁');
    expect(got).toBe('😁');
    expect(hasLoneSurrogate(got)).toBe(false);
    expect(got).not.toContain('�');
  });

  it('문장 가운데 이모지 교체', () => {
    const t = newText('주간 😀 보고');
    const got = applyDiff(t, '주간 😀 보고', '주간 😄 보고');
    expect(got).toBe('주간 😄 보고');
    expect(hasLoneSurrogate(got)).toBe(false);
  });

  it('이모지 삭제', () => {
    const t = newText('보고 😀');
    const got = applyDiff(t, '보고 😀', '보고 ');
    expect(got).toBe('보고 ');
    expect(hasLoneSurrogate(got)).toBe(false);
  });

  it('이모지 추가', () => {
    const t = newText('보고');
    const got = applyDiff(t, '보고', '보고😀');
    expect(got).toBe('보고😀');
    expect(hasLoneSurrogate(got)).toBe(false);
  });
});

describe('제목 diff — 동시 편집', () => {
  it('상대가 앞에 끼워넣은 글자를 지우지 않는다', () => {
    // 로컬은 "주간보고" 를 보고 있는데, 그 사이 상대가 앞에 "[긴급] " 을 넣었다.
    // Y.Text 현재값과 비교하면 "[긴급] " 이 내가 지운 것으로 계산돼 통째로 사라진다.
    const t = newText('주간보고');
    t.insert(0, '[긴급] ');                       // 원격 편집
    const got = applyDiff(t, '주간보고', '주간보고서');   // 로컬은 끝에 한 글자 추가
    expect(got).toContain('[긴급]');
    expect(got).toContain('주간보고');
    expect(got).toContain('서');
  });

  it('원격 삭제로 문서가 짧아져도 예외 없이 처리한다', () => {
    const t = newText('주간보고');
    t.delete(0, 4);                                // 원격이 전부 지움
    expect(() => applyDiff(t, '주간보고', '주간보고서')).not.toThrow();
  });
});
