'use client';

/**
 * 지금 누가 어느 칸을 쓰고 있는지 서로에게 알린다.
 *
 * 요약본은 글 하나라 y-prosemirror 가 문자 단위 커서를 그려주지만, 작성 화면은 입력칸이
 * 수백 개로 쪼개진 폼이다. 그래서 커서 좌표 대신 **"어느 칸에 들어가 있는가"** 를 주고받아
 * 그 칸에 테두리와 이름표를 붙인다.
 *
 * 위치는 화면 좌표가 아니라 **문서 좌표(분류/금주·차주/블록/칸)** 로 보낸다 — 사람마다 창 크기나
 * 스크롤 위치가 달라도 같은 칸을 가리키고, 블록은 id 로 가리키므로 남이 위에 항목을 추가해도
 * 어긋나지 않는다. 표 안의 칸만 행·열 번호를 쓰는데, 행이 끼어들면 잠깐 옆 칸을 가리킬 수 있다 —
 * 표시용이라 다음 클릭에 바로 맞춰지고, 편집 연산은 이 좌표를 쓰지 않는다.
 *
 * awareness 는 연결이 끊기면 그 사람의 상태를 자동으로 지운다. 브라우저를 그냥 닫아도
 * 이름표가 남지 않는다.
 */
import { useCallback, useEffect, useState } from 'react';
import type YProvider from 'y-partyserver/provider';
import { type DocPeer, peerColor } from './useSharedDoc';

/** 입력칸 하나를 가리키는 키 */
export function fieldKey(catId: number, side: string, blockId: string, part: string): string {
  return `${catId}/${side}/${blockId}/${part}`;
}

/** 블록 안에서의 위치 */
export const PART = {
  sub: 'sub',
  bullet: (bulletId: string) => `bullet:${bulletId}`,
  caption: 'caption',
  header: (c: number) => `head:${c}`,
  cell: (r: number, c: number) => `cell:${r}:${c}`
} as const;

const NO_PEERS: DocPeer[] = [];

interface AwareUser { uid?: number; name?: string; color?: string }

/**
 * awareness 상태들을 "칸 → 그 칸에 있는 사람들" 로 뒤집는다.
 *
 * 내 clientID 는 뺀다 — 내가 쓰고 있는 칸에 내 이름표가 붙으면 방해만 된다.
 * 같은 사람이 두 탭을 열어둔 경우 이름표는 하나만 남긴다.
 */
export function readFieldPeers(
  states: Map<number, Record<string, unknown>>,
  selfClientId: number
): Map<string, DocPeer[]> {
  const out = new Map<string, DocPeer[]>();
  states.forEach((st, clientId) => {
    if (clientId === selfClientId) return;
    const key = st.focus;
    const u = st.user as AwareUser | undefined;
    if (typeof key !== 'string' || !key || !u || typeof u.uid !== 'number') return;
    const list = out.get(key);
    if (list) {
      if (list.some(p => p.uid === u.uid)) return;
      list.push({ uid: u.uid, name: u.name ?? '', color: u.color ?? peerColor(u.uid) });
    } else {
      out.set(key, [{ uid: u.uid, name: u.name ?? '', color: u.color ?? peerColor(u.uid) }]);
    }
  });
  return out;
}

/** 블록 하나에 대한 표시·포커스 도구 */
export interface BlockPresence {
  peers(part: string): DocPeer[];
  focusProps(part: string): { onFocus: () => void; onBlur: () => void };
}

export interface Presence {
  block(catId: number, side: string, blockId: string): BlockPresence;
  /** 다른 사람이 지금 어딘가를 쓰고 있는가 */
  anyone: boolean;
}

const IDLE: BlockPresence = {
  peers: () => NO_PEERS,
  focusProps: () => ({ onFocus: () => {}, onBlur: () => {} })
};

export function usePresence(provider: YProvider | null, enabled = true): Presence {
  const [fields, setFields] = useState<Map<string, DocPeer[]>>(() => new Map());

  useEffect(() => {
    // 연결이 없으면 그대로 둔다 — 이때는 아래에서 빈 표시를 돌려주므로 읽히지 않고,
    // 연결이 생기면 곧바로 다시 계산한다.
    if (!provider || !enabled) return;
    const aw = provider.awareness;
    const sync = () => setFields(readFieldPeers(aw.getStates(), aw.clientID));
    aw.on('change', sync);
    sync();
    return () => {
      aw.off('change', sync);
      // 화면을 떠나면서 내 위치를 지운다. 두지 않으면 다른 사람 화면에 이름표가 남는다.
      if (aw.getLocalState()) aw.setLocalStateField('focus', null);
    };
  }, [provider, enabled]);

  const enter = useCallback((key: string) => {
    if (!provider || !enabled) return;
    provider.awareness.setLocalStateField('focus', key);
  }, [provider, enabled]);

  /**
   * 칸을 벗어났을 때. **지금 내 위치가 그 칸일 때만** 지운다 —
   * 다음 칸으로 옮겨간 뒤 이전 칸의 blur 가 늦게 도착하면 새 위치가 지워진다.
   */
  const leave = useCallback((key: string) => {
    if (!provider || !enabled) return;
    const st = provider.awareness.getLocalState() as { focus?: string } | null;
    if (st?.focus !== key) return;
    provider.awareness.setLocalStateField('focus', null);
  }, [provider, enabled]);

  if (!provider || !enabled) return { block: () => IDLE, anyone: false };

  return {
    anyone: fields.size > 0,
    block: (catId, side, blockId) => ({
      peers: part => fields.get(fieldKey(catId, side, blockId, part)) ?? NO_PEERS,
      focusProps: part => {
        const key = fieldKey(catId, side, blockId, part);
        return { onFocus: () => enter(key), onBlur: () => leave(key) };
      }
    })
  };
}
