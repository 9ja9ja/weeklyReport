/**
 * Phase 1 적대적 검증에서 확정된 결함들의 회귀 테스트.
 * 각 케이스는 "고치기 전에는 실패하던" 것들이다.
 */
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { generateKeyBetween } from 'fractional-indexing';
import { buildDocFromState, readSideMap, type EditorState } from './buildDoc';
import { materialize } from './materialize';
import { sortedEntries } from './schema';
import {
  addSubBlock, addBullet, addTableBlock, insertRow, insertColumn,
  removeBlock, setAuthorText, moveBlock
} from './yOps';

const META = { teamId: 1, year: 2026, weekNum: 32, seedId: 's' };
const author = { authorId: 1, authorText: '가' };

describe('order 키가 fractional-indexing 불변식을 깨지 않는다', () => {
  it('연속 append 500회가 예외 없이 성공한다', () => {
    const doc = buildDocFromState({ '1': { current: [], next: [] } }, META);
    const bid = addSubBlock(doc, '1', 'current', author);
    for (let i = 0; i < 500; i++) {
      const id = addBullet(doc, '1', 'current', bid);
      expect(id, `불릿 ${i}번째에서 실패`).not.toBeNull();
    }
    const blk = materialize(doc)['1'].current[0] as { bullets: unknown[] };
    expect(blk.bullets.length).toBe(500);
  });

  it('표 행 200회 연속 추가가 성공한다', () => {
    const doc = buildDocFromState({ '1': { current: [], next: [] } }, META);
    const tid = addTableBlock(doc, '1', 'current', author, 2, 0);
    for (let i = 0; i < 200; i++) {
      expect(insertRow(doc, '1', 'current', tid, 'bottom'), `행 ${i}`).not.toBeNull();
    }
    expect((materialize(doc)['1'].current[0] as { rows: unknown[] }).rows.length).toBe(200);
  });

  it('열 추가 100회도 성공한다', () => {
    const doc = buildDocFromState({ '1': { current: [], next: [] } }, META);
    const tid = addTableBlock(doc, '1', 'current', author, 1, 1);
    for (let i = 0; i < 100; i++) {
      expect(insertColumn(doc, '1', 'current', tid, 'end'), `열 ${i}`).not.toBeNull();
    }
    expect((materialize(doc)['1'].current[0] as { headers: unknown[] }).headers.length).toBe(101);
  });

  it('블록 추가 300회도 성공한다', () => {
    const doc = buildDocFromState({ '1': { current: [], next: [] } }, META);
    for (let i = 0; i < 300; i++) addSubBlock(doc, '1', 'current', author);
    expect(materialize(doc)['1'].current.length).toBe(300);
  });

  it('생성된 모든 order 키가 generateKeyBetween 에 재입력 가능하다', () => {
    const doc = buildDocFromState({ '1': { current: [], next: [] } }, META);
    for (let i = 0; i < 300; i++) addSubBlock(doc, '1', 'current', author);
    const sm = readSideMap(doc, '1', 'current')!;
    const orders = sortedEntries(sm).map(([, m]) => String(m.get('order')));
    for (const o of orders) {
      expect(() => generateKeyBetween(o, null), `재입력 실패: ${o}`).not.toThrow();
      expect(() => generateKeyBetween(null, o), `재입력 실패: ${o}`).not.toThrow();
    }
  });

  it('이웃 order 가 동일해도 이동이 예외를 던지지 않는다', () => {
    const state: EditorState = {
      '1': {
        current: [
          { id: 'a', type: 'sub', subText: 'A', authorText: '', bullets: [] },
          { id: 'b', type: 'sub', subText: 'B', authorText: '', bullets: [] },
          { id: 'c', type: 'sub', subText: 'C', authorText: '', bullets: [] }
        ] as never,
        next: []
      }
    };
    const doc = buildDocFromState(state, META);
    const sm = readSideMap(doc, '1', 'current')!;
    // a 와 b 의 order 를 같게 만든다 (동시 삽입으로 실제 발생 가능)
    doc.transact(() => {
      (sm.get('a') as Y.Map<unknown>).set('order', 'a0M');
      (sm.get('b') as Y.Map<unknown>).set('order', 'a0M');
    });
    expect(() => moveBlock(doc, '1', 'current', 'c', 'a', 'b')).not.toThrow();
    expect(materialize(doc)['1'].current.length).toBe(3);
  });

  it('손상된 order 값이 있어도 추가가 계속된다', () => {
    const doc = buildDocFromState({ '1': { current: [], next: [] } }, META);
    const id = addSubBlock(doc, '1', 'current', author);
    const sm = readSideMap(doc, '1', 'current')!;
    doc.transact(() => { (sm.get(id) as Y.Map<unknown>).set('order', '!!! 손상 !!!'); });
    expect(() => addSubBlock(doc, '1', 'current', author)).not.toThrow();
    expect(materialize(doc)['1'].current.length).toBe(2);
  });
});

