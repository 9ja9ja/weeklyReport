/**
 * 항목(불릿)을 추가할 때 **누가 넣었는지** 함께 기록한다.
 *
 * 소분류 옆 작성자는 지금까지 '소분류를 만든 사람' 한 명이었다. 그 아래 항목을 다른 사람이
 * 채워도 취합본·개요에서 드러나지 않아, 실제 기여자가 가려졌다.
 * 기록이 여기서 안 남으면 표시 단계에서 아무리 합쳐도 보여줄 이름이 없다.
 */
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { buildDocFromState, type EditorState } from './buildDoc';
import { materialize } from './materialize';
import { addBullet } from './yOps';

const META = { teamId: 5, year: 2026, weekNum: 38, seedId: 'seed-test' };

/** 소분류 하나짜리 문서 */
function docWithSub(): Y.Doc {
  const state: EditorState = {
    '38': {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      current: [{ id: 'a1', type: 'sub', subText: '공통', authorText: '양병석', bullets: [] } as any],
      next: []
    }
  };
  return buildDocFromState(state, META);
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function bulletsOf(doc: Y.Doc) {
  return (materialize(doc) as any)['38'].current[0].bullets;
}

describe('addBullet — 항목 작성자 기록', () => {
  it('항목을 넣은 사람이 그 항목에 남는다', () => {
    const doc = docWithSub();
    addBullet(doc, '38', 'current', 'a1', undefined, { authorId: 23, authorText: '김소영' });
    expect(bulletsOf(doc)[0]).toMatchObject({ authorText: '김소영', authorId: 23 });
  });

  it('작성자를 넘기지 않으면 아무것도 남기지 않는다 (개인 작성·마이그레이션 경로)', () => {
    const doc = docWithSub();
    addBullet(doc, '38', 'current', 'a1');
    const b = bulletsOf(doc)[0];
    expect(b.authorText).toBeUndefined();
    expect(b.authorId).toBeUndefined();
  });

  it('여러 사람이 각자 넣으면 항목마다 다른 이름이 남는다', () => {
    const doc = docWithSub();
    addBullet(doc, '38', 'current', 'a1', undefined, { authorId: 21, authorText: '양병석' });
    addBullet(doc, '38', 'current', 'a1', undefined, { authorId: 23, authorText: '김소영' });
    expect(bulletsOf(doc).map((b: any) => b.authorText)).toEqual(['양병석', '김소영']);
  });

  it('기록한 작성자는 저장 왕복을 견딘다 — 취합본 저장이 문서를 재구성하기 때문', () => {
    const doc = docWithSub();
    addBullet(doc, '38', 'current', 'a1', undefined, { authorId: 23, authorText: '김소영' });
    const again = buildDocFromState(materialize(doc) as EditorState, META);
    expect(bulletsOf(again)[0]).toMatchObject({ authorText: '김소영', authorId: 23 });
  });
});
