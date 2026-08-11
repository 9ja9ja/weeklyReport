/**
 * 권한 변경 규칙.
 *
 * 여기가 뚫리면 **아무도 설정을 못 여는 상태**가 만들어진다 —
 * 마지막 최고관리자를 풀거나, 본인이 자기 권한을 내려 잠기는 경우다.
 * 화면에서 복구할 방법이 없어 DB 를 직접 고쳐야 하므로 규칙을 여기에 고정한다.
 */
import { describe, it, expect } from 'vitest';
import { roleChangeError, isRole } from './roleChange';

const base = {
  actorId: 1,
  actorIsSuperAdmin: true,
  target: { id: 2, role: 'user' },
  nextRole: 'superAdmin' as unknown,
  superAdminCount: 2
};

describe('허용되는 변경', () => {
  it('최고관리자가 다른 사람을 최고관리자로 지정', () => {
    expect(roleChangeError(base)).toBeNull();
  });

  it('최고관리자가 다른 최고관리자를 해제 (남은 최고관리자가 있을 때)', () => {
    expect(roleChangeError({
      ...base, target: { id: 2, role: 'superAdmin' }, nextRole: 'user', superAdminCount: 2
    })).toBeNull();
  });

  it('팀장이 팀원을 관리자로 지정 (최고관리자가 아니어도 된다)', () => {
    expect(roleChangeError({
      ...base, actorIsSuperAdmin: false, nextRole: 'teamMaster'
    })).toBeNull();
  });
});

describe('막아야 하는 변경', () => {
  it('마지막 최고관리자는 해제할 수 없다', () => {
    const err = roleChangeError({
      ...base, target: { id: 2, role: 'superAdmin' }, nextRole: 'user', superAdminCount: 1
    });
    expect(err).toMatch(/마지막 최고관리자/);
  });

  it('본인의 권한은 스스로 낮출 수 없다', () => {
    for (const role of ['superAdmin', 'teamMaster', 'executive']) {
      const err = roleChangeError({
        ...base, target: { id: 1, role }, nextRole: 'user', superAdminCount: 3
      });
      expect(err).toMatch(/본인의 권한/);
    }
  });

  it('본인을 최고관리자에서 팀장으로 낮추는 것도 막는다 (해제와 다를 바 없다)', () => {
    expect(roleChangeError({
      ...base, target: { id: 1, role: 'superAdmin' }, nextRole: 'teamMaster', superAdminCount: 3
    })).toMatch(/본인의 권한/);
  });

  it('최고관리자가 아니면 최고관리자·임원을 지정할 수 없다', () => {
    expect(roleChangeError({ ...base, actorIsSuperAdmin: false, nextRole: 'superAdmin' }))
      .toMatch(/최고관리자만 지정/);
    expect(roleChangeError({ ...base, actorIsSuperAdmin: false, nextRole: 'executive' }))
      .toMatch(/최고관리자만 지정/);
  });

  it('최고관리자가 아니면 최고관리자를 해제할 수 없다', () => {
    expect(roleChangeError({
      ...base, actorIsSuperAdmin: false, target: { id: 2, role: 'superAdmin' }, nextRole: 'user'
    })).toMatch(/최고관리자만 해제/);
  });

  it('모르는 권한 값은 저장하지 않는다 — 통과시키면 아무 권한도 안 먹는 계정이 된다', () => {
    for (const v of ['admin', 'SUPERADMIN', '', null, 7, undefined]) {
      expect(roleChangeError({ ...base, nextRole: v })).toMatch(/권한 값/);
    }
  });
});

describe('isRole', () => {
  it('아는 값만 통과시킨다', () => {
    expect(['user', 'teamMaster', 'executive', 'superAdmin'].every(isRole)).toBe(true);
    expect(isRole('master')).toBe(false);
    expect(isRole(undefined)).toBe(false);
  });
});
