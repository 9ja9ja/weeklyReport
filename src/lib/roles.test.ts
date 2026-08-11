/**
 * 명단 표시 규칙.
 *
 * 이름순으로만 두면 팀장이 목록 한가운데 묻혀 누가 팀장인지 알 수 없다.
 * 반대로 직책 규칙이 설정에서 손으로 정한 순서를 이기면, 관리자가 올려둔 사람이
 * 제자리로 돌아가 그 화면이 거짓말이 된다.
 */
import { describe, it, expect } from 'vitest';
import { roleLabel, positionRank, compareMembers, type OrderedMember } from './roles';

const m = (name: string, position = '', extra: Partial<OrderedMember> = {}): OrderedMember =>
  ({ isPrimary: true, orderIdx: 999, position, name, ...extra });

const order = (list: OrderedMember[]) => [...list].sort(compareMembers).map(x => x.name);

describe('roleLabel', () => {
  it('임원은 직급이 있으면 그 호칭으로 부른다', () => {
    expect(roleLabel('executive', '대표')).toBe('대표');
    expect(roleLabel('executive', '')).toBe('임원');
    expect(roleLabel('executive', null)).toBe('임원');
  });

  it('나머지 권한 표기는 직급과 무관하다', () => {
    expect(roleLabel('superAdmin', '매니저')).toBe('최고관리자');
    expect(roleLabel('teamMaster', '팀장/마스터')).toBe('관리자');
    expect(roleLabel('user', '매니저')).toBe('');
  });
});

describe('positionRank', () => {
  it("'부'가 붙은 직책을 먼저 가려낸다 — 부팀장이 팀장으로 잡히면 순서가 뒤집힌다", () => {
    expect(positionRank('부팀장')).toBeGreaterThan(positionRank('팀장'));
    expect(positionRank('부본부장')).toBeGreaterThan(positionRank('본부장'));
  });

  it('직책과 직급을 함께 적어도 알아본다', () => {
    expect(positionRank('팀장/마스터')).toBe(positionRank('팀장'));
    expect(positionRank('부팀장/매니저')).toBe(positionRank('부팀장'));
    expect(positionRank('본부장/마스터')).toBe(positionRank('본부장'));
  });

  it('직책이 없는 직급은 모두 같은 순위 (그래서 이름순으로 남는다)', () => {
    expect(positionRank('마스터')).toBe(positionRank('매니저'));
    expect(positionRank('프로')).toBe(positionRank('매니저'));
    expect(positionRank('')).toBe(positionRank('매니저'));
    expect(positionRank(null)).toBe(positionRank('매니저'));
  });

  it('위에서부터 대표 > 본부장 > 부본부장 > 팀장 > 부팀장 > 나머지', () => {
    const ranks = ['대표', '본부장', '부본부장', '팀장', '부팀장', '매니저'].map(positionRank);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(new Set(ranks).size).toBe(6);   // 서로 다른 순위여야 한다
  });
});

describe('compareMembers', () => {
  it('팀장·부팀장이 이름과 상관없이 위로 온다', () => {
    expect(order([
      m('하재현', '매니저'), m('손규호', '팀장/마스터'), m('강경오', '매니저'), m('이재민', '부팀장/매니저')
    ])).toEqual(['손규호', '이재민', '강경오', '하재현']);
  });

  it('직책이 없는 사람끼리는 이름순', () => {
    expect(order([m('최연정'), m('김소영'), m('박남수')])).toEqual(['김소영', '박남수', '최연정']);
  });

  it('설정에서 손으로 정한 순서가 직책보다 앞선다', () => {
    expect(order([
      m('성왕선', '본부장/마스터', { orderIdx: 1 }),
      m('안인주', '대표', { orderIdx: 0 }),
      m('김홍규', '부본부장/마스터', { orderIdx: 2 })
    ])).toEqual(['안인주', '성왕선', '김홍규']);

    // 직책이 없는 사람을 일부러 맨 위로 올려둔 경우에도 그대로 지켜져야 한다
    expect(order([
      m('손규호', '팀장/마스터'),
      m('김소영', '매니저', { orderIdx: 0 })
    ])).toEqual(['김소영', '손규호']);
  });

  it('겸직 인원은 직책이 있어도 주 소속 인원 뒤에 붙는다', () => {
    expect(order([
      m('이재민', '부팀장/매니저', { isPrimary: false }),
      m('하재현', '매니저')
    ])).toEqual(['하재현', '이재민']);
  });
});
