'use client';

import type { CSSProperties, ReactNode } from 'react';
import type { DocPeer } from './useSharedDoc';

interface Props {
  /** 지금 이 칸을 쓰고 있는 다른 사람들 */
  peers: DocPeer[];
  style?: CSSProperties;
  children: ReactNode;
}

/**
 * 다른 사람이 편집 중인 입력칸 표시 — 그 사람 색 테두리 + 이름표.
 *
 * 사람이 없을 때도 **같은 구조를 그린다**. 있을 때만 감싸도록 만들면 상대가 칸에 들어오고
 * 나갈 때마다 입력칸이 새로 마운트돼 내 커서 위치와 한글 조합이 날아간다.
 */
export default function PeerField({ peers, style, children }: Props) {
  const on = peers.length > 0;
  return (
    <span
      className="peer-field"
      style={on ? { ...style, boxShadow: `0 0 0 2px ${peers[0].color}`, borderRadius: '3px' } : style}
    >
      {children}
      {on && (
        <span className="peer-field-tags">
          {peers.map(p => (
            <span key={p.uid} className="peer-field-tag" style={{ background: p.color }}>
              {p.name || '익명'}
            </span>
          ))}
        </span>
      )}
    </span>
  );
}
