/**
 * 왕복 항등성 — EditorState → Y.Doc → EditorState 가 원본과 같아야 한다.
 *
 * 이 성질이 깨지면 마이그레이션 백필에서 조용히 내용이 바뀌므로 Phase 1 최우선 검증 대상이다.
 * 고정 케이스 + 무작위 100건으로 확인한다.
 */
import { describe, it, expect } from 'vitest';
import { buildDocFromState, type EditorState } from './buildDoc';
import { materialize } from './materialize';

const META = { teamId: 1, year: 2026, weekNum: 32, seedId: 'seed-test' };

/** 왕복 후 비교 — 순서·값이 모두 보존돼야 한다 */
function roundtrip(state: EditorState): EditorState {
  return materialize(buildDocFromState(state, META));
}

/** buildDoc 은 authorId 를 항상 채우므로, 기대값도 같은 형태로 정규화해 비교한다 */
function normalize(state: EditorState): EditorState {
  const out: EditorState = {};
  for (const [catId, cat] of Object.entries(state)) {
    out[catId] = {
      current: (cat.current ?? []).map(normalizeBlock) as EditorState[string]['current'],
      next: (cat.next ?? []).map(normalizeBlock) as EditorState[string]['next']
    };
  }
  return out;
}
// 테스트 픽스처는 부분 객체를 다루므로 any 를 허용한다
/* eslint-disable @typescript-eslint/no-explicit-any */
function normalizeBlock(b: any) {
  if (b.type === 'table') {
    const width = (b.headers ?? []).length;
    return {
      id: b.id,
      type: 'table',
      caption: b.caption ?? '',
      headers: (b.headers ?? []).map((h: string) => h ?? ''),
      // 행은 헤더 폭으로 맞춰진다 (짧으면 '' 채움, 길면 잘림)
      rows: (b.rows ?? []).map((r: string[]) =>
        Array.from({ length: width }, (_, i) => r?.[i] ?? '')
      ),
      authorText: b.authorText ?? '',
      authorId: b.authorId ?? null
    };
  }
  return {
    id: b.id,
    type: 'sub',
    subText: b.subText ?? '',
    authorText: b.authorText ?? '',
    authorId: b.authorId ?? null,
    bullets: (b.bullets ?? []).map((x: any) => ({ id: x.id, text: x.text ?? '' }))
  };
}

describe('buildDoc ↔ materialize 왕복', () => {
  it('빈 상태', () => {
    expect(roundtrip({})).toEqual({});
  });

  it('소분류 + 불릿 순서 보존', () => {
    const state: EditorState = {
      '12': {
        current: [
          { id: 'a1', type: 'sub', subText: '근태관리 개편', authorText: '방수진',
            bullets: [{ id: 'b1', text: '정책 초안' }, { id: 'b2', text: '검토 요청' }] } as any,
          { id: 'a2', type: 'sub', subText: '전자계약', authorText: '허주희', bullets: [] } as any
        ],
        next: []
      }
    };
    expect(roundtrip(state)).toEqual(normalize(state));
  });

  it('표 — 헤더/행/셀 보존', () => {
    const state: EditorState = {
      '7': {
        current: [{
          id: 't1', type: 'table', caption: '해지 사유',
          headers: ['사유', '건수', '비율'],
          rows: [['기능', '14', '56.3%'], ['품질', '-', '6.3%']],
          authorText: '박민수'
        } as any],
        next: []
      }
    };
    expect(roundtrip(state)).toEqual(normalize(state));
  });

  it('표 — 빈 셀과 폭이 다른 행을 헤더 폭으로 정규화', () => {
    const state: EditorState = {
      '7': {
        current: [{
          id: 't2', type: 'table', caption: '',
          headers: ['A', 'B', 'C'],
          rows: [['1'], ['1', '2', '3', '4'], ['', '', '']],
          authorText: ''
        } as any],
        next: []
      }
    };
    const got = roundtrip(state);
    expect(got['7'].current[0]).toMatchObject({
      headers: ['A', 'B', 'C'],
      rows: [['1', '', ''], ['1', '2', '3'], ['', '', '']]
    });
  });

  it('current 와 next 를 섞어도 각각 보존', () => {
    const state: EditorState = {
      '3': {
        current: [{ id: 'c1', type: 'sub', subText: '금주', authorText: '', bullets: [] } as any],
        next: [{ id: 'n1', type: 'sub', subText: '차주', authorText: '', bullets: [] } as any]
      }
    };
    expect(roundtrip(state)).toEqual(normalize(state));
  });

  it('여러 카테고리', () => {
    const state: EditorState = {
      '1': { current: [{ id: 'x', type: 'sub', subText: 'A', authorText: '', bullets: [] } as any], next: [] },
      '2': { current: [], next: [{ id: 'y', type: 'sub', subText: 'B', authorText: '', bullets: [] } as any] },
      '3': { current: [], next: [] }
    };
    expect(roundtrip(state)).toEqual(normalize(state));
  });

  it('특수문자·줄바꿈·긴 문자열 보존', () => {
    const weird = '줄1\n줄2\t탭 <script>&"\'</script> 이모지없음 ✓ → △▽';
    const state: EditorState = {
      '9': {
        current: [{ id: 's', type: 'sub', subText: weird, authorText: '김·이', bullets: [{ id: 'b', text: weird }] } as any],
        next: []
      }
    };
    const got = roundtrip(state);
    expect(got['9'].current[0]).toMatchObject({ subText: weird, bullets: [{ id: 'b', text: weird }] });
  });
});

