'use client';

import Link from 'next/link';
import changelog from '@/data/changelog';

export default function ChangelogPage() {
  return (
    <div style={{ maxWidth: '820px', margin: '2rem auto', padding: '0 1rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div className="glass-panel" style={{ padding: '2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '1.5rem' }}>업데이트 노트</h2>
          <p style={{ margin: '0.3rem 0 0', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
            주간보고 시스템의 변경 이력입니다.
          </p>
        </div>
        <Link href="/" className="btn" style={{ padding: '0.4rem 1.1rem', border: '1px solid var(--border)' }}>
          ← 돌아가기
        </Link>
      </div>

      <div className="glass-panel" style={{ padding: '2rem' }}>
        {changelog.map((entry, i) => (
          <div key={i} style={{
            marginBottom: i < changelog.length - 1 ? '1.5rem' : 0,
            paddingBottom: i < changelog.length - 1 ? '1.5rem' : 0,
            borderBottom: i < changelog.length - 1 ? '1px dashed var(--border)' : 'none'
          }}>
            <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'baseline', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '0.8rem', color: 'var(--primary)', fontWeight: 700, flexShrink: 0 }}>{entry.date}</span>
              <span style={{ fontSize: '1rem', fontWeight: 700 }}>{entry.title}</span>
            </div>
            <ul style={{ margin: 0, paddingLeft: '1.2rem' }}>
              {entry.items.map((item, j) => (
                <li key={j} style={{ fontSize: '0.88rem', color: 'var(--text-muted)', lineHeight: 1.7 }}>{item}</li>
              ))}
            </ul>
          </div>
        ))}
        {changelog.length === 0 && (
          <p style={{ textAlign: 'center', color: 'var(--text-muted)' }}>등록된 업데이트가 없습니다.</p>
        )}
      </div>
    </div>
  );
}
