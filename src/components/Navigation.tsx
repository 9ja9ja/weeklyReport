import Link from 'next/link';

export default function Navigation() {
  return (
    <nav style={{ 
      background: 'var(--panel-bg)', 
      backdropFilter: 'blur(16px)', 
      borderBottom: '1px solid var(--panel-border)',
      padding: '1rem 2rem',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      position: 'sticky',
      top: 0,
      zIndex: 10
    }}>
      <div style={{ fontWeight: 700, fontSize: '1.25rem' }}>
        <Link href="/">팀 주간보고</Link>
      </div>
      <div style={{ display: 'flex', gap: '1.5rem', fontWeight: 500 }}>
        <Link href="/">홈</Link>
        <Link href="/summary">주간보고 취합</Link>
      </div>
    </nav>
  );
}