// ── 무작위 100건 속성 테스트 ─────────────────────────────────
// 결정적 시드 PRNG — 실패 시 재현 가능해야 한다
function mulberry32(seed: number) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomState(rnd: () => number): EditorState {
  const pick = <T,>(arr: T[]): T => arr[Math.floor(rnd() * arr.length)];
  const txt = () => pick(['', '가나다', 'abc 123', '△12', '(1,234)', '-', '줄1\n줄2', '  공백  ']);
  const n = (max: number) => Math.floor(rnd() * (max + 1));

  const state: EditorState = {};
  const catCount = n(3);
  for (let c = 0; c < catCount; c++) {
    const mk = (prefix: string) => {
      const blocks: any[] = [];
      const bc = n(3);
      for (let i = 0; i < bc; i++) {
        if (rnd() < 0.5) {
          blocks.push({
            id: `${prefix}s${i}`, type: 'sub', subText: txt(), authorText: txt(),
            bullets: Array.from({ length: n(3) }, (_, j) => ({ id: `${prefix}s${i}b${j}`, text: txt() }))
          });
        } else {
          const w = 1 + n(3);
          blocks.push({
            id: `${prefix}t${i}`, type: 'table', caption: txt(),
            headers: Array.from({ length: w }, () => txt()),
            rows: Array.from({ length: n(3) }, () => Array.from({ length: w }, () => txt())),
            authorText: txt()
          });
        }
      }
      return blocks;
    };
    state[String(c)] = { current: mk(`c${c}`), next: mk(`n${c}`) };
  }
  return state;
}

describe('왕복 항등성 — 무작위 100건', () => {
  it('모든 케이스에서 원본과 일치', () => {
    let checked = 0;
    for (let seed = 1; seed <= 100; seed++) {
      const state = randomState(mulberry32(seed));
      const got = roundtrip(state);
      expect(got, `seed=${seed}`).toEqual(normalize(state));
      checked++;
    }
    expect(checked).toBe(100);
  });
});

/**
 * 항목별 작성자와 이름 고정 표시는 **반드시 왕복을 견뎌야 한다.**
 *
 * 공동 편집 주차의 취합본 저장(POST /api/reports/summary)은 EditorState JSON 에서
 * Y.Doc 을 통째로 재구성한다(op:'restore'). 이 두 필드가 왕복 계약에서 빠지면
 * 팀장이 취합본을 한 번 저장하는 순간 항목 작성자가 전원 사라진다.
 */
describe('작성자 표기 필드 왕복', () => {
  it('항목별 작성자가 보존된다', () => {
    const state: EditorState = {
      '38': {
        current: [{
          id: 'a1', type: 'sub', subText: '공통', authorText: '양병석', authorId: 21,
          bullets: [
            { id: 'b1', text: '로그 개선', authorText: '양병석', authorId: 21 },
            { id: 'b2', text: '엑셀 오류 안내', authorText: '김소영', authorId: 23 }
          ]
        } as any],
        next: []
      }
    };
    const back = roundtrip(state) as any;
    expect(back['38'].current[0].bullets).toEqual([
      { id: 'b1', text: '로그 개선', authorText: '양병석', authorId: 21 },
      { id: 'b2', text: '엑셀 오류 안내', authorText: '김소영', authorId: 23 }
    ]);
  });

  it('팀장이 고정한 이름 표시(authorPinned)가 보존된다', () => {
    const state: EditorState = {
      '38': {
        current: [{
          id: 'a1', type: 'sub', subText: '공통', authorText: '개발1파트', authorId: null,
          authorPinned: true,
          bullets: [{ id: 'b1', text: 'x', authorText: '양병석', authorId: 21 }]
        } as any],
        next: []
      }
    };
    expect((roundtrip(state) as any)['38'].current[0].authorPinned).toBe(true);
  });

  it('작성자 정보가 없는 기존 문서는 그대로 왕복한다', () => {
    const state: EditorState = {
      '38': {
        current: [{
          id: 'a1', type: 'sub', subText: '공통', authorText: '양병석',
          bullets: [{ id: 'b1', text: '로그 개선' }]
        } as any],
        next: []
      }
    };
    const back = roundtrip(state) as any;
    expect(back['38'].current[0].bullets[0].text).toBe('로그 개선');
    expect(back['38'].current[0].authorPinned).toBeUndefined();
  });
});
