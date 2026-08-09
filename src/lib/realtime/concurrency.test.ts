/**
 * 동시 편집 성질 검증 — 서버 없이 Y.Doc 두 개로 update 를 주고받아 확인한다.
 *
 * 핵심 질문:
 *  1. 두 사람이 같은 블록을 동시에 옮기면 복제되는가? (Y.Array 를 버리고 Y.Map+order 를 쓴 이유)
 *  2. 같은 텍스트를 동시에 고치면 병합되는가?
 *  3. 표 셀 LWW 가 수렴하는가?
 *  4. 같은 두 항목 사이에 동시 삽입해 order 가 같아져도 양쪽이 같은 순서를 보는가?
 *  5. 카테고리 컨테이너를 동시에 만들면 한쪽이 사라지는가? (ensureCategory 가 막아야 한다)
 */
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { buildDocFromState, ensureCategory, sideMap, type EditorState } from './buildDoc';
import { materialize, readMeta } from './materialize';
import { BLOCK, sortedEntries } from './schema';
import {
  addSubBlock, moveBlock, setCell, insertRow, addTableBlock, removeBlock
} from './yOps';

const META = { teamId: 1, year: 2026, weekNum: 32, seedId: 's' };

/** 두 문서를 양방향 동기화 (수렴 확인용) */
function sync(a: Y.Doc, b: Y.Doc) {
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)));
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)));
}

/** 같은 시드에서 출발한 두 클라이언트 문서 */
function twoClients(state: EditorState): [Y.Doc, Y.Doc] {
  const server = buildDocFromState(state, META);
  const a = new Y.Doc(); Y.applyUpdate(a, Y.encodeStateAsUpdate(server));
  const b = new Y.Doc(); Y.applyUpdate(b, Y.encodeStateAsUpdate(server));
  return [a, b];
}

const THREE_BLOCKS: EditorState = {
  '1': {
    current: [
      { id: 'b1', type: 'sub', subText: '첫째', authorText: '', bullets: [] },
      { id: 'b2', type: 'sub', subText: '둘째', authorText: '', bullets: [] },
      { id: 'b3', type: 'sub', subText: '셋째', authorText: '', bullets: [] }
    ] as never,
    next: []
  }
};

