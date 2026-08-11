'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useUser } from '@/lib/UserContext';
import { getWeekNumber } from '@/lib/weekUtils';
import { isCollabWeek, type TeamCollabRange } from '@/lib/collabWeek';
import { roleLabel } from '@/lib/roles';
import { COLLAB_WRITE_READY } from '@/lib/realtime/collabReady';

/** 이번 주차 기준으로 이 팀이 공동 편집인지 */
function isCollabOn(t: TeamCollabRange): boolean {
  const now = new Date();
  return isCollabWeek(t, now.getFullYear(), getWeekNumber(now));
}

interface TeamInfo {
  id: number; name: string; division?: string;
  collabFromYear?: number | null; collabFromWeek?: number | null;
  collabUntilYear?: number | null; collabUntilWeek?: number | null;
  _count?: { users: number; parts?: number };
}
interface UserInfo { id: number; name: string; role: string; teamId: number; position?: string; isPrimary?: boolean; teamIds?: number[]; }
interface PartInfo { id: number; name: string; orderIdx: number; teamId: number; isActive: boolean; }
interface MajorInfo { id: number; name: string; orderIdx: number; teamId: number; partId: number; isActive: boolean; }
interface CategoryInfo { id: number; major: string; middle: string; orderIdx: number; teamId: number; partId: number; isActive: boolean; }

