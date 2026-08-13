/**
 * 조합 중 원격 편집이 들어왔을 때의 좌표 보정 (applyLocalEdit).
 *
 * 한글 조합 중에는 원격 변경을 화면에 얹지 않는다 — 얹으면 조합이 깨진다.
 * 그동안 내 화면 좌표와 문서 좌표가 어긋나는데, 예전에는 그 어긋난 좌표로 그대로 써서
 * 내 음절이 남의 문장 한가운데 박히고 그 자리 글자가 지워졌다.
 * 내 편집은 즉시 문서로 나가므로 "내 화면 → 문서" 차이가 곧 원격이 바꾼 구간이다.
 */
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { applyLocalEdit } from '@/components/useSharedDoc';

/** 입력칸 하나를 흉내낸다 — value 는 내 화면 값(원격 변경은 조합 중 안 얹힌다) */
function field(initial: string) {
  const doc = new Y.Doc();
  const t = doc.getText('t');
  t.insert(0, initial);
  let local = initial;
  return {
    text: t,
    /** 내가 한 글자 친다 */
    type(next: string) {
      applyLocalEdit(t, local, next);
      local = next;
    },
    /** 팀원이 문서를 고친다 (조합 중이라 내 화면에는 안 얹힌다) */
    remote(fn: (t: Y.Text) => void) { fn(t); },
    /** 조합이 끝나 화면이 문서 값을 따라잡는다 */
    sync() { local = t.toString(); return local; },
    doc: () => t.toString()
  };
}

describe('조합 중 원격 편집이 들어와도 내 글자가 제자리에 들어간다', () => {
  it('팀원이 내 앞에 글자를 넣어도 내 음절이 내 자리에 붙는다', () => {
    const f = field('주간 보고');
    f.type('주간 보고ㄱ');                     // 조합 시작
    f.remote(t => t.insert(0, '26주 '));       // 팀원이 맨 앞을 고친다
    f.type('주간 보고가');                     // 조합이 이어진다

    expect(f.doc()).toBe('26주 주간 보고가');
  });

  it('팀원이 내 뒤를 고치면 내 편집은 그대로다', () => {
    const f = field('진행 상황');
    f.type('진행 상황 정');
    f.remote(t => t.insert(t.length, ' [완료]'));
    f.type('진행 상황 정리');

    expect(f.doc()).toBe('진행 상황 정리 [완료]');
  });

  it('팀원이 내 앞을 지워도 위치가 당겨진다', () => {
    const f = field('[긴급] 회의록');
    f.type('[긴급] 회의록 ');
    f.remote(t => t.delete(0, 5));             // '[긴급] ' 삭제 (5글자)
    f.type('[긴급] 회의록 정리');

    // 지워진 5글자만큼 앞으로 당겨져 내 글자가 문장 끝에 제대로 붙는다
    expect(f.doc()).toBe('회의록 정리');
  });

  it('원격 변경이 없으면 평소대로 동작한다', () => {
    const f = field('');
    f.type('가');
    f.type('간');
    f.type('간단');
    expect(f.doc()).toBe('간단');
  });

  it('가운데 글자를 지우는 것도 좌표가 맞는다', () => {
    const f = field('가나다라');
    f.remote(t => t.insert(0, 'XY'));
    f.type('가다라');                          // 내 화면에서 '나' 를 지웠다

    expect(f.doc()).toBe('XY가다라');
  });

  it('조합이 끝나 화면이 문서를 따라잡으면 그 뒤 편집도 정확하다', () => {
    const f = field('보고');
    f.type('보고서');
    f.remote(t => t.insert(0, '주간 '));
    expect(f.sync()).toBe('주간 보고서');       // 조합 끝 → 화면이 문서 값으로

    f.type('주간 보고서 초안');
    expect(f.doc()).toBe('주간 보고서 초안');
  });
});