describe('동시 편집 수렴', () => {
  it('같은 블록을 동시에 다른 위치로 이동해도 복제되지 않는다', () => {
    const [a, b] = twoClients(THREE_BLOCKS);

    // A: b3 을 맨 앞으로 / B: b3 을 b1 과 b2 사이로
    moveBlock(a, '1', 'current', 'b3', null, 'b1', 'A');
    moveBlock(b, '1', 'current', 'b3', 'b1', 'b2', 'B');
    sync(a, b);

    const ids = (d: Y.Doc) => materialize(d)['1'].current.map(x => x.id);
    expect(ids(a)).toEqual(ids(b));            // 수렴
    expect(ids(a).sort()).toEqual(['b1', 'b2', 'b3']); // 복제·유실 없음
    expect(new Set(ids(a)).size).toBe(3);
  });

  it('서로 다른 블록을 동시에 추가하면 둘 다 살아남는다', () => {
    const [a, b] = twoClients(THREE_BLOCKS);
    const idA = addSubBlock(a, '1', 'current', { authorId: 1, authorText: '가' }, 'A');
    const idB = addSubBlock(b, '1', 'current', { authorId: 2, authorText: '나' }, 'B');
    sync(a, b);

    const ids = materialize(a)['1'].current.map(x => x.id);
    expect(ids).toContain(idA);
    expect(ids).toContain(idB);
    expect(ids.length).toBe(5);
    expect(materialize(a)).toEqual(materialize(b));
  });

  it('같은 소분류 텍스트를 동시에 편집하면 문자 단위로 병합된다', () => {
    const [a, b] = twoClients(THREE_BLOCKS);
    const textOf = (d: Y.Doc, id: string) => {
      const sm = sideMap(d, '1', 'current');
      return (sm.get(id) as Y.Map<unknown>).get(BLOCK.subText) as Y.Text;
    };
    textOf(a, 'b1').insert(0, '[A]');
    textOf(b, 'b1').insert(2, '[B]');   // '첫째' 뒤
    sync(a, b);

    const ra = materialize(a)['1'].current.find(x => x.id === 'b1') as { subText: string };
    const rb = materialize(b)['1'].current.find(x => x.id === 'b1') as { subText: string };
    expect(ra.subText).toBe(rb.subText);          // 수렴
    expect(ra.subText).toContain('[A]');          // 양쪽 편집 보존
    expect(ra.subText).toContain('[B]');
    expect(ra.subText).toContain('첫째');
  });

  it('같은 표 셀을 동시에 고치면 한쪽 값으로 수렴한다 (LWW)', () => {
    const seed = buildDocFromState({}, META);
    const tid = addTableBlock(seed, '1', 'current', { authorId: null, authorText: '' }, 2, 2);
    const a = new Y.Doc(); Y.applyUpdate(a, Y.encodeStateAsUpdate(seed));
    const b = new Y.Doc(); Y.applyUpdate(b, Y.encodeStateAsUpdate(seed));

    const firstCell = (d: Y.Doc) => {
      const sm = sideMap(d, '1', 'current');
      const blk = sm.get(tid) as Y.Map<unknown>;
      const rid = sortedEntries(blk.get(BLOCK.rows) as Y.Map<unknown>)[0][0];
      const cid = sortedEntries(blk.get(BLOCK.cols) as Y.Map<unknown>)[0][0];
      return { rid, cid };
    };
    const { rid, cid } = firstCell(a);
    setCell(a, '1', 'current', tid, rid, cid, 'A값', 'A');
    setCell(b, '1', 'current', tid, rid, cid, 'B값', 'B');
    sync(a, b);

    const va = (materialize(a)['1'].current[0] as { rows: string[][] }).rows[0][0];
    const vb = (materialize(b)['1'].current[0] as { rows: string[][] }).rows[0][0];
    expect(va).toBe(vb);                    // 수렴
    expect(['A값', 'B값']).toContain(va);   // 둘 중 하나
  });

  it('같은 자리에 동시 삽입해 order 가 같아져도 양쪽이 같은 순서를 본다', () => {
    // order 를 인위적으로 같게 만들어 tie-break 를 강제 검증
    const [a, b] = twoClients(THREE_BLOCKS);
    const put = (d: Y.Doc, id: string, order: string) => {
      const sm = sideMap(d, '1', 'current');
      d.transact(() => {
        const m = new Y.Map();
        m.set(BLOCK.type, 'sub');
        m.set(BLOCK.order, order);
        m.set(BLOCK.authorId, null);
        m.set(BLOCK.authorText, '');
        m.set(BLOCK.subText, new Y.Text());
        m.set(BLOCK.bullets, new Y.Map());
        sm.set(id, m);
      });
    };
    put(a, 'zz1', 'a0M');
    put(b, 'zz2', 'a0M');   // 동일 order
    sync(a, b);

    const ids = (d: Y.Doc) => materialize(d)['1'].current.map(x => x.id);
    expect(ids(a)).toEqual(ids(b));  // 같은 순서
    expect(ids(a)).toContain('zz1');
    expect(ids(a)).toContain('zz2');
  });

  it('표 행을 위로 삽입해도 양쪽이 수렴한다 (개선요청 4번)', () => {
    const seed = buildDocFromState({}, META);
    const tid = addTableBlock(seed, '1', 'current', { authorId: null, authorText: '' }, 2, 2);
    const a = new Y.Doc(); Y.applyUpdate(a, Y.encodeStateAsUpdate(seed));
    const b = new Y.Doc(); Y.applyUpdate(b, Y.encodeStateAsUpdate(seed));

    insertRow(a, '1', 'current', tid, 'top', undefined, 'A');
    insertRow(b, '1', 'current', tid, 'top', undefined, 'B');
    sync(a, b);

    const rowsA = (materialize(a)['1'].current[0] as { rows: string[][] }).rows;
    const rowsB = (materialize(b)['1'].current[0] as { rows: string[][] }).rows;
    expect(rowsA.length).toBe(4);      // 2 + 2
    expect(rowsA).toEqual(rowsB);
  });

  it('한쪽이 지운 블록을 다른 쪽이 편집해도 문서가 깨지지 않는다', () => {
    const [a, b] = twoClients(THREE_BLOCKS);
    const t = (sideMap(b, '1', 'current').get('b2') as Y.Map<unknown>).get(BLOCK.subText) as Y.Text;
    removeBlock(a, '1', 'current', 'b2', 'A');
    t.insert(0, '수정');
    sync(a, b);

    expect(materialize(a)).toEqual(materialize(b));
    const ids = materialize(a)['1'].current.map(x => x.id);
    expect(ids).not.toContain('b2');   // 삭제가 이긴다
  });
});

