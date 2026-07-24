'use client';

import { useEffect, useState } from 'react';

interface Usage {
  usedMb: number;
  limitMb: number;
  percent: number;
  reports: number;
  items: number;
  provider: string;
}

/** DB 사용량 — 무료 플랜 한도 대비 얼마나 썼는지 모두에게 보여준다 */
export default function DbUsage() {
  const [u, setU] = useState<Usage | null>(null);

  useEffect(() => {
    let alive = true;
    fetch('/api/db-usage')
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (alive && d && !d.error) setU(d); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  if (!u) return null;

  const pct = Math.min(u.percent, 100);
  const color = pct >= 85 ? '#dc2626' : pct >= 60 ? '#d97706' : '#16a34a';
  const label = u.usedMb >= 1024
    ? `${(u.usedMb / 1024).toFixed(2)}GB`
    : `${u.usedMb.toFixed(1)}MB`;
  const limitLabel = u.limitMb >= 1024 ? `${(u.limitMb / 1024).toFixed(1)}GB` : `${u.limitMb}MB`;

  return (
    <span
      title={`${u.provider} · ${limitLabel} 중 ${label} 사용 (${u.percent}%)\n주간보고 ${u.reports.toLocaleString()}건 · 항목 ${u.items.toLocaleString()}건`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.35rem',
        fontSize: '0.72rem',
        color: 'var(--text-muted)',
        whiteSpace: 'nowrap'
      }}
    >
      <span style={{ fontWeight: 600 }}>DB</span>
      <span
        aria-hidden
        style={{
          width: '46px',
          height: '5px',
          borderRadius: '3px',
          background: 'var(--border)',
          overflow: 'hidden',
          flexShrink: 0
        }}
      >
        <span style={{ display: 'block', width: `${pct}%`, height: '100%', background: color }} />
      </span>
      <span style={{ color, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
        {label} ({u.percent}%)
      </span>
    </span>
  );
}
