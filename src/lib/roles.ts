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