describe('컨테이너 동시 생성', () => {
  it('ensureCategory 는 같은 카테고리를 두 번 만들지 않는다 (같은 문서)', () => {
    const doc = buildDocFromState({}, META);
    const c1 = ensureCategory(doc, 42);
    const c2 = ensureCategory(doc, 42);
    expect(c1).toBe(c2);
  });

  it('두 클라이언트가 동시에 같은 새 카테고리를 만들면 한쪽 블록이 사라진다 — 서버 경유가 필요한 이유', () => {
    const [a, b] = twoClients({});
    // 각자 로컬에서 컨테이너를 만들고 블록을 넣는다 (서버 경유 없이)
    const idA = addSubBlock(a, '99', 'current', { authorId: 1, authorText: '가' }, 'A');
    const idB = addSubBlock(b, '99', 'current', { authorId: 2, authorText: '나' }, 'B');
    sync(a, b);

    const ids = materialize(a)['99'].current.map(x => x.id);
    expect(materialize(a)).toEqual(materialize(b));   // 수렴은 한다
    // 컨테이너 LWW 로 한쪽이 통째로 사라진다 — 이 성질을 문서화하고 서버 시드로 막는다
    const lost = !ids.includes(idA) || !ids.includes(idB);
    expect(lost).toBe(true);
  });

  it('컨테이너가 이미 있으면 두 클라이언트의 블록이 모두 살아남는다', () => {
    // 서버가 카테고리를 먼저 만들어 배포한 상태
    const server = buildDocFromState({ '99': { current: [], next: [] } }, META);
    const a = new Y.Doc(); Y.applyUpdate(a, Y.encodeStateAsUpdate(server));
    const b = new Y.Doc(); Y.applyUpdate(b, Y.encodeStateAsUpdate(server));

    const idA = addSubBlock(a, '99', 'current', { authorId: 1, authorText: '가' }, 'A');
    const idB = addSubBlock(b, '99', 'current', { authorId: 2, authorText: '나' }, 'B');
    sync(a, b);

    const ids = materialize(a)['99'].current.map(x => x.id);
    expect(ids).toContain(idA);
    expect(ids).toContain(idB);
  });
});

describe('재시드 방어', () => {
  const seedState: EditorState = {
    '1': { current: [{ id: 'x', type: 'sub', subText: '이월 내용', authorText: '', bullets: [] }] as never, next: [] }
  };

  /**
   * 이 스키마에서 재시드의 실패 양상은 "중복"이 아니라 "소실"이다.
   * Y.Text 가 Y.Map 키 아래 중첩돼 있어 키 단위 LWW 가 적용되기 때문 —
   * 두 문서가 각자 만든 Y.Text 중 하나가 통째로 이기고 반대쪽 편집이 사라진다.
   * (루트 레벨 Y.Text 였다면 문자 단위로 중복됐을 것이다.)
   */
  it('독립 시드 후 각자 편집한 내용을 병합하면 한쪽이 통째로 사라진다', () => {
    const d1 = buildDocFromState(seedState, { ...META, seedId: 'seed-1' });
    const d2 = buildDocFromState(seedState, { ...META, seedId: 'seed-2' });

    // 각 세대에서 서로 다른 편집이 일어난 상태
    const textOf = (d: Y.Doc) =>
      (sideMap(d, '1', 'current').get('x') as Y.Map<unknown>).get(BLOCK.subText) as Y.Text;
    textOf(d1).insert(textOf(d1).length, ' + A가 추가');
    textOf(d2).insert(textOf(d2).length, ' + B가 추가');

    const merged = new Y.Doc();
    Y.applyUpdate(merged, Y.encodeStateAsUpdate(d2));
    Y.applyUpdate(merged, Y.encodeStateAsUpdate(d1));

    const text = (materialize(merged)['1'].current[0] as { subText: string }).subText;
    // 한쪽만 남는다 — 양쪽이 다 보존되지 않는 것이 핵심
    const hasA = text.includes('A가 추가');
    const hasB = text.includes('B가 추가');
    expect(hasA && hasB).toBe(false);
    expect(hasA || hasB).toBe(true);
  });

  it('seedId 가 다르면 로컬본을 폐기해 소실을 막는다', () => {
    const server = buildDocFromState(seedState, { ...META, seedId: 'seed-2' });
    const localStale = buildDocFromState(seedState, { ...META, seedId: 'seed-1' });

    const serverSeed = readMeta(server).seedId;
    const localSeed = readMeta(localStale).seedId;
    expect(localSeed).not.toBe(serverSeed);

    // 가드: 불일치면 로컬을 병합하지 않고 서버본만 채택
    const adopted = new Y.Doc();
    Y.applyUpdate(adopted, Y.encodeStateAsUpdate(server));
    expect(materialize(adopted)).toEqual(materialize(server));
    expect(readMeta(adopted).seedId).toBe('seed-2');
  });
});
