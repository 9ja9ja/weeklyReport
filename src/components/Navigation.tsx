'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useUser } from '@/lib/UserContext';
import DbUsage from './DbUsage';

export default function Navigation() {
  const { userId, userName, teamName, teams, activeTeamId, switchTeam, role, clearUser, hasMultipleTeams, canViewOverview, isExecutive } = useUser();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);

  const handleLogout = () => { clearUser(); router.push('/'); };
  const closeMenu = () => setMenuOpen(false);

  const roleLabel = role === 'superAdmin' ? '최고관리자' : role === 'teamMaster' ? '관리자' : role === 'executive' ? '임원' : '';

  return (
    <nav className="nav-bar">
      <div className="nav-brand">
        <Link href={userId ? '/dashboard' : '/'}>팀 주간보고</Link>
      </div>
      {userId && (
        <button className="nav-hamburger" onClick={() => setMenuOpen(!menuOpen)} aria-label="메뉴">
          {menuOpen ? '✕' : '☰'}
        </button>
      )}
      <div className={`nav-links${menuOpen ? ' open' : ''}`}>
        {userId && !isExecutive && <Link href="/dashboard" onClick={closeMenu}>홈</Link>}
        {userId && !isExecutive && <Link href="/summary" onClick={closeMenu}>팀별 취합본</Link>}
        {canViewOverview && <Link href="/overview" onClick={closeMenu} style={{ color: 'var(--primary)', fontWeight: 700 }}>전체 취합본</Link>}
        {canViewOverview && <Link href="/brief" onClick={closeMenu}>요약본</Link>}
        {canViewOverview && <Link href="/schedule" onClick={closeMenu}>일정보고</Link>}
        {canViewOverview && <Link href="/pnl" onClick={closeMenu}>손익보고</Link>}
        {/* 일반 팀원도 대분류를 직접 관리하므로 설정 진입이 필요하다 (마스터 전용 섹션은 화면 안에서 가려진다) */}
        {userId && !isExecutive && <Link href="/settings" onClick={closeMenu} style={{ color: 'var(--primary)' }}>설정</Link>}
        {userId && (
          <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            <DbUsage />
            <span style={{ width: '1px', height: '0.9rem', background: 'var(--border)' }} />
            {hasMultipleTeams ? (
              <select
                value={activeTeamId ?? ''}
                onChange={e => switchTeam(parseInt(e.target.value, 10))}
                title="겸직 팀 전환"
                style={{
                  fontSize: '0.8rem', fontWeight: 600, color: 'var(--foreground)',
                  background: 'var(--surface-dim)', border: '1px solid var(--primary)',
                  borderRadius: '4px', padding: '0.15rem 0.4rem', cursor: 'pointer', maxWidth: '160px'
                }}
              >
                {teams.map(t => (
                  <option key={t.id} value={t.id}>
                    {t.name}{t.isPrimary ? '' : ' (겸직)'}
                  </option>
                ))}
              </select>
            ) : (
              <span style={{ color: 'var(--foreground)', fontWeight: 600 }}>{teamName}</span>
            )}
            {userName}
            {roleLabel && <span style={{ background: 'var(--primary)', color: 'white', padding: '0.1rem 0.4rem', borderRadius: '4px', fontSize: '0.7rem' }}>{roleLabel}</span>}
            <button onClick={handleLogout} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: '4px', padding: '0.2rem 0.5rem', cursor: 'pointer', fontSize: '0.75rem', color: 'var(--text-muted)' }}>로그아웃</button>
          </span>
        )}
      </div>
    </nav>
  );
}
