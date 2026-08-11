/**
 * 편집 위치 공유.
 *
 * 여기서 틀리면 **다른 사람이 쓰고 있는 칸을 모른 채 같은 칸을 덮어쓴다**.
 * 반대로 유령 이름표가 남으면 비어 있는 칸을 아무도 손대지 않게 돼 더 나쁘다.
 */
import { describe, it, expect } from 'vitest';
import { readFieldPeers, fieldKey, PART } from './usePresence';

/** awareness.getStates() 가 주는 모양 */
const states = (rows: [number, Record<string, unknown>][]) => new Map(rows);

const user = (uid: number, name: string, color = '#111') => ({ uid, name, color });

const K1 = fieldKey(7, 'current', 'b1', PART.sub);
const K2 = fieldKey(7, 'current', 'b1', PART.bullet('x9'));

describe('readFieldPeers', () => {
  it('칸별로 그 칸에 있는 사람을 모은다', () => {
    const m = readFieldPeers(states([
      [1, { user: user(10, '김하늘'), focus: K1 }],
      [2, { user: user(11, '박서준'), focus: K2 }],
      [3, { user: user(12, '이도윤'), focus: K1 }]
    ]), 99);

    expect(m.get(K1)?.map(p => p.name)).toEqual(['김하늘', '이도윤']);
    expect(m.get(K2)?.map(p => p.name)).toEqual(['박서준']);
  });

  it('내 위치는 넣지 않는다 — 내가 쓰는 칸에 내 이름표가 붙으면 방해만 된다', () => {
    const m = readFieldPeers(states([
      [5, { user: user(10, '김하늘'), focus: K1 }],
      [6, { user: user(11, '박서준'), focus: K1 }]
    ]), 5);

    expect(m.get(K1)?.map(p => p.uid)).toEqual([11]);
  });

  it('같은 사람이 탭을 두 개 열어도 이름표는 하나', () => {
    const m = readFieldPeers(states([
      [1, { user: user(10, '김하늘'), focus: K1 }],
      [2, { user: user(10, '김하늘'), focus: K1 }]
    ]), 99);

    expect(m.get(K1)).toHaveLength(1);
  });

  it('아무 칸에도 안 들어간 접속자는 어디에도 안 붙는다', () => {
    const m = readFieldPeers(states([
      [1, { user: user(10, '김하늘') }],              // 접속만 한 상태
      [2, { user: user(11, '박서준'), focus: null }],  // 칸에서 나온 상태
      [3, { user: user(12, '이도윤'), focus: '' }]
    ]), 99);

    expect(m.size).toBe(0);
  });

  it('사람 정보가 없는 상태는 무시한다 (접속 직후 한 프레임)', () => {
    const m = readFieldPeers(states([
      [1, { focus: K1 }],
      [2, { user: {}, focus: K1 }],
      [3, { user: { name: '이름만' }, focus: K1 }]
    ]), 99);

    expect(m.size).toBe(0);
  });

  it('색이 없으면 사람마다 고정된 색을 채워 넣는다', () => {
    const m = readFieldPeers(states([[1, { user: { uid: 10, name: '김하늘' }, focus: K1 }]]), 99);
    const [p] = m.get(K1)!;
    expect(p.color).toMatch(/^#[0-9a-f]{6}$/i);
    // 같은 사람은 언제나 같은 색이어야 상단 접속자 표시와 짝이 맞는다
    const again = readFieldPeers(states([[2, { user: { uid: 10, name: '김하늘' }, focus: K2 }]]), 99);
    expect(again.get(K2)![0].color).toBe(p.color);
  });
});

describe('fieldKey — 위치는 화면이 아니라 문서 좌표로 가리킨다', () => {
  it('분류·금주/차주·블록·칸이 모두 달라야 다른 칸이다', () => {
    expect(fieldKey(1, 'current', 'b1', PART.sub)).not.toBe(fieldKey(2, 'current', 'b1', PART.sub));
    expect(fieldKey(1, 'current', 'b1', PART.sub)).not.toBe(fieldKey(1, 'next', 'b1', PART.sub));
    expect(fieldKey(1, 'current', 'b1', PART.sub)).not.toBe(fieldKey(1, 'current', 'b2', PART.sub));
    expect(fieldKey(1, 'current', 'b1', PART.sub)).not.toBe(fieldKey(1, 'current', 'b1', PART.caption));
  });

  it('표의 칸은 행·열이 다르면 다른 칸이다', () => {
    expect(PART.cell(1, 2)).not.toBe(PART.cell(2, 1));
    expect(PART.header(1)).not.toBe(PART.header(2));
    // 12행 3열과 1행 23열이 같은 키가 되면 엉뚱한 칸에 이름표가 붙는다
    expect(PART.cell(12, 3)).not.toBe(PART.cell(1, 23));
  });

  it('같은 칸은 누가 계산해도 같은 키가 나온다', () => {
    expect(fieldKey(7, 'current', 'b1', PART.bullet('x9'))).toBe(K2);
  });
});
