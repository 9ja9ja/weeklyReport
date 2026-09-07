/**
 * 취합본 저장이 문서를 바꾸지 않을 때 세대를 올리지 않기 위한 판정.
 *
 * 세대가 오르면 접속자 전원이 끊기고 구세대 룸 정리가 돈다. 팀장이 [저장]을 습관처럼
 * 여러 번 눌러도(2026-09-04 9회 중 2회는 내용 변화 0) 문서가 같으면 아무 일도 없어야 한다.
 * 비교는 문자열이 아니라 **문서**로 한다 — 화면이 보낸 JSON 은 키 순서·생략된 기본값이
 * 저장본과 다를 수 있다.
 */
import { describe, it, expect } from 'vitest';
import { buildDocFromState, type EditorState } from './buildDoc';
import { materializeToJson, readMeta } from './materialize';
import { planRestore } from './restorePlan';

const META = { teamId: 6, year: 2026, weekNum: 36, seedId: 'seed-t6' };
const NEXT = { ...META, docGeneration: 4 };

const STATE = {
  '43': {
    current: [{ id: 'b1', type: 'sub', subText: '데이터 서비스 점검', authorText: '홍', authorId: 31, bullets: [{ id: 'u1', text: '완료' }] }],
    next: [{ id: 't1', type: 'table', caption: '건수', headers: ['구분', '건수'], rows: [['A', '3']], authorText: '', authorId: null }]
  }
} as unknown as EditorState;

/** DB 의 SharedDoc.contents — persistUpdate 가 materializeToJson 으로 남긴 값과 같은 형태 */
function stored(): string {
  return materializeToJson(buildDocFromState(STATE, { ...META, docGeneration: 3 }));
}

describe('planRestore', () => {
  it('화면이 보낸 내용이 저장된 문서와 같으면 unchanged', () => {
    const contents = stored();
    expect(planRestore(JSON.parse(contents), contents, NEXT).unchanged).toBe(true);
  });

  it('키 순서·생략된 기본값이 달라도 내용이 같으면 unchanged', () => {
    const contents = stored();
    const shuffled = {
      '43': {
        next: [{ authorId: null, authorText: '', rows: [['A', '3']], headers: ['구분', '건수'], caption: '건수', type: 'table', id: 't1' }],
        current: [{ bullets: [{ text: '완료', id: 'u1' }], authorId: 31, authorText: '홍', subText: '데이터 서비스 점검', id: 'b1' }]
      }
    } as unknown as EditorState;
    expect(JSON.stringify(shuffled)).not.toBe(contents);
    expect(planRestore(shuffled, contents, NEXT).unchanged).toBe(true);
  });

  it('글자 하나가 달라도 바뀐 것이다', () => {
    const contents = stored();
    const edited = JSON.parse(contents) as EditorState;
    (edited['43'].current[0] as { subText: string }).subText = '데이터 서비스 점검 완료';
    expect(planRestore(edited, contents, NEXT).unchanged).toBe(false);
  });

  it('블록을 지운 것도 변화다', () => {
    const contents = stored();
    const edited = JSON.parse(contents) as EditorState;
    edited['43'].next = [];
    expect(planRestore(edited, contents, NEXT).unchanged).toBe(false);
  });

  it('바뀌었으면 새 세대를 단 문서와 그 문서의 materialized 를 돌려준다', () => {
    const contents = stored();
    const edited = JSON.parse(contents) as EditorState;
    (edited['43'].current[0] as { subText: string }).subText = '수정';
    const plan = planRestore(edited, contents, NEXT);
    expect(readMeta(plan.doc).docGeneration).toBe(4);
    expect(plan.materialized).toBe(materializeToJson(plan.doc));
    expect(plan.materialized).not.toBe(contents);
  });
});
