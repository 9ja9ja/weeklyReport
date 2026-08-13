'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useUser, type LoginUser } from '@/lib/UserContext';
import Link from 'next/link';
import { getIsoWeek, getWeekRange, formatDateShort } from '@/lib/weekUtils';
import WeekCalendar from '@/components/WeekCalendar';

interface TeamUser {
  id: number;
  name: string;
  role: string;
  teamId: number;
  position?: string;
  isPrimary?: boolean;
  hasReport?: boolean;
  prevHasReport?: boolean;
  lastUpdated?: string | null;
}

interface TeamWithUsers {
  id: number;
  name: string;
  division?: string;
  prevWeekNum?: number;
  users: TeamUser[];
}

export default function Home() {
  const [teams, setTeams] = useState<TeamWithUsers[]>([]);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const { setUserFromLogin } = useUser();

  const now = new Date();
  // 주차가 속한 해 — 1/1 이 전년도 53주차인 해에 달력 연도를 붙이면 없는 주차를 조회한다
  const { year, weekNum } = getIsoWeek(now);

  const [search, setSearch] = useState('');
  const [selectedTeamId, setSelectedTeamId] = useState<number | null>(null);

  // 로그인 모달
  const [loginTarget, setLoginTarget] = useState<{ id: number; name: string; role: string; teamId: number; teamName: string } | null>(null);
  const [loginPw, setLoginPw] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);

  // 비밀번호 변경 모달 — 로그인 응답의 user 객체를 그대로 보관해 변경 후 세션에 사용
  const [changePwUser, setChangePwUser] = useState<LoginUser | null>(null);
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
      const list: TeamWithUsers[] = Array.isArray(data) ? data : [];
      setTeams(list);
      // 첫 진입 시 목록 첫 번째 팀(정렬순 1번)을 기본으로 펼쳐둔다
      setSelectedTeamId(prev => prev ?? (list.length ? list[0].id : null));
    } catch { setTeams([]); }
    finally { setLoading(false); }
  };

  const handleClickUser = (user: TeamUser, teamName: string) => {
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
        setChangePwUser(data.user as LoginUser);
        setLoginTarget(null);
        setNewPw(''); setNewPwConfirm(''); setChangePwError('');
        return;
      }

      setUserFromLogin(data.user as LoginUser);
      setLoginTarget(null);
      router.push(data.user.role === 'executive' ? '/overview' : '/dashboard');
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
      setUserFromLogin(changePwUser);
      setChangePwUser(null);
      router.push(changePwUser.role === 'executive' ? '/overview' : '/dashboard');
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
    <div style={{ maxWidth: '1320px', margin: '2rem auto', padding: '0 1rem' }}>
      <div className="glass-panel" style={{ padding: '2.5rem', textAlign: 'center', marginBottom: '1.5rem', position: 'relative' }}>
        <Link href="/changelog" className="btn"
          style={{ position: 'absolute', top: '1rem', right: '1rem', fontSize: '0.78rem', padding: '0.3rem 0.8rem', border: '1px solid var(--border)', color: 'var(--text-muted)' }}>
          업데이트 노트
        </Link>
        <h1 style={{ fontSize: '2rem', marginBottom: '0.3rem' }}>주간보고 시스템</h1>
        <p style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--primary)', marginBottom: '0.3rem' }}>{year}년 {weekNum}주차 ({formatDateShort(getWeekRange(year, weekNum).monday)} ~ {formatDateShort(getWeekRange(year, weekNum).friday)})</p>
        <p style={{ color: 'var(--text-muted)', margin: '0 0 1.2rem' }}>이름을 클릭하여 로그인해주세요.</p>
        <div style={{ position: 'relative', maxWidth: '420px', margin: '0 auto' }}>
          <span style={{ position: 'absolute', left: '0.9rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', fontSize: '1rem', pointerEvents: 'none' }}>&#128269;</span>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            onKeyDown={e => {
              // 한글 조합을 확정하는 Enter 가 먼저 올라온다 — 그대로 두면 이름을 다 치기도 전에 로그인 창이 뜬다
              if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
              const q = search.trim();
              if (!q) return;
              const matches = teams.flatMap(t => t.users.filter(u => u.name.includes(q)).map(u => ({ u, tname: t.name })));
              if (matches.length === 1) handleClickUser(matches[0].u, matches[0].tname);
            }}
            placeholder="이름으로 빠르게 찾기 (Enter 로 로그인)"
            className="input-field"
            autoFocus
            style={{ width: '100%', padding: '0.7rem 2.4rem', fontSize: '1rem', textAlign: 'center' }}
          />
          {search && (
            <button onClick={() => setSearch('')} title="지우기"
              style={{ position: 'absolute', right: '0.6rem', top: '50%', transform: 'translateY(-50%)', border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '1.1rem' }}>✕</button>
          )}
        </div>
      </div>

      {loading ? <p style={{ textAlign: 'center' }}>로딩중...</p> : (() => {
        const q = search.trim();
        // 검색 중이면 매칭된 팀만, 아니면 선택한 팀 하나
        const shown = q
          ? teams.map(t => ({ ...t, users: t.users.filter(u => u.name.includes(q)) })).filter(t => t.users.length > 0)
          : teams.filter(t => t.id === selectedTeamId);

        return (
          <div className="home-3col" style={{ display: 'grid', gridTemplateColumns: '340px 240px minmax(0, 1fr)', gap: '1.2rem', alignItems: 'start' }}>
            {/* 1열 — 달력 (위아래) */}
            <div className="glass-panel home-side" style={{ padding: '1.3rem 1.4rem', position: 'sticky', top: '1rem' }}>
              <WeekCalendar vertical />
            </div>

            {/* 2열 — 팀 목록 (위아래) */}
            <div className="glass-panel home-side" style={{ padding: '1.1rem 1rem', position: 'sticky', top: '1rem' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.4rem', padding: '0 0.4rem 0.6rem', borderBottom: '2px solid var(--border)', marginBottom: '0.5rem' }}>
                <h3 style={{ margin: 0, fontSize: '0.95rem' }}>팀 목록</h3>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{teams.length}개</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {teams.map((t, ti) => {
                  const on = !q && t.id === selectedTeamId;
                  const hit = q ? t.users.filter(u => u.name.includes(q)).length : 0;
                  const done = t.users.filter(u => u.hasReport).length;
                  return (
                    <button
                      key={t.id}
                      onClick={() => { setSearch(''); setSelectedTeamId(t.id); }}
                      title={`${t.name} 명단 보기`}
                      style={{
                        display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', textAlign: 'left',
                        border: 'none',
                        borderLeft: `3px solid ${on ? 'var(--primary)' : 'transparent'}`,
                        borderBottom: ti < teams.length - 1 ? '1px solid var(--border)' : 'none',
                        background: on ? 'var(--primary-alpha-subtle)' : 'transparent',
                        color: on ? 'var(--primary)' : 'var(--foreground)',
                        padding: '0.55rem 0.6rem', width: '100%',
                        fontSize: '0.88rem', fontWeight: on ? 700 : 500,
                        opacity: q && hit === 0 ? 0.4 : 1
                      }}
                    >
                      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '0.1rem' }}>
                        {t.division && t.division !== t.name && (
                          <span style={{ fontSize: '0.62rem', fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.02em' }}>{t.division}</span>
                        )}
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</span>
                      </span>
                      <span style={{
                        fontSize: '0.7rem', fontWeight: 700, borderRadius: '999px', padding: '0.05rem 0.4rem', flexShrink: 0,
                        background: on ? 'var(--primary)' : 'var(--surface-dim)',
                        color: on ? 'white' : 'var(--text-muted)'
                      }}>
                        {q ? `${hit}` : t.division === '임원' ? `${t.users.length}` : `${done}/${t.users.length}`}
                      </span>
                    </button>
                  );
                })}
                {teams.length === 0 && <p style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>등록된 팀이 없습니다.</p>}
              </div>
            </div>

            {/* 3열 — 팀원 명단 (쭉 펼침) */}
            <div className="home-list" style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem', minWidth: 0 }}>
              {q && shown.length === 0 && (
                <div className="glass-panel" style={{ padding: '2.5rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                  &apos;{q}&apos; 검색 결과가 없습니다.
                </div>
              )}
              {shown.map(team => {
                const isExec = team.division === '임원'; // 임원은 작성 안 함 → 로그인만
                return (
                  <div key={team.id} className="glass-panel" style={{ padding: '1.4rem 1.8rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.8rem', borderBottom: '2px solid var(--border)', paddingBottom: '0.6rem', flexWrap: 'wrap' }}>
                      {team.division && (
                        <span style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--text-muted)', background: 'var(--surface-dim)', border: '1px solid var(--border)', borderRadius: '3px', padding: '0.1rem 0.4rem' }}>
                          {team.division}
                        </span>
                      )}
                      <h3 style={{ margin: 0, fontSize: '1.15rem', color: 'var(--primary)' }}>{team.name}</h3>
                      <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{team.users.length}명</span>
                      {!isExec && (
                        <span style={{ marginLeft: 'auto', fontSize: '0.8rem', fontWeight: 700, color: 'var(--primary)' }}>
                          {team.users.filter(u => u.hasReport).length}/{team.users.length} 작성
                        </span>
                      )}
                    </div>

                    {/* 헤더 — 임원은 작성 현황 컬럼 없이 이름만 */}
                    <div style={{ display: 'flex', padding: '0.4rem 0.8rem', fontWeight: 700, fontSize: '0.8rem', color: 'var(--text-muted)', borderBottom: '1px solid var(--border)' }}>
                      <div style={{ flex: 1 }}>이름</div>
                      {!isExec && <>
                        <div style={{ width: '80px', textAlign: 'center', opacity: 0.75 }}>{team.prevWeekNum ?? weekNum - 1}주차</div>
                        <div style={{ width: '80px', textAlign: 'center' }}>{weekNum}주차</div>
                        <div style={{ width: '120px', textAlign: 'center' }}>최종작성</div>
                      </>}
                    </div>
                    {team.users.map(user => (
                      <div
                        key={user.id}
                        onClick={() => handleClickUser(user, team.name)}
                        className="user-row"
                        style={{ display: 'flex', alignItems: 'center', padding: '0.6rem 0.8rem', borderBottom: '1px solid var(--border)', cursor: 'pointer' }}
                      >
                        <div style={{ flex: 1, minWidth: 0, fontWeight: 600, display: 'flex', alignItems: 'center' }}>
                          {/* 직급 — 설정 > 팀원 관리에서 넣은 값. 없는 사람은 이름만 나온다 */}
                          {user.position && (
                            <span style={{ color: 'var(--text-muted)', fontWeight: 500, fontSize: '0.8rem', marginRight: '0.35rem', flexShrink: 0 }}>
                              [{user.position}]
                            </span>
                          )}
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.name}</span>
                          {user.isPrimary === false && (
                            <span title="겸직" style={{ background: 'var(--surface-dim)', color: 'var(--text-muted)', border: '1px solid var(--border)', padding: '0.05rem 0.3rem', borderRadius: '3px', fontSize: '0.6rem', marginLeft: '0.4rem', fontWeight: 600, flexShrink: 0 }}>겸직</span>
                          )}
                          {roleLabel(user.role)}
                        </div>
                        {!isExec && <>
                          <div style={{ width: '80px', textAlign: 'center', flexShrink: 0 }}>
                            {user.prevHasReport
                              ? <span style={{ color: '#22c55e', fontWeight: 600, fontSize: '0.8rem', opacity: 0.65 }}>완료</span>
                              : <span style={{ color: 'var(--text-muted)', fontWeight: 500, fontSize: '0.8rem' }}>미작성</span>}
                          </div>
                          <div style={{ width: '80px', textAlign: 'center', flexShrink: 0 }}>
                            {user.hasReport
                              ? <span style={{ color: '#22c55e', fontWeight: 700, fontSize: '0.82rem' }}>완료</span>
                              : <span style={{ color: '#ef4444', fontWeight: 600, fontSize: '0.82rem' }}>미작성</span>}
                          </div>
                          <div style={{ width: '120px', textAlign: 'center', fontSize: '0.78rem', color: 'var(--text-muted)', flexShrink: 0 }}>
                            {formatDateTime(user.lastUpdated ?? null)}
                          </div>
                        </>}
                      </div>
                    ))}
                    {team.users.length === 0 && (
                      <p style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '1rem', fontSize: '0.9rem' }}>팀원이 없습니다.</p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

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
              {/* 버튼과 같은 조건을 건다 — 빈 비밀번호로 눌러 "일치하지 않습니다" 가 먼저 뜨는 일을 막는다 */}
              <input type="password" value={loginPw} onChange={e => setLoginPw(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing && loginPw.trim()) handleLogin(); }}
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
