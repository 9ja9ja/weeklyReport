'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useUser } from '@/lib/UserContext';

export default function Navigation() {
  const { userId, userName, teamName, role, clearUser, isMasterOrAbove, isSuperAdmin } = useUser();
  const router = useRouter();

  const handleLogout = () => { clearUser(); router.push('/'); };

  const roleLabel = role === 'superAdmin' ? '최고관리자' : role === 'teamMaster' ? '관리자' : '';

  return (
    <nav style={{
      background: 'var(--panel-bg)', backdropFilter: 'blur(16px)', borderBottom: '1px solid var(--panel-border)',
      padding: '1rem 2rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, zIndex: 10
    }}>
      <div style={{ fontWeight: 700, fontSize: '1.25rem' }}>
        <Link href={userId ? '/dashboard' : '/'}>팀 주간보고</Link>
      </div>
      <div style={{ display: 'flex', gap: '1.5rem', fontWeight: 500, alignItems: 'center' }}>
        {userId && <Link href="/dashboard">홈</Link>}
        {userId && <Link href="/summary">취합본</Link>}
        {isMasterOrAbove && <Link href="/settings" style={{ color: 'var(--primary)' }}>설정</Link>}
        {userId && (
          <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
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