describe('미동기화 클라이언트가 서버 블록을 지우지 않는다', () => {
  /** 서버가 시드한 문서와, 아직 그걸 못 받은 빈 클라이언트 */
  function seededAndEmpty(): [Y.Doc, Y.Doc] {
    const seeded = buildDocFromState({
      '99': {
        current: [
          { id: 'x1', type: 'sub', subText: '서버 내용 1', authorText: '', bullets: [] },
          { id: 'x2', type: 'sub', subText: '서버 내용 2', authorText: '', bullets: [] }
        ] as never,
        next: []
      }
    }, META);
    return [seeded, new Y.Doc()];
  }

  function merge(a: Y.Doc, b: Y.Doc): Y.Doc {
    const m = new Y.Doc();
    Y.applyUpdate(m, Y.encodeStateAsUpdate(a));
    Y.applyUpdate(m, Y.encodeStateAsUpdate(b));
    return m;
  }

  it('존재하지 않는 블록 삭제는 컨테이너를 만들지 않는다', () => {
    const [seeded, empty] = seededAndEmpty();
    removeBlock(empty, '99', 'current', 'nope');
    // 빈 문서에 아무 구조도 생기지 않아야 한다
    expect(readSideMap(empty, '99', 'current')).toBeUndefined();
    expect(materialize(merge(seeded, empty))['99'].current.length).toBe(2);
    expect(materialize(merge(empty, seeded))['99'].current.length).toBe(2);
  });

  it('존재하지 않는 블록의 작성자 편집도 안전하다', () => {
    const [seeded, empty] = seededAndEmpty();
    setAuthorText(empty, '99', 'current', 'nope', '누구');
    expect(readSideMap(empty, '99', 'current')).toBeUndefined();
    expect(materialize(merge(seeded, empty))['99'].current.length).toBe(2);
  });

  it('존재하지 않는 블록의 이동·불릿 추가도 안전하다', () => {
    const [seeded, empty] = seededAndEmpty();
    moveBlock(empty, '99', 'current', 'nope', null, null);
    expect(addBullet(empty, '99', 'current', 'nope')).toBeNull();
    expect(readSideMap(empty, '99', 'current')).toBeUndefined();
    expect(materialize(merge(seeded, empty))['99'].current.length).toBe(2);
  });
});

describe('손상된 문서에서도 materialize 가 예외를 던지지 않는다', () => {
  it('컨테이너 자리에 원시값이 있어도 빈 결과로 넘어간다', () => {
    const doc = buildDocFromState({
      '1': { current: [{ id: 'a', type: 'sub', subText: 'A', authorText: '', bullets: [] }] as never, next: [] }
    }, META);
    const sm = readSideMap(doc, '1', 'current')!;
    doc.transact(() => {
      (sm.get('a') as Y.Map<unknown>).set('bullets', '문자열이 들어옴');
    });
    expect(() => materialize(doc)).not.toThrow();
    const blk = materialize(doc)['1'].current[0] as { bullets: unknown[] };
    expect(blk.bullets).toEqual([]);
  });

  it('cats 아래에 원시값이 있어도 무시한다', () => {
    const doc = buildDocFromState({}, META);
    doc.transact(() => { doc.getMap('cats').set('bad', 123); });
    expect(() => materialize(doc)).not.toThrow();
    expect(materialize(doc)['bad']).toBeUndefined();
  });
});

describe('buildDoc 입력 방어', () => {
  it('중복 블록 id 가 있어도 모두 보존한다', () => {
    const state: EditorState = {
      '1': {
        current: [
          { id: 'dup', type: 'sub', subText: '첫째', authorText: '', bullets: [] },
          { id: 'dup', type: 'sub', subText: '둘째', authorText: '', bullets: [] }
        ] as never,
        next: []
      }
    };
    const got = materialize(buildDocFromState(state, META))['1'].current;
    expect(got.length).toBe(2);
    expect(got.map(b => (b as { subText: string }).subText).sort()).toEqual(['둘째', '첫째']);
  });

  it('id 없는 블록도 버리지 않는다', () => {
    const state = {
      '1': { current: [{ type: 'sub', subText: '아이디 없음', authorText: '', bullets: [] }], next: [] }
    } as unknown as EditorState;
    const got = materialize(buildDocFromState(state, META))['1'].current;
    expect(got.length).toBe(1);
    expect((got[0] as { subText: string }).subText).toBe('아이디 없음');
  });

  it('current/next 가 배열이 아니어도 예외 없이 빈 배열로 처리한다', () => {
    const state = { '1': { current: 'not-an-array', next: null } } as unknown as EditorState;
    expect(() => buildDocFromState(state, META)).not.toThrow();
    const got = materialize(buildDocFromState(state, META))['1'];
    expect(got.current).toEqual([]);
    expect(got.next).toEqual([]);
  });

  it('불릿 id 중복·누락도 보존한다', () => {
    const state = {
      '1': {
        current: [{
          id: 'a', type: 'sub', subText: 'A', authorText: '',
          bullets: [{ id: 'b', text: '1' }, { id: 'b', text: '2' }, { text: '3' }]
        }],
        next: []
      }
    } as unknown as EditorState;
    const blk = materialize(buildDocFromState(state, META))['1'].current[0] as { bullets: { text: string }[] };
    expect(blk.bullets.length).toBe(3);
    expect(blk.bullets.map(x => x.text).sort()).toEqual(['1', '2', '3']);
  });
});
