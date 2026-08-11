/**
 * 권한 변경 규칙.
 *
 * 여기서 한 번 잘못 통과시키면 **되돌릴 사람이 없어진다** — 마지막 최고관리자가 풀리면
 * 팀·팀원·분류를 손댈 수 있는 계정이 하나도 남지 않고, 화면에서는 복구할 방법이 없다.
 * 그래서 판단을 한곳에 모아 두고 시나리오별로 테스트를 붙였다.
 */

export const ROLES = ['user', 'teamMaster', 'executive', 'superAdmin'] as const;
export type Role = (typeof ROLES)[number];

export const isRole = (v: unknown): v is Role =>
  typeof v === 'string' && (ROLES as readonly string[]).includes(v);

export interface RoleChange {
  /** 바꾸려는 사람 */
  actorId: number;
  actorIsSuperAdmin: boolean;
  target: { id: number; role: string };
  nextRole: unknown;
  /** 지금 남아 있는 활성 최고관리자 수 (대상 포함) */
  superAdminCount: number;
}

/** 막아야 할 이유. 문제가 없으면 null */
export function roleChangeError(c: RoleChange): string | null {
  if (!isRole(c.nextRole)) return '권한 값이 올바르지 않습니다.';
  const next = c.nextRole;

  // 최고관리자·임원은 최고관리자만 다룬다 (팀장은 자기 팀의 관리자 지정까지)
  if ((next === 'superAdmin' || next === 'executive') && !c.actorIsSuperAdmin) {
    return '최고관리자만 지정할 수 있습니다.';
  }
  if (c.target.role === 'superAdmin' && next !== 'superAdmin' && !c.actorIsSuperAdmin) {
    return '최고관리자만 해제할 수 있습니다.';
  }

  // 본인 권한은 스스로 낮추지 못한다. 실수로 눌러 잠기는 사고가 가장 흔하다.
  if (c.actorId === c.target.id && c.target.role !== 'user' && next !== c.target.role) {
    return '본인의 권한은 바꿀 수 없습니다. 다른 최고관리자에게 요청해주세요.';
  }

  // 마지막 최고관리자를 풀면 아무도 되돌릴 수 없다.
  if (c.target.role === 'superAdmin' && next !== 'superAdmin' && c.superAdminCount <= 1) {
    return '마지막 최고관리자는 해제할 수 없습니다. 다른 사람을 최고관리자로 지정한 뒤 해제해주세요.';
  }

  return null;
}
