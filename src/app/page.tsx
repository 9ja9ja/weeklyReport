'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useUser } from '@/lib/UserContext';
import { getWeekNumber, getWeekRange, formatDateShort } from '@/lib/weekUtils';
import changelog from '@/data/changelog';

interface TeamWithUsers {
  id: number;
  name: string;
  users: { id: number; name: string; role: string; teamId: number; hasReport?: boolean; lastUpdated?: string | null; }[];
}

export default function Home() {
  const [teams, setTeams] = useState<TeamWithUsers[]>([]);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const { setUser } = useUser();

  const now = new Date();
  const year = now.getFullYear();
  const weekNum = getWeekNumber(now);

  // 로그인 모달
  const [loginTarget, setLoginTarget] = useState<{ id: number; name: string; role: string; teamId: number; teamName: string } | null>(null);
  const [loginPw, setLoginPw] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);

  // 비밀번호 변경 모달
  const [changePwUser, setChangePwUser] = useState<{ id: number; name: string; teamId: number; teamName: string; role: string } | null>(null);
  const [newPw, setNewPw] = useState('');
  const [newPwConfirm, setNewPwConfirm] = useState('');
  const [changePwError, setChangePwError] = useState('');

  useEffect(() => { fetchAll(); }, []);

  const fetchAll = async () => {
    setLoading(true);
    try {
      // 단일 API 호출로 모든 팀 + 유저 + 작성현황 조회
      const res = await fetch(`/api/teams?withUsers=true&year=${year}&weekNum=${weekNum}`);
      const data = await res.json();
      setTeams(Array.isArray(data) ? data : []);
    } catch { setTeams([]); }
    finally { setLoading(false); }
  };

  const handleClickUser = (user: any, teamName: string) => {
    setLoginTarget({ id: user.id, name: user.name, role: user.role, teamId: user.teamId, teamName });
    setLoginPw('');
    setLoginError('');
  };

  const handleLogin = async () => {
    if (!loginTarget) return;
    setLoginLoading(true);
    setLoginError('');
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: loginTarget.id, password: loginPw })
      });
      const data = await res.json();
      if (!res.ok) { setLoginError(data.error || '로그인 실패'); return; }

      if (data.mustChangePw) {
        setChangePwUser({ id: loginTarget.id, name: loginTarget.name, teamId: loginTarget.teamId, teamName: loginTarget.teamName, role: loginTarget.role });
        setLoginTarget(null);
        setNewPw(''); setNewPwConfirm(''); setChangePwError('');
        return;
      }

      setUser(data.user.id, data.user.name, data.user.teamId, data.user.teamName, data.user.role);
      setLoginTarget(null);
      router.push('/dashboard');
    } catch { setLoginError('서버 오류'); }
    finally { setLoginLoading(false); }
  };

  const handleChangePw = async () => {
    if (!changePwUser) return;
    if (newPw.length < 4) { setChangePwError('비밀번호는 4자리 이상'); return; }
    if (newPw !== newPwConfirm) { setChangePwError('비밀번호가 일치하지 않습니다.'); return; }
    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: changePwUser.id, currentPassword: '0000', newPassword: newPw })
      });
      if (!res.ok) { const d = await res.json(); setChangePwError(d.error); return; }
      setUser(changePwUser.id, changePwUser.name, changePwUser.teamId, changePwUser.teamName, changePwUser.role);
      setChangePwUser(null);
      router.push('/dashboard');
    } catch { setChangePwError('서버 오류'); }
  };

  const formatDateTime = (s: string | null) => {
    if (!s) return '-';
    const d = new Date(s);
    return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
  };

  const roleLabel = (role: string) => {
    if (role === 'superAdmin') return <span style={{ background: '#dc2626', color: 'white', padding: '0.05rem 0.3rem', borderRadius: '3px', fontSize: '0.6rem', marginLeft: '0.4rem' }}>최고관리자</span>;
    if (role === 'teamMaster') return <span style={{ background: 'var(--primary)', color: 'white', padding: '0.05rem 0.3rem', borderRadius: '3px', fontSize: '0.6rem', marginLeft: '0.4rem' }}>관리자</span>;
    return null;
  };

  return (
    <div style={{ maxWidth: '1200px', margin: '2rem auto', padding: '0 1rem' }}>
      <div className="glass-panel" style={{ padding: '2.5rem', textAlign: 'center', marginBottom: '2rem' }}>
        <h1 style={{ fontSize: '2rem', marginBottom: '0.3rem' }}>주간보고 시스템</h1>
        <p style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--primary)', marginBottom: '0.3rem' }}>{year}년 {weekNum}주차 ({formatDateShort(getWeekRange(year, weekNum).monday)} ~ {formatDateShort(getWeekRange(year, weekNum).friday)})</p>
        <p style={{ color: 'var(--text-muted)', margin: 0 }}>이름을 클릭하여 로그인해주세요.</p>
      </div>

      {loading ? <p style={{ textAlign: 'center' }}>로딩중...</p> : (
        <div className="home-grid">
          {teams.map(team => (
            <div key={team.id} className="glass-panel" style={{ padding: '1.5rem 2rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '1rem', borderBottom: '2px solid var(--border)', paddingBottom: '0.6rem' }}>
                <h3 style={{ margin: 0, fontSize: '1.15rem', color: 'var(--primary)' }}>{team.name}</h3>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{team.users.length}명</span>
              </div>

              {/* 헤더 */}
              <div style={{ display: 'flex', padding: '0.4rem 0.8rem', fontWeight: 700, fontSize: '0.8rem', color: 'var(--text-muted)', borderBottom: '1px solid var(--border)' }}>
                <div style={{ flex: 1 }}>이름</div>
                <div style={{ width: '70px', textAlign: 'center' }}>{weekNum}주차</div>
                <div style={{ width: '110px', textAlign: 'center' }}>최종작성</div>
              </div>

              {/* 유저 목록 */}
              {team.users.map(user => (
                <div
                  key={user.id}
                  onClick={() => handleClickUser(user, team.name)}
                  className="user-row"
                  style={{ display: 'flex', alignItems: 'center', padding: '0.6rem 0.8rem', borderBottom: '1px solid var(--border)', cursor: 'pointer' }}
                >
                  <div style={{ flex: 1, fontWeight: 600, display: 'flex', alignItems: 'center' }}>
                    {user.name}{roleLabel(user.role)}
                  </div>
                  <div style={{ width: '70px', textAlign: 'center' }}>
                    {user.hasReport
                      ? <span style={{ color: '#22c55e', fontWeight: 700, fontSize: '0.85rem' }}>완료</span>
                      : <span style={{ color: '#ef4444', fontWeight: 600, fontSize: '0.85rem' }}>미작성</span>}
                  </div>
                  <div style={{ width: '110px', textAlign: 'center', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                    {formatDateTime(user.lastUpdated ?? null)}
                  </div>
                </div>
              ))}
              {team.users.length === 0 && (
                <p style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '1rem', fontSize: '0.9rem' }}>팀원이 없습니다.</p>
              )}
            </div>
          ))}
          {teams.length === 0 && <p style={{ textAlign: 'center', color: 'var(--text-muted)' }}>등록된 팀이 없습니다.</p>}
        </div>
      )}

      {/* 업데이트 노트 */}
      {changelog.length > 0 && (
        <div style={{ marginTop: '2rem', padding: '1.5rem 2rem', border: '1px solid var(--border)', borderRadius: '8px', background: 'var(--surface-dim)' }}>
          <h4 style={{ margin: '0 0 1rem', fontSize: '0.95rem', color: 'var(--text-muted)' }}>업데이트 노트</h4>
          {changelog.slice(0, 5).map((entry, i) => (
            <div key={i} style={{ marginBottom: '0.8rem', paddingBottom: '0.8rem', borderBottom: i < Math.min(changelog.length, 5) - 1 ? '1px dashed var(--border)' : 'none' }}>
              <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', marginBottom: '0.3rem' }}>
                <span style={{ fontSize: '0.8rem', color: 'var(--primary)', fontWeight: 700, flexShrink: 0 }}>{entry.date}</span>
                <span style={{ fontSize: '0.88rem', fontWeight: 600 }}>{entry.title}</span>
              </div>
              <ul style={{ margin: 0, paddingLeft: '1.2rem' }}>
                {entry.items.map((item, j) => (
                  <li key={j} style={{ fontSize: '0.82rem', color: 'var(--text-muted)', lineHeight: '1.6' }}>{item}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {/* 로그인 모달 */}
      {loginTarget && (
        <div className="modal-overlay" onClick={() => setLoginTarget(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '380px' }}>
            <div className="modal-header">
              <h3 style={{ margin: 0 }}>{loginTarget.teamName} — {loginTarget.name}</h3>
              <button className="icon-btn" onClick={() => setLoginTarget(null)}>✕</button>
            </div>
            <div className="modal-body" style={{ textAlign: 'center' }}>
              <p style={{ marginBottom: '1.2rem', color: 'var(--text-muted)', fontSize: '0.9rem' }}>비밀번호를 입력해주세요</p>
              <input type="password" value={loginPw} onChange={e => setLoginPw(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleLogin()}
                placeholder="비밀번호 (초기: 0000)" className="input-field" style={{ width: '100%', textAlign: 'center', fontSize: '1.1rem', padding: '0.8rem' }} autoFocus />
              {loginError && <p style={{ color: '#ef4444', fontSize: '0.85rem', marginTop: '0.5rem' }}>{loginError}</p>}
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setLoginTarget(null)}>취소</button>
              <button className="btn btn-primary" onClick={handleLogin} disabled={loginLoading || !loginPw.trim()}>{loginLoading ? '확인중...' : '로그인'}</button>
            </div>
          </div>
        </div>
      )}

      {/* 비밀번호 변경 모달 */}
      {changePwUser && (
        <div className="modal-overlay">
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '400px' }}>
            <div className="modal-header">
              <h3 style={{ margin: 0 }}>비밀번호 변경</h3>
              <button className="icon-btn" onClick={() => setChangePwUser(null)}>✕</button>
            </div>
            <div className="modal-body">
              <p style={{ marginBottom: '1.2rem', color: 'var(--text-muted)', fontSize: '0.9rem' }}>{changePwUser.name}님, 첫 로그인입니다. 새 비밀번호를 설정해주세요.</p>
              <input type="password" value={newPw} onChange={e => setNewPw(e.target.value)} placeholder="새 비밀번호 (4자리 이상)" className="input-field" style={{ width: '100%', marginBottom: '0.8rem', padding: '0.7rem' }} autoFocus />
              <input type="password" value={newPwConfirm} onChange={e => setNewPwConfirm(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleChangePw()} placeholder="새 비밀번호 확인" className="input-field" style={{ width: '100%', padding: '0.7rem' }} />
              {changePwError && <p style={{ color: '#ef4444', fontSize: '0.85rem', marginTop: '0.5rem' }}>{changePwError}</p>}
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setChangePwUser(null)}>취소</button>
              <button className="btn btn-primary" onClick={handleChangePw}>변경 후 시작</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
