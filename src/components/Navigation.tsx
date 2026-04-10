'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useUser } from '@/lib/UserContext';

export default function Navigation() {
  const { userId, userName, teamName, role, clearUser, isMasterOrAbove, isSuperAdmin } = useUser();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);

  const handleLogout = () => { clearUser(); router.push('/'); };
  const closeMenu = () => setMenuOpen(false);

  const roleLabel = role === 'superAdmin' ? '최고관리자' : role === 'teamMaster' ? '관리자' : '';

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
        {userId && <Link href="/dashboard" onClick={closeMenu}>홈</Link>}
        {userId && <Link href="/summary" onClick={closeMenu}>취합본</Link>}
        {isMasterOrAbove && <Link href="/settings" onClick={closeMenu} style={{ color: 'var(--primary)' }}>설정</Link>}
        {userId && (
          <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            <span style={{ color: 'var(--foreground)', fontWeight: 600 }}>{teamName}</span>
            {userName}
            {roleLabel && <span style={{ background: 'var(--primary)', color: 'white', padding: '0.1rem 0.4rem', borderRadius: '4px', fontSize: '0.7rem' }}>{roleLabel}</span>}
            <button onClick={handleLogout} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: '4px', padding: '0.2rem 0.5rem', cursor: 'pointer', fontSize: '0.75rem', color: 'var(--text-muted)' }}>로그아웃</button>
          </span>
        )}
      </div>
    </nav>
  );
}
