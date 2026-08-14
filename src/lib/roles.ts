/**
 * 임원 그룹의 구분(division) 값.
 *
 * 임원은 보고를 쓰지 않고 조회만 하는 계정이라, 이 구분에 속한 팀은 "작성하는 팀"이 아니다.
 * 전체 취합본·엑셀·PDF 에서 빼고, 작성 현황도 완료/전체로 세지 않는다.
 * (문자열 비교라 구분 이름을 바꾸면 여기부터 고쳐야 한다 — 그래서 한 곳에 둔다)
 */
export const EXECUTIVE_DIVISION = '임원';

export function isExecutiveGroup(team: { division?: string | null }): boolean {
  return (team.division ?? '').trim() === EXECUTIVE_DIVISION;
}

/**
 * 화면에 보이는 직함.
 *
 * 임원 계정은 권한상 한 종류지만 호칭은 대표·부사장·이사로 제각각이다. 직급(position)이
 * 적혀 있으면 그것을 그대로 쓰고, 없을 때만 '임원'으로 표시한다.
 */
export function roleLabel(role: string, position?: string | null): string {
  if (role === 'superAdmin') return '최고관리자';
  if (role === 'teamMaster') return '관리자';
  if (role === 'executive') return position?.trim() || '임원';
  return '';
}

/**
 * 직책 순위 — 명단에서 팀장·부팀장이 이름순에 묻히지 않게 위로 올린다.
 *
 * `팀장/마스터` 처럼 직책과 직급을 함께 적는 표기도 있어 포함 여부로 본다.
 * **'부'가 붙은 쪽을 먼저 봐야 한다** — '부팀장'은 '팀장'을 품고 있어서
 * 순서를 바꾸면 부팀장이 팀장으로 잡힌다.
 * 직책이 없는 사람(매니저·프로 등)은 모두 같은 순위라 이름순으로 남는다.
 */
export function positionRank(position?: string | null): number {
  const p = (position ?? '').replace(/\s/g, '');
  if (!p) return 90;
  if (p.includes('대표')) return 0;
  if (p.includes('부본부장')) return 12;
  if (p.includes('본부장')) return 11;
  if (p.includes('부팀장')) return 22;
  if (p.includes('팀장')) return 21;
  return 90;
}

export interface OrderedMember {
  isPrimary: boolean;
  /** 설정에서 손으로 정한 순서. 지정 없으면 999 */
  orderIdx: number;
  position?: string | null;
  name: string;
}

/**
 * 팀 안 표시 순서.
 *
 * 겸직 인원은 뒤로 → 손으로 정한 순서 → 직책(팀장·부팀장) → 이름.
 * **손으로 정한 순서가 직책보다 앞선다** — 설정에서 일부러 올려둔 사람이
 * 직책 규칙에 밀려 내려가면 그 화면이 거짓말이 된다.
 */
export function compareMembers(a: OrderedMember, b: OrderedMember): number {
  const pa = a.isPrimary ? 0 : 1, pb = b.isPrimary ? 0 : 1;
  if (pa !== pb) return pa - pb;
  if (a.orderIdx !== b.orderIdx) return a.orderIdx - b.orderIdx;
  const ra = positionRank(a.position), rb = positionRank(b.position);
  if (ra !== rb) return ra - rb;
  return a.name.localeCompare(b.name, 'ko');
}
