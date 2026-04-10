'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useUser } from '@/lib/UserContext';

interface TeamInfo { id: number; name: string; _count?: { users: number }; }
interface UserInfo { id: number; name: string; role: string; teamId: number; }
interface MajorInfo { id: number; name: string; orderIdx: number; teamId: number; isActive: boolean; }
interface CategoryInfo { id: number; major: string; middle: string; orderIdx: number; teamId: number; isActive: boolean; }

export default function SettingsPage() {
  const { userId, teamId: myTeamId, isMasterOrAbove, isSuperAdmin } = useUser();
  const router = useRouter();

  // superAdmin은 팀을 선택할 수 있음, teamMaster는 본인팀 고정
  const [selectedTeamId, setSelectedTeamId] = useState<number | null>(null);
  const [teams, setTeams] = useState<TeamInfo[]>([]);
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [majors, setMajors] = useState<MajorInfo[]>([]);
  const [categories, setCategories] = useState<CategoryInfo[]>([]);

  const [newTeamName, setNewTeamName] = useState('');
  const [newUserName, setNewUserName] = useState('');
  const [newMajorName, setNewMajorName] = useState('');
  const [newMiddle, setNewMiddle] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [hasChanges, setHasChanges] = useState(false);

  const activeTeamId = isSuperAdmin ? selectedTeamId : myTeamId;
  const activeTeamName = teams.find(t => t.id === activeTeamId)?.name || '';

  useEffect(() => {
    if (!isMasterOrAbove) { router.push('/'); return; }
    fetchTeams();
  }, [isMasterOrAbove]);

  useEffect(() => {
    if (activeTeamId) fetchTeamData(activeTeamId);
  }, [activeTeamId]);

  const fetchTeams = async () => {
    setLoading(true);
    try {
      if (isSuperAdmin) {
        const res = await fetch('/api/teams');
        const data = await res.json();
        const t = Array.isArray(data) ? data : [];
        setTeams(t);
        if (!selectedTeamId && t.length > 0) setSelectedTeamId(t[0].id);
      } else {
        setTeams([]);
        setSelectedTeamId(myTeamId);
      }
    } catch { }
    finally { setLoading(false); }
  };

  const fetchTeamData = async (tid: number) => {
    try {
      const [uRes, mRes, cRes] = await Promise.all([
        fetch(`/api/users?teamId=${tid}`),
        fetch(`/api/majors?teamId=${tid}&includeInactive=true`),
        fetch(`/api/categories?teamId=${tid}&includeInactive=true`)
      ]);
      setUsers(await uRes.json());
      setMajors(await mRes.json());
      setCategories(await cRes.json());
      setHasChanges(false);
    } catch { }
  };

  const markChanged = () => setHasChanges(true);

  const handleSaveAll = () => {
    alert('모든 변경사항이 실시간으로 저장되었습니다.');
    setHasChanges(false);
  };

  // ── 팀 관리 ──
  const addTeam = async () => {
    if (!newTeamName.trim()) return;
    const res = await fetch('/api/teams', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: newTeamName.trim(), requestUserId: userId }) });
    if (res.ok) { setNewTeamName(''); fetchTeams(); markChanged(); } else { const d = await res.json(); alert(d.error); }
  };
  const deleteTeam = async (id: number, name: string) => {
    if (!confirm(`"${name}" 팀을 삭제하시겠습니까? 모든 데이터가 삭제됩니다.`)) return;
    const res = await fetch(`/api/teams?id=${id}&requestUserId=${userId}`, { method: 'DELETE' });
    if (res.ok) { fetchTeams(); if (selectedTeamId === id) setSelectedTeamId(null); markChanged(); } else { const d = await res.json(); alert(d.error); }
  };

  // ── 유저 관리 ──
  const addUser = async () => {
    if (!newUserName.trim() || !activeTeamId) return;
    const res = await fetch('/api/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: newUserName.trim(), teamId: activeTeamId, requestUserId: userId }) });
    if (res.ok) { setNewUserName(''); fetchTeamData(activeTeamId); markChanged(); } else { const d = await res.json(); alert(d.error); }
  };
  const changeRole = async (targetId: number, currentRole: string) => {
    const newRole = currentRole === 'teamMaster' ? 'user' : 'teamMaster';
    if (targetId === userId && currentRole !== 'user') { alert('본인의 권한은 해제할 수 없습니다.'); return; }
    if (!confirm(newRole === 'teamMaster' ? '관리자로 지정하시겠습니까?' : '일반 사용자로 변경하시겠습니까?')) return;
    await fetch('/api/users', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ targetUserId: targetId, role: newRole, requestUserId: userId }) });
    if (activeTeamId) fetchTeamData(activeTeamId);
    markChanged();
  };
  const resetPassword = async (targetId: number, name: string) => {
    if (!confirm(`${name}님의 비밀번호를 0000으로 초기화하시겠습니까?`)) return;
    await fetch('/api/users', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ targetUserId: targetId, resetPassword: true, requestUserId: userId }) });
    alert('초기화 완료');
  };
  const deleteUser = async (targetId: number, name: string) => {
    if (!confirm(`${name}님을 삭제하시겠습니까?`)) return;
    await fetch(`/api/users?id=${targetId}&requestUserId=${userId}`, { method: 'DELETE' });
    if (activeTeamId) fetchTeamData(activeTeamId);
    markChanged();
  };

  // ── 대분류 관리 ──
  const addMajor = async () => {
    const tid = activeTeamId;
    if (!newMajorName.trim() || !tid) { alert('이름을 입력해주세요.'); return; }
    const res = await fetch('/api/majors', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: newMajorName.trim(), teamId: tid, requestUserId: userId }) });
    if (res.ok) { setNewMajorName(''); if (activeTeamId) fetchTeamData(activeTeamId); markChanged(); } else { const d = await res.json(); alert(d.error); }
  };
  const deleteMajor = async (id: number, name: string) => {
    if (!confirm(`"${name}" 대분류를 삭제하시겠습니까?\n\n사용 이력이 있으면 '사용안함' 처리됩니다.`)) return;
    const res = await fetch(`/api/majors?id=${id}&requestUserId=${userId}`, { method: 'DELETE' });
    const d = await res.json();
    if (res.ok) { if (d.message) alert(d.message); if (activeTeamId) fetchTeamData(activeTeamId); markChanged(); }
    else alert(d.error);
  };
  const toggleMajorActive = async (id: number, isActive: boolean) => {
    if (!confirm(isActive ? '대분류를 다시 활성화하시겠습니까?' : '대분류를 사용안함 처리하시겠습니까?')) return;
    await fetch('/api/majors', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, isActive, requestUserId: userId }) });
    if (activeTeamId) fetchTeamData(activeTeamId);
    markChanged();
  };
  const moveMajor = async (idx: number, dir: -1 | 1) => {
    const activeMajors = majors.filter(m => m.isActive);
    if (idx + dir < 0 || idx + dir >= activeMajors.length) return;
    const nl = [...majors];
    const aGlob = nl.findIndex(m => m.id === activeMajors[idx].id);
    const bGlob = nl.findIndex(m => m.id === activeMajors[idx + dir].id);
    [nl[aGlob], nl[bGlob]] = [nl[bGlob], nl[aGlob]]; setMajors(nl);
    await fetch('/api/majors', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ majorIds: nl.map(m => m.id), teamId: activeTeamId, requestUserId: userId }) });
    markChanged();
  };

  // ── 중분류 관리 ──
  const addCategory = async (major: string) => {
    const middle = newMiddle[major]?.trim();
    if (!middle || !activeTeamId) return;
    const res = await fetch('/api/categories', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ major, middle, teamId: activeTeamId, requestUserId: userId }) });
    if (res.ok) { setNewMiddle(prev => ({ ...prev, [major]: '' })); fetchTeamData(activeTeamId); markChanged(); } else { const d = await res.json(); alert(d.error || '실패'); }
  };
  const deleteCategory = async (catId: number, name: string) => {
    if (!confirm(`"${name}" 중분류를 삭제하시겠습니까?\n\n최근 4주간 사용 이력이 있으면 '사용안함' 처리됩니다.`)) return;
    const res = await fetch(`/api/categories?id=${catId}&requestUserId=${userId}`, { method: 'DELETE' });
    const d = await res.json();
    if (res.ok) { if (d.message) alert(d.message); if (activeTeamId) fetchTeamData(activeTeamId); markChanged(); }
    else alert(d.error || '삭제 실패');
  };
  const toggleCategoryActive = async (catId: number, isActive: boolean) => {
    if (!confirm(isActive ? '중분류를 다시 활성화하시겠습니까?' : '중분류를 사용안함 처리하시겠습니까?')) return;
    await fetch('/api/categories', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: catId, isActive, requestUserId: userId }) });
    if (activeTeamId) fetchTeamData(activeTeamId);
    markChanged();
  };
  const moveCategory = async (major: string, idx: number, dir: -1 | 1) => {
    const activeCats = categories.filter(c => c.major === major && c.isActive);
    if (idx + dir < 0 || idx + dir >= activeCats.length) return;
    const all = [...categories];
    const a = activeCats[idx]; const b = activeCats[idx + dir];
    const ai = all.findIndex(c => c.id === a.id); const bi = all.findIndex(c => c.id === b.id);
    all[ai] = b; all[bi] = a; setCategories(all);
    fetch('/api/categories', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ categoryIds: all.map(c => c.id), teamId: activeTeamId, requestUserId: userId }) });
    markChanged();
  };

  if (loading) return <div className="glass-panel" style={{ padding: '3rem', margin: '2rem auto', maxWidth: '1000px', textAlign: 'center' }}>로딩중...</div>;

  return (
    <div style={{ maxWidth: '1000px', margin: '2rem auto', display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      {/* 헤더 + 저장 버튼 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ fontSize: '1.5rem', margin: 0 }}>설정</h2>
        <button onClick={handleSaveAll} className="btn btn-primary" style={{ padding: '0.5rem 2rem', fontSize: '1rem', opacity: hasChanges ? 1 : 0.5 }}>
          {hasChanges ? '✓ 변경사항 확인' : '변경 없음'}
        </button>
      </div>

      {/* superAdmin: 팀 선택 드롭다운 */}
      {isSuperAdmin && teams.length > 0 && (
        <div className="glass-panel" style={{ padding: '1rem 2rem', display: 'flex', alignItems: 'center', gap: '1rem', background: 'var(--primary-alpha-subtle)' }}>
          <span style={{ fontWeight: 700, fontSize: '0.95rem' }}>관리 대상 팀:</span>
          <select value={selectedTeamId || ''} onChange={e => setSelectedTeamId(parseInt(e.target.value))}
            className="input-field" style={{ padding: '0.4rem 0.8rem', fontSize: '0.95rem', fontWeight: 600, minWidth: '150px' }}>
            {teams.map(t => <option key={t.id} value={t.id}>{t.name} ({t._count?.users ?? 0}명)</option>)}
          </select>
          <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>아래 유저/대분류/중분류 관리는 선택된 팀 기준입니다.</span>
        </div>
      )}

      {/* 팀 관리 (superAdmin만) */}
      {isSuperAdmin && (
        <div className="glass-panel" style={{ padding: '2rem' }}>
          <h3 style={{ fontSize: '1.2rem', marginBottom: '1rem', borderBottom: '2px solid var(--border)', paddingBottom: '0.5rem' }}>팀 관리</h3>
          {teams.map(t => (
            <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: '0.8rem', padding: '0.5rem 0.8rem', borderBottom: '1px solid var(--border)' }}>
              <span style={{ flex: 1, fontWeight: 700, color: selectedTeamId === t.id ? 'var(--primary)' : 'var(--foreground)' }}>
                {t.name} <span style={{ fontWeight: 400, fontSize: '0.85rem', color: 'var(--text-muted)' }}>({t._count?.users ?? 0}명)</span>
              </span>
              <button onClick={() => deleteTeam(t.id, t.name)} className="icon-btn del" style={{ fontSize: '0.85rem' }}>✕</button>
            </div>
          ))}
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.8rem' }}>
            <input type="text" value={newTeamName} onChange={e => setNewTeamName(e.target.value)} onKeyDown={e => e.key === 'Enter' && addTeam()} placeholder="새 팀 이름" className="input-field" style={{ flex: 1, padding: '0.4rem 0.6rem' }} />
            <button onClick={addTeam} className="btn" style={{ fontSize: '0.8rem', padding: '0.3rem 0.8rem', background: 'var(--primary)', color: 'white' }}>팀 추가</button>
          </div>
        </div>
      )}

      {/* 팀원 관리 */}
      {activeTeamId && (
        <div className="glass-panel" style={{ padding: '2rem' }}>
          <h3 style={{ fontSize: '1.2rem', marginBottom: '1rem', borderBottom: '2px solid var(--border)', paddingBottom: '0.5rem' }}>
            팀원 관리 {isSuperAdmin && <span style={{ fontSize: '0.85rem', color: 'var(--primary)', fontWeight: 500 }}>— {activeTeamName}</span>}
          </h3>
          {users.map(user => (
            <div key={user.id} className="settings-row" style={{ display: 'flex', alignItems: 'center', gap: '0.8rem', padding: '0.6rem 0.8rem', borderBottom: '1px solid var(--border)' }}>
              <span style={{ flex: 1, fontWeight: 600 }}>
                {user.name}
                {user.role === 'superAdmin' && <span style={{ background: '#dc2626', color: 'white', padding: '0.05rem 0.3rem', borderRadius: '3px', fontSize: '0.6rem', marginLeft: '0.5rem' }}>최고관리자</span>}
                {user.role === 'teamMaster' && <span style={{ background: 'var(--primary)', color: 'white', padding: '0.05rem 0.3rem', borderRadius: '3px', fontSize: '0.6rem', marginLeft: '0.5rem' }}>관리자</span>}
              </span>
              {user.role !== 'superAdmin' && (
                <button onClick={() => changeRole(user.id, user.role)} className="btn" style={{ fontSize: '0.75rem', padding: '0.25rem 0.6rem', color: user.role === 'teamMaster' ? '#ef4444' : 'var(--primary)', borderColor: user.role === 'teamMaster' ? '#ef4444' : 'var(--primary)' }}
                  disabled={user.id === userId && user.role === 'teamMaster'}>
                  {user.role === 'teamMaster' ? '관리자 해제' : '관리자 지정'}
                </button>
              )}
              <button onClick={() => resetPassword(user.id, user.name)} className="btn" style={{ fontSize: '0.75rem', padding: '0.25rem 0.6rem' }}>PW초기화</button>
              {user.role !== 'superAdmin' && <button onClick={() => deleteUser(user.id, user.name)} className="icon-btn del" style={{ fontSize: '0.85rem' }} disabled={user.id === userId}>✕</button>}
            </div>
          ))}
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.8rem' }}>
            <input type="text" value={newUserName} onChange={e => setNewUserName(e.target.value)} onKeyDown={e => e.key === 'Enter' && addUser()} placeholder="새 팀원 이름" className="input-field" style={{ flex: 1, padding: '0.4rem 0.6rem' }} />
            <button onClick={addUser} className="btn" style={{ fontSize: '0.8rem', padding: '0.3rem 0.8rem', background: 'var(--primary)', color: 'white' }}>팀원 추가</button>
          </div>
        </div>
      )}

      {/* 대분류 관리 */}
      {activeTeamId && (
        <div className="glass-panel" style={{ padding: '2rem' }}>
          <h3 style={{ fontSize: '1.2rem', marginBottom: '1rem', borderBottom: '2px solid var(--border)', paddingBottom: '0.5rem' }}>
            대분류 관리 {isSuperAdmin && <span style={{ fontSize: '0.85rem', color: 'var(--primary)', fontWeight: 500 }}>— {activeTeamName}</span>}
          </h3>
          {/* 활성 대분류 */}
          {majors.filter(m => m.isActive).map((m, idx) => (
            <div key={m.id} className="settings-row" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 0.8rem', borderBottom: '1px solid var(--border)' }}>
              <span style={{ flex: 1, fontWeight: 700, color: 'var(--primary)' }}>{m.name}</span>
              <button onClick={() => moveMajor(idx, -1)} className="btn" style={{ padding: '0.15rem 0.4rem', fontSize: '0.7rem' }} disabled={idx === 0}>▲</button>
              <button onClick={() => moveMajor(idx, 1)} className="btn" style={{ padding: '0.15rem 0.4rem', fontSize: '0.7rem' }} disabled={idx === majors.filter(x => x.isActive).length - 1}>▼</button>
              <button onClick={() => toggleMajorActive(m.id, false)} className="btn" style={{ fontSize: '0.7rem', padding: '0.15rem 0.5rem', color: '#f59e0b', borderColor: '#f59e0b' }}>사용안함</button>
              <button onClick={() => deleteMajor(m.id, m.name)} className="icon-btn del" style={{ fontSize: '0.8rem' }}>✕</button>
            </div>
          ))}
          {/* 비활성 대분류 */}
          {majors.filter(m => !m.isActive).length > 0 && (
            <div style={{ marginTop: '0.8rem', padding: '0.6rem 0.8rem', background: 'var(--surface-dim)', borderRadius: '6px' }}>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.4rem', fontWeight: 600 }}>사용안함 처리된 대분류</div>
              {majors.filter(m => !m.isActive).map(m => (
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

      {/* 중분류 관리 */}
      {activeTeamId && (
        <div className="glass-panel" style={{ padding: '2rem' }}>
          <h3 style={{ fontSize: '1.2rem', marginBottom: '1rem', borderBottom: '2px solid var(--border)', paddingBottom: '0.5rem' }}>
            중분류 관리 {isSuperAdmin && <span style={{ fontSize: '0.85rem', color: 'var(--primary)', fontWeight: 500 }}>— {activeTeamName}</span>}
          </h3>
          {majors.length === 0 && <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>대분류를 먼저 추가해주세요.</p>}
          {majors.filter(m => m.isActive).map(major => {
            const activeCats = categories.filter(c => c.major === major.name && c.isActive);
            const inactiveCats = categories.filter(c => c.major === major.name && !c.isActive);
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