export default function SettingsPage() {
  const { userId, teamId: myTeamId, isMasterOrAbove, isSuperAdmin, isExecutive, isHydrating } = useUser();
  const router = useRouter();

  // superAdmin은 팀을 선택할 수 있음, teamMaster는 본인팀 고정
  const [selectedTeamId, setSelectedTeamId] = useState<number | null>(null);
  const [selectedPartId, setSelectedPartId] = useState<number | null>(null);
  const [teams, setTeams] = useState<TeamInfo[]>([]);
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [allUsers, setAllUsers] = useState<UserInfo[]>([]);
  const [parts, setParts] = useState<PartInfo[]>([]);
  const [majors, setMajors] = useState<MajorInfo[]>([]);
  const [categories, setCategories] = useState<CategoryInfo[]>([]);

  const [newTeamName, setNewTeamName] = useState('');
  const [newTeamDivision, setNewTeamDivision] = useState('');
  const [newUserName, setNewUserName] = useState('');
  const [crossUserId, setCrossUserId] = useState('');
  const [newPartName, setNewPartName] = useState('');
  const [newMajorName, setNewMajorName] = useState('');
  const [newMiddle, setNewMiddle] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  const activeTeamId = isSuperAdmin ? selectedTeamId : myTeamId;
  const activeTeamName = teams.find(t => t.id === activeTeamId)?.name || '';

  // 선택된 파트 기준으로 필터링
  const partMajors = majors.filter(m => m.partId === selectedPartId);
  const partCategories = categories.filter(c => c.partId === selectedPartId);
  const selectedPart = parts.find(p => p.id === selectedPartId);

  const fetchTeamData = useCallback(async (tid: number) => {
    try {
      const [uRes, pRes, mRes, cRes] = await Promise.all([
        fetch(`/api/users?teamId=${tid}`),
        fetch(`/api/parts?teamId=${tid}&includeInactive=true`),
        fetch(`/api/majors?teamId=${tid}&includeInactive=true`),
        fetch(`/api/categories?teamId=${tid}&includeInactive=true`)
      ]);
      const uData: UserInfo[] = await uRes.json();
      const pData: PartInfo[] = await pRes.json();
      setUsers(Array.isArray(uData) ? uData : []);
      setParts(Array.isArray(pData) ? pData : []);
      setMajors(await mRes.json());
      setCategories(await cRes.json());

      // 선택된 파트가 사라졌으면 첫 활성 파트로
      setSelectedPartId(prev => {
        if (prev && pData.some(p => p.id === prev)) return prev;
        return pData.find(p => p.isActive)?.id ?? pData[0]?.id ?? null;
      });
    } catch { }
  }, []);

  const fetchTeams = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/teams');
      const data = await res.json();
      const t: TeamInfo[] = Array.isArray(data) ? data : [];
      setTeams(t);
      if (isSuperAdmin) {
        setSelectedTeamId(prev => prev ?? (t.length > 0 ? t[0].id : null));
        const allRes = await fetch('/api/users');
        const all = await allRes.json();
        setAllUsers(Array.isArray(all) ? all : []);
      } else {
        setSelectedTeamId(myTeamId);
      }
    } catch { }
    finally { setLoading(false); }
  }, [isSuperAdmin, myTeamId]);

  useEffect(() => {
    if (isHydrating) return; // 세션 복원 전에는 판단하지 않는다
    // 대분류는 팀원 누구나 관리하므로 일반 사용자도 이 화면에 들어온다.
    // 마스터 전용 섹션(팀·팀원·파트·중분류)은 아래에서 개별로 가린다. 임원은 작성 자체를 안 하므로 제외.
    if (!userId || isExecutive) { router.push('/'); return; }
    fetchTeams();
  }, [isHydrating, userId, isExecutive, fetchTeams, router]);

  useEffect(() => {
    if (activeTeamId) fetchTeamData(activeTeamId);
  }, [activeTeamId, fetchTeamData]);

  const reload = () => { if (activeTeamId) fetchTeamData(activeTeamId); };
  const post = (url: string, body: unknown, method = 'POST') =>
    fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  // ── 팀 관리 ──
  const addTeam = async () => {
    if (!newTeamName.trim()) return;
    const res = await post('/api/teams', { name: newTeamName.trim(), division: newTeamDivision.trim() });
    if (res.ok) { setNewTeamName(''); setNewTeamDivision(''); fetchTeams(); } else alert((await res.json()).error);
  };
  /**
   * 팀별 실시간 공동 편집 켜기/끄기.
   * 적용 주차는 서버가 정한다 — 지난 주차를 임의로 바꾸면 확정된 취합본이 재생성 대상이 된다.
   */
  const toggleCollab = async (t: TeamInfo, next: boolean) => {
    const msg = next
      ? `"${t.name}" 팀을 실시간 공동 편집으로 전환하시겠습니까?\n\n이번 주차부터 팀원이 하나의 주간보고 문서를 함께 작성합니다.\n지난 주차는 그대로 유지됩니다.`
      : `"${t.name}" 팀의 실시간 공동 편집을 끄시겠습니까?\n\n이번 주차부터 기존처럼 개인별로 작성합니다.\n이미 함께 작성한 지난 주차는 그대로 유지됩니다.`;
    if (!confirm(msg)) return;
    const res = await post('/api/teams', { id: t.id, collab: next }, 'PATCH');
    if (res.ok) fetchTeams(); else alert((await res.json()).error);
  };

  const deleteTeam = async (id: number, name: string) => {
    if (!confirm(`"${name}" 팀을 삭제하시겠습니까? 모든 데이터가 삭제됩니다.`)) return;
    const res = await fetch(`/api/teams?id=${id}`, { method: 'DELETE' });
    if (res.ok) { if (selectedTeamId === id) setSelectedTeamId(null); fetchTeams(); } else alert((await res.json()).error);
  };

  // ── 팀원 관리 ──
  const addUser = async () => {
    if (!newUserName.trim() || !activeTeamId) return;
    const res = await post('/api/users', { name: newUserName.trim(), teamId: activeTeamId });
    if (res.ok) { setNewUserName(''); reload(); } else alert((await res.json()).error);
  };
  const addCrossUser = async () => {
    if (!crossUserId || !activeTeamId) return;
    const res = await post('/api/users', { targetUserId: parseInt(crossUserId, 10), teamId: activeTeamId, action: 'add' }, 'PUT');
    if (res.ok) { setCrossUserId(''); reload(); } else alert((await res.json()).error);
  };
  const removeCrossUser = async (targetId: number, name: string) => {
    if (!confirm(`${name}님의 이 팀 겸직을 해제하시겠습니까?`)) return;
    const res = await post('/api/users', { targetUserId: targetId, teamId: activeTeamId, action: 'remove' }, 'PUT');
    if (res.ok) reload(); else alert((await res.json()).error);
  };
  const changeRole = async (targetId: number, currentRole: string) => {
    const newRole = currentRole === 'teamMaster' ? 'user' : 'teamMaster';
    if (targetId === userId && currentRole !== 'user') { alert('본인의 권한은 해제할 수 없습니다.'); return; }
    if (!confirm(newRole === 'teamMaster' ? '관리자로 지정하시겠습니까?' : '일반 사용자로 변경하시겠습니까?')) return;
    await post('/api/users', { targetUserId: targetId, role: newRole }, 'PATCH');
    reload();
  };
  const toggleExecutive = async (targetId: number, currentRole: string) => {
    const newRole = currentRole === 'executive' ? 'user' : 'executive';
    if (targetId === userId) { alert('본인의 권한은 변경할 수 없습니다.'); return; }
    if (!confirm(newRole === 'executive'
      ? '임원으로 지정하시겠습니까?\n\n임원은 모든 팀의 전체 취합본을 조회만 할 수 있고, 작성·편집은 할 수 없습니다.'
      : '임원 권한을 해제하시겠습니까?')) return;
    const res = await post('/api/users', { targetUserId: targetId, role: newRole }, 'PATCH');
    if (!res.ok) { alert((await res.json()).error); return; }
    reload();
  };
  /** 직급 — 임원은 이 값이 곧 호칭이 된다 (대표·부사장 등) */
  const changePosition = async (targetId: number, name: string, current: string) => {
    const next = prompt(`${name}님의 직급을 입력하세요. (예: 대표, 팀장, 매니저)\n비워 두면 직급 표기를 지웁니다.`, current);
    if (next === null || next.trim() === current.trim()) return;
    const res = await post('/api/users', { targetUserId: targetId, position: next }, 'PATCH');
    if (!res.ok) { alert((await res.json()).error); return; }
    reload();
  };
  const resetPassword = async (targetId: number, name: string) => {
    if (!confirm(`${name}님의 비밀번호를 0000으로 초기화하시겠습니까?`)) return;
    await post('/api/users', { targetUserId: targetId, resetPassword: true }, 'PATCH');
    alert('초기화 완료');
  };
  const deleteUser = async (targetId: number, name: string) => {
    if (!confirm(`${name}님을 삭제하시겠습니까?`)) return;
    await fetch(`/api/users?id=${targetId}`, { method: 'DELETE' });
    reload();
  };

  // ── 파트 관리 ──
  const addPart = async () => {
    if (!newPartName.trim() || !activeTeamId) { alert('이름을 입력해주세요.'); return; }
    const res = await post('/api/parts', { name: newPartName.trim(), teamId: activeTeamId });
    if (res.ok) { setNewPartName(''); reload(); } else alert((await res.json()).error);
  };
  const togglePartActive = async (id: number, isActive: boolean) => {
    if (!confirm(isActive ? '파트를 다시 활성화하시겠습니까?' : '파트를 사용안함 처리하시겠습니까?')) return;
    await post('/api/parts', { id, isActive }, 'PATCH');
    reload();
  };
  const deletePart = async (id: number, name: string) => {
    if (!confirm(`"${name}" 파트를 삭제하시겠습니까?\n\n하위 대분류가 모두 비활성이어야 삭제할 수 있습니다.`)) return;
    const res = await fetch(`/api/parts?id=${id}`, { method: 'DELETE' });
    const d = await res.json();
    if (res.ok) { if (d.message) alert(d.message); reload(); } else alert(d.error);
  };
  const movePart = async (idx: number, dir: -1 | 1) => {
    const active = parts.filter(p => p.isActive);
    if (idx + dir < 0 || idx + dir >= active.length) return;
    const nl = [...parts];
    const a = nl.findIndex(p => p.id === active[idx].id);
    const b = nl.findIndex(p => p.id === active[idx + dir].id);
    [nl[a], nl[b]] = [nl[b], nl[a]];
    setParts(nl);
    await post('/api/parts', { partIds: nl.map(p => p.id), teamId: activeTeamId }, 'PUT');
  };

  // ── 대분류 관리 ──
  const addMajor = async () => {
    if (!newMajorName.trim() || !selectedPartId) { alert('파트를 선택하고 이름을 입력해주세요.'); return; }
    const res = await post('/api/majors', { name: newMajorName.trim(), partId: selectedPartId });
    if (res.ok) { setNewMajorName(''); reload(); } else alert((await res.json()).error);
  };
  const deleteMajor = async (id: number, name: string) => {
    if (!confirm(`"${name}" 대분류를 삭제하시겠습니까?\n\n사용 이력이 있으면 '사용안함' 처리됩니다.`)) return;
    const res = await fetch(`/api/majors?id=${id}`, { method: 'DELETE' });
    const d = await res.json();
    if (res.ok) { if (d.message) alert(d.message); reload(); } else alert(d.error);
  };
  const toggleMajorActive = async (id: number, isActive: boolean) => {
    if (!confirm(isActive ? '대분류를 다시 활성화하시겠습니까?' : '대분류를 사용안함 처리하시겠습니까?')) return;
    const res = await post('/api/majors', { id, isActive }, 'PATCH');
    if (!res.ok) { alert((await res.json()).error || '실패'); return; }
    reload();
  };
  const moveMajor = async (idx: number, dir: -1 | 1) => {
    const active = partMajors.filter(m => m.isActive);
    if (idx + dir < 0 || idx + dir >= active.length) return;
    const scoped = [...partMajors];
    const a = scoped.findIndex(m => m.id === active[idx].id);
    const b = scoped.findIndex(m => m.id === active[idx + dir].id);
    [scoped[a], scoped[b]] = [scoped[b], scoped[a]];
    const res = await post('/api/majors', { majorIds: scoped.map(m => m.id), partId: selectedPartId }, 'PUT');
    if (!res.ok) { alert((await res.json()).error || '순서 변경 실패'); return; }
    reload();
  };

  // ── 중분류 관리 ──
  const addCategory = async (major: string) => {
    const middle = newMiddle[major]?.trim();
    if (!middle || !selectedPartId) return;
    const res = await post('/api/categories', { major, middle, partId: selectedPartId });
    if (res.ok) { setNewMiddle(prev => ({ ...prev, [major]: '' })); reload(); } else alert((await res.json()).error || '실패');
  };
  const deleteCategory = async (catId: number, name: string) => {
    if (!confirm(`"${name}" 중분류를 삭제하시겠습니까?\n\n작성 이력이 있으면 '사용안함' 처리됩니다.`)) return;
    const res = await fetch(`/api/categories?id=${catId}`, { method: 'DELETE' });
    const d = await res.json();
    if (res.ok) { if (d.message) alert(d.message); reload(); } else alert(d.error || '삭제 실패');
  };
  const toggleCategoryActive = async (catId: number, isActive: boolean) => {
    // 비활성화하면 overview·PDF·작성화면에서 그 중분류 내용이 즉시 사라진다 — 되돌릴 수 있음을 알린다.
    if (!confirm(isActive
      ? '중분류를 다시 활성화하시겠습니까?'
      : '중분류를 사용안함 처리하시겠습니까?\n\n작성된 내용이 전체 취합본·작성 화면에서 보이지 않게 됩니다. (복원 가능)')) return;
    const res = await post('/api/categories', { id: catId, isActive }, 'PATCH');
    if (!res.ok) { alert((await res.json()).error || '실패'); return; }
    reload();
  };
  const moveCategory = async (major: string, idx: number, dir: -1 | 1) => {
    const active = partCategories.filter(c => c.major === major && c.isActive);
    if (idx + dir < 0 || idx + dir >= active.length) return;
    const scoped = [...partCategories];
    const a = scoped.findIndex(c => c.id === active[idx].id);
    const b = scoped.findIndex(c => c.id === active[idx + dir].id);
    [scoped[a], scoped[b]] = [scoped[b], scoped[a]];
    const res = await post('/api/categories', { categoryIds: scoped.map(c => c.id), partId: selectedPartId }, 'PUT');
    if (!res.ok) { alert((await res.json()).error || '순서 변경 실패'); return; }
    reload();
  };

  if (loading) return <div className="glass-panel" style={{ padding: '3rem', margin: '2rem auto', maxWidth: '1000px', textAlign: 'center' }}>로딩중...</div>;

  const sectionSuffix = (extra?: string) => (
    <span style={{ fontSize: '0.85rem', color: 'var(--primary)', fontWeight: 500 }}>
      {isSuperAdmin && ` — ${activeTeamName}`}{extra}
    </span>
  );

  // 아직 이 팀에 속하지 않은 인원 (겸직 후보)
  const crossCandidates = allUsers.filter(u => !users.some(m => m.id === u.id));

  return (
    <div style={{ maxWidth: '1000px', margin: '2rem auto', display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ fontSize: '1.5rem', margin: 0 }}>설정</h2>
        <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>모든 변경은 즉시 저장됩니다.</span>
      </div>

      {/* superAdmin: 팀 선택 */}
      {isSuperAdmin && teams.length > 0 && (
        <div className="glass-panel" style={{ padding: '1rem 2rem', display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 700, fontSize: '0.95rem' }}>관리 대상 팀:</span>
          <select value={selectedTeamId || ''} onChange={e => setSelectedTeamId(parseInt(e.target.value))}
            className="input-field" style={{ padding: '0.4rem 0.8rem', fontSize: '0.95rem', fontWeight: 600, minWidth: '200px' }}>
            {teams.map(t => <option key={t.id} value={t.id}>{t.division ? `[${t.division}] ` : ''}{t.name} ({t._count?.users ?? 0}명)</option>)}
          </select>
          <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>아래 관리 항목은 선택된 팀 기준입니다.</span>
        </div>
      )}

      {/* 팀 관리 (superAdmin만) */}
      {isSuperAdmin && (
        <div className="glass-panel" style={{ padding: '2rem' }}>
          <h3 style={{ fontSize: '1.2rem', marginBottom: '1rem', borderBottom: '2px solid var(--border)', paddingBottom: '0.5rem' }}>팀 관리</h3>
          {teams.map(t => (
            <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: '0.8rem', padding: '0.5rem 0.8rem', borderBottom: '1px solid var(--border)' }}>
              {t.division && (
                <span style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--text-muted)', background: 'var(--surface-dim)', border: '1px solid var(--border)', borderRadius: '3px', padding: '0.1rem 0.4rem', flexShrink: 0 }}>{t.division}</span>
              )}
              <span style={{ flex: 1, fontWeight: 700, color: selectedTeamId === t.id ? 'var(--primary)' : 'var(--foreground)' }}>
                {t.name}
                <span style={{ fontWeight: 400, fontSize: '0.85rem', color: 'var(--text-muted)' }}> ({t._count?.users ?? 0}명 · 파트 {t._count?.parts ?? 0})</span>
              </span>
              {(() => {
                const on = isCollabOn(t);
                return (
                  <label
                    title={
                      !on && !COLLAB_WRITE_READY
                        ? '주간보고 작성 화면이 공동 편집으로 바뀐 뒤에 켤 수 있습니다.'
                        : on
                          ? '팀원이 하나의 주간보고 문서를 함께 작성합니다.'
                          : '팀원이 각자 작성하고 팀장이 취합합니다.'
                    }
                    style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', cursor: 'pointer', flexShrink: 0 }}
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      disabled={!on && !COLLAB_WRITE_READY}
                      onChange={e => toggleCollab(t, e.target.checked)}
                    />
                    <span style={{ fontSize: '0.78rem', color: on ? 'var(--primary)' : 'var(--text-muted)', fontWeight: on ? 700 : 400 }}>
                      함께 작성
                    </span>
                  </label>
                );
              })()}
              <button onClick={() => deleteTeam(t.id, t.name)} className="icon-btn del" style={{ fontSize: '0.85rem' }}>✕</button>
            </div>
          ))}
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.8rem' }}>
            <input type="text" value={newTeamDivision} onChange={e => setNewTeamDivision(e.target.value)} placeholder="구분 (예: Pharos)" className="input-field" style={{ width: '150px', padding: '0.4rem 0.6rem' }} />
            <input type="text" value={newTeamName} onChange={e => setNewTeamName(e.target.value)} onKeyDown={e => e.key === 'Enter' && addTeam()} placeholder="새 팀 이름" className="input-field" style={{ flex: 1, padding: '0.4rem 0.6rem' }} />
            <button onClick={addTeam} className="btn" style={{ fontSize: '0.8rem', padding: '0.3rem 0.8rem', background: 'var(--primary)', color: 'white' }}>팀 추가</button>
          </div>
        </div>
      )}

      {/* 팀원 관리 (마스터 이상) */}
      {activeTeamId && isMasterOrAbove && (
        <div className="glass-panel" style={{ padding: '2rem' }}>
          <h3 style={{ fontSize: '1.2rem', marginBottom: '1rem', borderBottom: '2px solid var(--border)', paddingBottom: '0.5rem' }}>
            팀원 관리 {sectionSuffix()}
          </h3>
          {users.map(user => (
            <div key={user.id} className="settings-row" style={{ display: 'flex', alignItems: 'center', gap: '0.8rem', padding: '0.6rem 0.8rem', borderBottom: '1px solid var(--border)' }}>
              <span style={{ flex: 1, fontWeight: 600 }}>
                {user.name}
                {/* 임원은 직급이 배지로 나가므로 여기서 또 쓰지 않는다 */}
                {user.position && user.role !== 'executive' && <span style={{ fontWeight: 400, fontSize: '0.75rem', color: 'var(--text-muted)', marginLeft: '0.4rem' }}>{user.position}</span>}
                {user.isPrimary === false && <span style={{ background: 'var(--surface-dim)', color: 'var(--text-muted)', border: '1px solid var(--border)', padding: '0.05rem 0.3rem', borderRadius: '3px', fontSize: '0.6rem', marginLeft: '0.5rem', fontWeight: 600 }}>겸직</span>}
                {user.role === 'superAdmin' && <span style={{ background: '#dc2626', color: 'white', padding: '0.05rem 0.3rem', borderRadius: '3px', fontSize: '0.6rem', marginLeft: '0.5rem' }}>최고관리자</span>}
                {user.role === 'teamMaster' && <span style={{ background: 'var(--primary)', color: 'white', padding: '0.05rem 0.3rem', borderRadius: '3px', fontSize: '0.6rem', marginLeft: '0.5rem' }}>관리자</span>}
                {user.role === 'executive' && <span style={{ background: '#7c3aed', color: 'white', padding: '0.05rem 0.3rem', borderRadius: '3px', fontSize: '0.6rem', marginLeft: '0.5rem' }}>{roleLabel('executive', user.position)}</span>}
              </span>
              {user.isPrimary === false ? (
                <button onClick={() => removeCrossUser(user.id, user.name)} className="btn" style={{ fontSize: '0.75rem', padding: '0.25rem 0.6rem', color: '#f59e0b', borderColor: '#f59e0b' }}>겸직 해제</button>
              ) : (
                <>
                  {user.role !== 'superAdmin' && user.role !== 'executive' && (
                    <button onClick={() => changeRole(user.id, user.role)} className="btn" style={{ fontSize: '0.75rem', padding: '0.25rem 0.6rem', color: user.role === 'teamMaster' ? '#ef4444' : 'var(--primary)', borderColor: user.role === 'teamMaster' ? '#ef4444' : 'var(--primary)' }}
                      disabled={user.id === userId && user.role === 'teamMaster'}>
                      {user.role === 'teamMaster' ? '관리자 해제' : '관리자 지정'}
                    </button>
                  )}
                  {isSuperAdmin && user.role !== 'superAdmin' && user.id !== userId && (
                    <button onClick={() => toggleExecutive(user.id, user.role)} className="btn" style={{ fontSize: '0.75rem', padding: '0.25rem 0.6rem', color: '#7c3aed', borderColor: '#7c3aed' }}>
                      {user.role === 'executive' ? '임원 해제' : '임원 지정'}
                    </button>
                  )}
                  <button onClick={() => changePosition(user.id, user.name, user.position ?? '')} className="btn" style={{ fontSize: '0.75rem', padding: '0.25rem 0.6rem' }} title="직급 변경 (임원은 이 값이 호칭이 됩니다)">직급</button>
                  <button onClick={() => resetPassword(user.id, user.name)} className="btn" style={{ fontSize: '0.75rem', padding: '0.25rem 0.6rem' }}>PW초기화</button>
                  {user.role !== 'superAdmin' && <button onClick={() => deleteUser(user.id, user.name)} className="icon-btn del" style={{ fontSize: '0.85rem' }} disabled={user.id === userId}>✕</button>}
                </>
              )}
            </div>
          ))}
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.8rem' }}>
            <input type="text" value={newUserName} onChange={e => setNewUserName(e.target.value)} onKeyDown={e => e.key === 'Enter' && addUser()} placeholder="새 팀원 이름" className="input-field" style={{ flex: 1, padding: '0.4rem 0.6rem' }} />
            <button onClick={addUser} className="btn" style={{ fontSize: '0.8rem', padding: '0.3rem 0.8rem', background: 'var(--primary)', color: 'white' }}>팀원 추가</button>
          </div>
          {isSuperAdmin && crossCandidates.length > 0 && (
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem', alignItems: 'center' }}>
              <select value={crossUserId} onChange={e => setCrossUserId(e.target.value)} className="input-field" style={{ flex: 1, padding: '0.4rem 0.6rem', fontSize: '0.85rem' }}>
                <option value="">겸직으로 추가할 다른 팀 인원 선택...</option>
                {crossCandidates.map(u => (
                  <option key={u.id} value={u.id}>{u.name} ({teams.find(t => t.id === u.teamId)?.name ?? '-'})</option>
                ))}
              </select>
              <button onClick={addCrossUser} disabled={!crossUserId} className="btn" style={{ fontSize: '0.8rem', padding: '0.3rem 0.8rem' }}>겸직 추가</button>
            </div>
          )}
        </div>
      )}

      {/* 파트 — 마스터는 관리, 일반 팀원은 대분류를 볼 파트를 고르는 선택기로만 쓴다 */}
      {activeTeamId && (
        <div className="glass-panel" style={{ padding: '2rem' }}>
          <h3 style={{ fontSize: '1.2rem', marginBottom: '1rem', borderBottom: '2px solid var(--border)', paddingBottom: '0.5rem' }}>
            {isMasterOrAbove ? '파트 관리' : '파트 선택'} {sectionSuffix()}
          </h3>
          <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: '0.8rem' }}>
            {isMasterOrAbove
              ? '파트는 대분류 위 단계입니다. 문서의 "분류1" 컬럼에 해당합니다. 파트를 선택하면 아래 대분류·중분류가 해당 파트 기준으로 표시됩니다.'
              : '파트를 선택하면 아래 대분류·중분류가 해당 파트 기준으로 표시됩니다. 파트 추가·수정은 관리자에게 요청해주세요.'}
          </p>
          {parts.filter(p => p.isActive).map((p, idx) => (
            <div key={p.id} className="settings-row"
              style={{
                display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 0.8rem',
                borderBottom: '1px solid var(--border)',
                background: selectedPartId === p.id ? 'var(--surface-dim)' : undefined,
                borderLeft: selectedPartId === p.id ? '3px solid var(--primary)' : '3px solid transparent'
              }}>
              <button onClick={() => setSelectedPartId(p.id)}
                style={{ flex: 1, textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: '0.95rem', color: selectedPartId === p.id ? 'var(--primary)' : 'var(--foreground)', padding: 0 }}>
                {p.name}
                <span style={{ fontWeight: 400, fontSize: '0.78rem', color: 'var(--text-muted)', marginLeft: '0.5rem' }}>
                  대분류 {majors.filter(m => m.partId === p.id && m.isActive).length} · 중분류 {categories.filter(c => c.partId === p.id && c.isActive).length}
                </span>
              </button>
              {isMasterOrAbove && <>
                <button onClick={() => movePart(idx, -1)} className="btn" style={{ padding: '0.15rem 0.4rem', fontSize: '0.7rem' }} disabled={idx === 0}>▲</button>
                <button onClick={() => movePart(idx, 1)} className="btn" style={{ padding: '0.15rem 0.4rem', fontSize: '0.7rem' }} disabled={idx === parts.filter(x => x.isActive).length - 1}>▼</button>
                <button onClick={() => togglePartActive(p.id, false)} className="btn" style={{ fontSize: '0.7rem', padding: '0.15rem 0.5rem', color: '#f59e0b', borderColor: '#f59e0b' }}>사용안함</button>
                <button onClick={() => deletePart(p.id, p.name)} className="icon-btn del" style={{ fontSize: '0.8rem' }}>✕</button>
              </>}
            </div>
          ))}
          {isMasterOrAbove && parts.filter(p => !p.isActive).length > 0 && (
            <div style={{ marginTop: '0.8rem', padding: '0.6rem 0.8rem', background: 'var(--surface-dim)', borderRadius: '6px' }}>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.4rem', fontWeight: 600 }}>사용안함 처리된 파트</div>
              {parts.filter(p => !p.isActive).map(p => (
                <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.3rem 0', opacity: 0.6 }}>
                  <span style={{ flex: 1, fontWeight: 500, textDecoration: 'line-through', color: 'var(--text-muted)' }}>{p.name}</span>
                  <button onClick={() => togglePartActive(p.id, true)} className="btn" style={{ fontSize: '0.7rem', padding: '0.15rem 0.5rem', color: '#22c55e', borderColor: '#22c55e' }}>복원</button>
                </div>
              ))}
            </div>
          )}
          {isMasterOrAbove && (
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.8rem' }}>
              <input type="text" value={newPartName} onChange={e => setNewPartName(e.target.value)} onKeyDown={e => e.key === 'Enter' && addPart()} placeholder="새 파트 이름 (예: 내부, 핀테크)" className="input-field" style={{ flex: 1, padding: '0.4rem 0.6rem' }} />
              <button onClick={addPart} className="btn" style={{ fontSize: '0.8rem', padding: '0.3rem 0.8rem', background: 'var(--primary)', color: 'white' }}>파트 추가</button>
            </div>
          )}
        </div>
      )}

      {/* 대분류 관리 */}
      {activeTeamId && selectedPartId && (
        <div className="glass-panel" style={{ padding: '2rem' }}>
          <h3 style={{ fontSize: '1.2rem', marginBottom: '1rem', borderBottom: '2px solid var(--border)', paddingBottom: '0.5rem' }}>
            대분류 관리 {sectionSuffix(` / 파트: ${selectedPart?.name ?? ''}`)}
          </h3>
          {!isMasterOrAbove && (
            <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: '0.8rem' }}>
              대분류·중분류는 팀원 누구나 추가·수정·삭제할 수 있습니다. 하위 중분류가 남아 있는 대분류는 먼저 중분류를 정리해야 합니다.
            </p>
          )}
          {partMajors.filter(m => m.isActive).map((m, idx) => (
            <div key={m.id} className="settings-row" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 0.8rem', borderBottom: '1px solid var(--border)' }}>
              <span style={{ flex: 1, fontWeight: 700, color: 'var(--primary)' }}>{m.name}</span>
              <button onClick={() => moveMajor(idx, -1)} className="btn" style={{ padding: '0.15rem 0.4rem', fontSize: '0.7rem' }} disabled={idx === 0}>▲</button>
              <button onClick={() => moveMajor(idx, 1)} className="btn" style={{ padding: '0.15rem 0.4rem', fontSize: '0.7rem' }} disabled={idx === partMajors.filter(x => x.isActive).length - 1}>▼</button>
              <button onClick={() => toggleMajorActive(m.id, false)} className="btn" style={{ fontSize: '0.7rem', padding: '0.15rem 0.5rem', color: '#f59e0b', borderColor: '#f59e0b' }}>사용안함</button>
              <button onClick={() => deleteMajor(m.id, m.name)} className="icon-btn del" style={{ fontSize: '0.8rem' }}>✕</button>
            </div>
          ))}
          {partMajors.filter(m => !m.isActive).length > 0 && (
            <div style={{ marginTop: '0.8rem', padding: '0.6rem 0.8rem', background: 'var(--surface-dim)', borderRadius: '6px' }}>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.4rem', fontWeight: 600 }}>사용안함 처리된 대분류</div>
              {partMajors.filter(m => !m.isActive).map(m => (
                <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.3rem 0', opacity: 0.6 }}>
                  <span style={{ flex: 1, fontWeight: 500, textDecoration: 'line-through', color: 'var(--text-muted)' }}>{m.name}</span>
                  <button onClick={() => toggleMajorActive(m.id, true)} className="btn" style={{ fontSize: '0.7rem', padding: '0.15rem 0.5rem', color: '#22c55e', borderColor: '#22c55e' }}>복원</button>
                </div>
              ))}
            </div>
          )}
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.8rem' }}>
            <input type="text" value={newMajorName} onChange={e => setNewMajorName(e.target.value)} onKeyDown={e => e.key === 'Enter' && addMajor()} placeholder="새 대분류 이름" className="input-field" style={{ flex: 1, padding: '0.4rem 0.6rem' }} />
            <button onClick={addMajor} className="btn" style={{ fontSize: '0.8rem', padding: '0.3rem 0.8rem', background: 'var(--primary)', color: 'white' }}>추가</button>
          </div>
        </div>
      )}

      {/* 중분류 관리 — 대분류와 함께 팀원 전체에 개방 */}
      {activeTeamId && selectedPartId && (
        <div className="glass-panel" style={{ padding: '2rem' }}>
          <h3 style={{ fontSize: '1.2rem', marginBottom: '1rem', borderBottom: '2px solid var(--border)', paddingBottom: '0.5rem' }}>
            중분류 관리 {sectionSuffix(` / 파트: ${selectedPart?.name ?? ''}`)}
          </h3>
          {partMajors.length === 0 && <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>대분류를 먼저 추가해주세요.</p>}
          {partMajors.filter(m => m.isActive).map(major => {
            const activeCats = partCategories.filter(c => c.major === major.name && c.isActive);
            const inactiveCats = partCategories.filter(c => c.major === major.name && !c.isActive);
            return (
              <div key={major.id} style={{ marginBottom: '1.5rem' }}>
                <h4 style={{ color: 'var(--primary)', marginBottom: '0.5rem', fontWeight: 700 }}>{major.name}</h4>
                {activeCats.map((cat, idx) => (
                  <div key={cat.id} className="settings-row" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.4rem 0.8rem', borderBottom: '1px dashed var(--border)' }}>
                    <span style={{ fontWeight: 500, flex: 1 }}>({idx + 1}) {cat.middle}</span>
                    <button onClick={() => moveCategory(major.name, idx, -1)} className="btn" style={{ padding: '0.1rem 0.3rem', fontSize: '0.7rem' }} disabled={idx === 0}>▲</button>
                    <button onClick={() => moveCategory(major.name, idx, 1)} className="btn" style={{ padding: '0.1rem 0.3rem', fontSize: '0.7rem' }} disabled={idx === activeCats.length - 1}>▼</button>
                    <button onClick={() => toggleCategoryActive(cat.id, false)} className="btn" style={{ fontSize: '0.65rem', padding: '0.1rem 0.4rem', color: '#f59e0b', borderColor: '#f59e0b' }}>사용안함</button>
                    <button onClick={() => deleteCategory(cat.id, cat.middle)} className="icon-btn del" style={{ fontSize: '0.8rem' }}>✕</button>
                  </div>
                ))}
                {inactiveCats.length > 0 && (
                  <div style={{ marginTop: '0.4rem', padding: '0.4rem 0.8rem', background: 'var(--surface-dim)', borderRadius: '4px' }}>
                    {inactiveCats.map(cat => (
                      <div key={cat.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.2rem 0', opacity: 0.6 }}>
                        <span style={{ flex: 1, fontWeight: 400, textDecoration: 'line-through', color: 'var(--text-muted)', fontSize: '0.85rem' }}>{cat.middle} (사용안함)</span>
                        <button onClick={() => toggleCategoryActive(cat.id, true)} className="btn" style={{ fontSize: '0.65rem', padding: '0.1rem 0.4rem', color: '#22c55e', borderColor: '#22c55e' }}>복원</button>
                      </div>
                    ))}
                  </div>
                )}
                <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                  <input type="text" value={newMiddle[major.name] || ''} onChange={e => setNewMiddle(prev => ({ ...prev, [major.name]: e.target.value }))} onKeyDown={e => e.key === 'Enter' && addCategory(major.name)} placeholder={`${major.name} 중분류 이름`} className="input-field" style={{ flex: 1, padding: '0.4rem 0.6rem', fontSize: '0.85rem' }} />
                  <button onClick={() => addCategory(major.name)} className="btn" style={{ fontSize: '0.8rem', padding: '0.3rem 0.8rem', background: 'var(--primary)', color: 'white' }}>추가</button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
