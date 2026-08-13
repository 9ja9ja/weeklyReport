'use client';

/**
 * 요약본 실시간 공동 편집 접속.
 *
 * 실시간이 불가능한 상황(미구성·문서 미생성·임원 조회 등)에서는 조용히 **기존 저장 방식**으로
 * 떨어진다. 실시간이 안 된다고 화면이 안 보이면 안 되기 때문이다.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import * as Y from 'yjs';
import YProvider from 'y-partyserver/provider';
import { applyLocalEdit } from './useSharedDoc';

export type BriefMode = 'loading' | 'legacy' | 'realtime';

export interface BriefPeer {
  uid: number;
  name: string;
  color: string;
}

export interface BriefLocalUser {
  uid: number;
  name: string;
  color: string;
}

export interface BriefRealtime {
  mode: BriefMode;
  /** legacy 로 떨어진 이유 — 화면에 표시해 사용자가 상황을 알게 한다 */
  legacyReason: string;
  doc: Y.Doc | null;
  provider: YProvider | null;
  connected: boolean;
  /**
   * 서버 문서를 **한 번이라도** 받았는가.
   *
   * provider.synced 는 연결이 끊길 때마다 false 로 돌아간다. 그걸 그대로 쓰면
   * 순단 때마다 툴바가 사라지고 입력이 막힌다 — Yjs 는 오프라인 편집이 되는 구조라 과한 제한이다.
   * "아직 한 번도 못 받음"과 "지금 끊김"은 다른 상태다.
   */
  synced: boolean;
  /** 쓰기 가능 여부의 최종 판정 — 마스터가 아니거나 잠겼거나 확정 중이면 읽기전용 */
  readOnly: boolean;
  master: boolean;
  locked: boolean;
  frozen: boolean;
  revision: number;
  savedAt: number | null;
  notice: string;
  peers: BriefPeer[];
  localUser: BriefLocalUser | null;
}

/** 접속자 색 — 이름이 같아도 구분되도록 uid 로 고정한다 */
function colorOf(uid: number): string {
  const palette = ['#2563eb', '#dc2626', '#059669', '#d97706', '#7c3aed', '#0891b2', '#db2777', '#65a30d'];
  return palette[Math.abs(uid) % palette.length];
}

interface TokenResponse {
  token: string;
  room: string;
  host: string | null;
  docGeneration: number;
  writeEpoch: number;
  revision: number;
  isLocked: boolean;
  readOnly: boolean;
  master: boolean;
}

const initial: BriefRealtime = {
  mode: 'loading', legacyReason: '', doc: null, provider: null,
  connected: false, synced: false,
  readOnly: true, master: false, locked: false, frozen: false,
  revision: 0, savedAt: null, notice: '', peers: [], localUser: null
};

export function useBriefRealtime(
  year: number, weekNum: number, userId: number | null, userName: string
): BriefRealtime & { flush: () => Promise<string> } {
  const [state, setState] = useState<BriefRealtime>(initial);
  // 현재 주차를 항상 최신으로 들고 있어야 저장 요청이 엉뚱한 주차로 가지 않는다
  const weekRef = useRef({ year, weekNum });
  weekRef.current = { year, weekNum };

  useEffect(() => {
    if (!userId) return;

    let disposed = false;
    let provider: YProvider | null = null;
    let doc: Y.Doc | null = null;
    /** 연속 토큰 실패 횟수 — 권한이 사라졌는데 무한 재접속만 도는 상황을 끊는다 */
    let tokenFailures = 0;
    /** 서버 문서를 한 번이라도 받아 실시간으로 편집하고 있었는가 */
    let wasLive = false;

    /**
     * 실시간으로 편집하던 중에 연결이 끊긴 경우.
     *
     * 여기서 기존 방식으로 내려가면 에디터가 통째로 다시 만들어지며 **페이지를 열 때 받아 둔
     * HTML** 로 갈아끼워진다 — 그동안 여럿이 쓴 내용이 화면에서 사라지고, 이어서 친 내용은
     * 서버가 공동 편집 주차라며 거부해 그대로 버려진다. 보고 있던 문서는 그대로 두고
     * 편집만 막은 뒤 새로고침을 안내한다.
     */
    const holdDisconnected = (reason: string) => {
      if (disposed) return;
      provider?.disconnect();   // 토큰 없이 붙는 401 재접속 루프를 끊는다
      setState(s => ({
        ...s,
        readOnly: true,
        notice: reason || '실시간 연결이 끊겼습니다. 새로고침해주세요.'
      }));
    };

    const toLegacy = (reason: string) => {
      if (disposed) return;
      // 이미 실시간으로 편집하던 중이면 기존 방식으로 내려가지 않는다 (내용이 되돌아간다)
      if (wasLive) { holdDisconnected(reason); return; }
      provider?.destroy();
      doc?.destroy();
      provider = null;
      doc = null;
      setState({ ...initial, mode: 'legacy', legacyReason: reason });
    };

    /**
     * 토큰 발급.
     * `seed=true` 는 POST 로 보낸다 — 문서 생성은 부작용이라 GET 에 두면
     * 링크 클릭 한 번으로 임의 주차의 문서가 만들어진다(쿠키가 sameSite=lax).
     * 재접속마다 도는 갱신 경로는 부작용이 없어야 하므로 GET 을 쓴다.
     */
    const fetchToken = async (seed = false): Promise<TokenResponse | { legacy: string }> => {
      try {
        const res = seed
          ? await fetch('/api/realtime/brief-token', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ year, weekNum })
            })
          : await fetch(`/api/realtime/brief-token?year=${year}&weekNum=${weekNum}`);
        if (res.ok) return res.json();
        if (res.status === 409) return { legacy: '' };   // 아직 실시간 문서 없음 / 컷오버 밖
        if (res.status === 503) return { legacy: '' };   // 미구성
        if (res.status === 403) return { legacy: '' };   // 조회 전용 계정
        return { legacy: '실시간 편집에 연결하지 못했습니다. 기존 방식으로 편집합니다.' };
      } catch {
        return { legacy: '실시간 편집에 연결하지 못했습니다. 기존 방식으로 편집합니다.' };
      }
    };

    (async () => {
      const first = await fetchToken(true);
      if (disposed) return;
      if ('legacy' in first) { toLegacy(first.legacy); return; }
      if (!first.host) { toLegacy(''); return; }

      const localUser: BriefLocalUser = { uid: userId, name: userName, color: colorOf(userId) };

      doc = new Y.Doc();
      provider = new YProvider(first.host, first.room, doc, {
        // 재연결마다 새 토큰을 받는다. 토큰 TTL 이 짧아 고정값을 쓰면 오래 열어둔 탭이 끊긴다.
        params: async () => {
          const t = await fetchToken();
          if ('legacy' in t) {
            // 권한이 사라졌거나(컷오버 해제·역할 변경) 문서가 없어졌다.
            // 토큰 없이 붙으면 401 → close → 재시도가 영원히 돈다. 기존 방식으로 내려준다.
            if (++tokenFailures >= 2) {
              toLegacy(t.legacy || '실시간 편집이 종료되어 기존 방식으로 전환했습니다.');
            }
            return {};
          }
          tokenFailures = 0;
          return { token: t.token };
        },
        connect: true
      });

      provider.awareness.setLocalStateField('user', localUser);

      const readPeers = (): BriefPeer[] => {
        const out: BriefPeer[] = [];
        const seen = new Set<number>();
        provider?.awareness.getStates().forEach(st => {
          const u = (st as { user?: { uid?: number; name?: string; color?: string } }).user;
          if (!u || typeof u.uid !== 'number') return;
          // 같은 사람이 탭을 여러 개 열어도 한 명으로 센다
          if (seen.has(u.uid)) return;
          seen.add(u.uid);
          out.push({ uid: u.uid, name: u.name ?? '', color: u.color ?? colorOf(u.uid) });
        });
        return out;
      };

      const patch = (p: Partial<BriefRealtime>) => {
        if (!disposed) setState(s => ({ ...s, ...p }));
      };

      /**
       * 권한 상태를 한곳에서 계산한다.
       * 개별 메시지마다 따로 계산하면 잠금 해제 뒤에도 읽기전용이 남는 식으로 조건이 새어나간다.
       */
      const applyPermission = (p: { locked?: boolean; frozen?: boolean }) => {
        if (disposed) return;
        setState(s => {
          const locked = p.locked ?? s.locked;
          const frozen = p.frozen ?? s.frozen;
          return { ...s, locked, frozen, readOnly: !s.master || locked || frozen };
        });
      };

      /**
       * 서버가 준 토큰에도 readOnly 가 박혀 있어, 잠금이 풀려도 **재접속 전까지는 서버가 쓰기를 버린다**.
       * 클라이언트만 편집 가능하게 만들면 입력이 조용히 사라지므로 연결을 새로 맺는다.
       */
      const reconnectForFreshToken = () => {
        if (disposed || !provider) return;
        provider.disconnect();
        provider.connect();
      };

      provider.on('status', (e: { status: string }) => patch({ connected: e.status === 'connected' }));
      // 한 번 받으면 내려가지 않는다. 순단으로 편집이 막히면 안 된다.
      // 서버 문서를 받은 뒤로는 "실시간으로 편집 중"이다 — 끊겨도 기존 방식으로 되돌리지 않는다
      provider.on('sync', (isSynced: boolean) => { if (isSynced) { wasLive = true; patch({ synced: true }); } });
      provider.awareness.on('change', () => patch({ peers: readPeers() }));

      provider.on('custom-message', (raw: string) => {
        let m: { type?: string; [k: string]: unknown };
        try { m = JSON.parse(raw); } catch { return; }
        switch (m.type) {
          case 'hello':
            patch({ revision: Number(m.revision) || 0 });
            applyPermission({ locked: !!m.locked, frozen: !!m.frozen });
            break;
          case 'saved':
            patch({ revision: Number(m.revision) || 0, savedAt: Date.now(), notice: '' });
            break;
          case 'save-rejected':
            patch({ notice: m.reason === 'locked'
              ? '잠금된 요약본이라 저장되지 않았습니다.'
              : '문서가 갱신되어 저장이 거부되었습니다. 새로고침해주세요.' });
            break;
          case 'save-failed':
            patch({ notice: '저장에 실패했습니다. 연결을 확인해주세요.' });
            break;
          case 'frozen':
            patch({ notice: '잠금 확정 중입니다.' });
            applyPermission({ frozen: true });
            break;
          case 'unfrozen':
            patch({ notice: '' });
            applyPermission({ frozen: false });
            reconnectForFreshToken();
            break;
          case 'locked':
            patch({ notice: '요약본이 잠금 처리되었습니다.' });
            applyPermission({ locked: true, frozen: false });
            break;
          case 'unlocked':
            patch({ notice: '' });
            applyPermission({ locked: false, frozen: false });
            reconnectForFreshToken();
            break;
          case 'resynced':
            patch({ revision: Number(m.revision) || 0 });
            applyPermission({ locked: !!m.locked });
            break;
          case 'generation-changed':
            patch({ notice: '문서가 복원되었습니다. 새로고침해주세요.' });
            break;
          case 'stale-room':
            // 이 룸이 들고 있는 문서가 DB 에서 교체·삭제됐다. 그대로 두면 저장이 계속 거부된다.
            patch({ notice: '문서가 교체되었습니다. 새로고침해주세요.' });
            applyPermission({ frozen: true });
            break;
        }
      });

      patch({
        mode: 'realtime', legacyReason: '', doc, provider, localUser,
        master: first.master, locked: first.isLocked, frozen: false,
        readOnly: !first.master || first.isLocked,
        revision: first.revision, peers: readPeers()
      });
    })().catch(() => toLegacy('실시간 편집에 연결하지 못했습니다. 기존 방식으로 편집합니다.'));

    return () => {
      disposed = true;
      provider?.destroy();
      doc?.destroy();
      setState(initial);
    };
    // userName 은 접속 중 바뀌지 않는다 — 의존성에 넣으면 이름 로딩 시점에 룸이 재연결된다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, weekNum, userId]);

  /** [저장] — 디바운스를 기다리지 않고 룸에 즉시 반영을 지시한다 */
  const flush = useCallback(async (): Promise<string> => {
    const { year: y, weekNum: w } = weekRef.current;
    try {
      const res = await fetch('/api/realtime/brief-flush', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year: y, weekNum: w })
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) return data?.error ?? '저장에 실패했습니다.';
      setState(s => ({ ...s, revision: data?.revision ?? s.revision, savedAt: Date.now(), notice: '' }));
      return '';
    } catch {
      return '저장에 실패했습니다.';
    }
  }, []);

  return { ...state, flush };
}

// ── 제목 바인딩 ────────────────────────────────────────────────

const isLowSurrogate = (code: number) => code >= 0xdc00 && code <= 0xdfff;

/**
 * 두 문자열의 변경 구간. **코드포인트 경계**를 지킨다.
 *
 * UTF-16 코드유닛 단위로 자르면 이모지처럼 서로게이트 페어인 문자를 다른 이모지로 바꿀 때
 * 짝의 한쪽만 지워져 U+FFFD 와 lone surrogate 가 남는다. 그 문자열은 화면에서 깨질 뿐 아니라
 * JSON 직렬화 경로에서 요청 자체를 깨뜨린다.
 */
export function textDiff(prev: string, next: string): { index: number; removed: number; added: string } {
  let head = 0;
  while (head < prev.length && head < next.length && prev[head] === next[head]) head++;
  while (head > 0 && isLowSurrogate(next.charCodeAt(head))) head--;

  let tail = 0;
  while (
    tail < prev.length - head && tail < next.length - head &&
    prev[prev.length - 1 - tail] === next[next.length - 1 - tail]
  ) tail++;
  while (tail > 0 && isLowSurrogate(next.charCodeAt(next.length - tail))) tail--;

  return { index: head, removed: prev.length - head - tail, added: next.slice(head, next.length - tail) };
}

/**
 * 제목처럼 짧은 단일행 텍스트를 Y.Text 에 묶는다.
 *
 * **직전 로컬 값과 새 로컬 값의 차이**만 반영한다. Y.Text 현재값과 비교하면
 * 그 사이 상대가 앞에 끼워 넣은 글자가 "내가 지운 것"으로 계산돼 통째로 사라진다.
 * 한글 조합 중에는 원격 반영을 멈추므로 그 창이 몇 초씩 벌어진다.
 */
export function useYText(ytext: Y.Text | null) {
  const [value, setValue] = useState(() => ytext?.toString() ?? '');
  const [tracked, setTracked] = useState(ytext);
  const composing = useRef(false);
  /**
   * 마지막으로 화면에 반영한 값. diff 의 기준이다.
   * state 는 다음 렌더에야 갱신되므로 연속 입력에서 기준이 한 박자 밀린다.
   */
  const valueRef = useRef(value);

  // 관찰 대상이 바뀌면(동기화로 Y.Text 가 처음 생길 때 포함) 렌더 중에 값을 맞춘다.
  // 이걸 effect 에서 하면 빈칸이 한 프레임 보였다가 채워진다.
  // (valueRef 는 아래 effect 의 sync() 가 곧바로 맞춰준다 — 렌더 중 ref 쓰기는 하지 않는다)
  if (tracked !== ytext) {
    setTracked(ytext);
    setValue(ytext?.toString() ?? '');
  }

  const commit = useCallback((v: string) => {
    valueRef.current = v;
    setValue(v);
  }, []);

  useEffect(() => {
    if (!ytext) { valueRef.current = ''; return; }
    const sync = () => { if (!composing.current) commit(ytext.toString()); };
    ytext.observe(sync);
    // 렌더 시점과 구독 사이에 도착한 변경을 놓치지 않도록 한 번 더 읽는다
    sync();
    return () => ytext.unobserve(sync);
  }, [ytext, commit]);

  const push = useCallback((next: string) => {
    const prev = valueRef.current;
    commit(next);
    if (!ytext || prev === next) return;
    // 조합 중에는 원격 변경이 화면에 안 얹혀 좌표가 어긋난다 — 작성 화면과 같은 보정을 쓴다
    applyLocalEdit(ytext, prev, next);
  }, [ytext, commit]);

  /**
   * 조합을 끝내고 문서 값으로 맞춘다.
   *
   * compositionend 가 오지 않는 경로가 있다 — 조합 중 마우스로 빠져나가거나,
   * 잠금·연결 끊김으로 제목 입력칸이 통째로 사라지는 경우다. 훅은 페이지와 함께 살아 있어
   * 플래그가 true 로 굳으면 그 뒤 원격 제목이 영영 반영되지 않고, 다음 입력의 diff 기준도 어긋나
   * 엉뚱한 위치에 글자가 끼어든다. 그래서 blur·언마운트에서도 반드시 풀어 준다.
   */
  const endComposing = useCallback(() => {
    if (!composing.current) return;
    composing.current = false;
    if (ytext) commit(ytext.toString());
  }, [ytext, commit]);

  const compositionProps = {
    onCompositionStart: () => { composing.current = true; },
    onCompositionEnd: endComposing,
    onBlur: endComposing
  };

  return { value, push, compositionProps, endComposing };
}

/**
 * 제목 Y.Text 를 추적한다.
 *
 * 접속 직후에는 문서가 비어 있어 meta.title 이 아직 없다. 동기화가 끝나 값이 들어오는
 * 순간을 잡아야 하므로 맵을 관찰한다 — 한 번만 읽으면 제목이 영원히 빈칸으로 남는다.
 */
export function useBriefTitleText(doc: Y.Doc | null): Y.Text | null {
  const subscribe = useCallback((onChange: () => void) => {
    if (!doc) return () => {};
    const meta = doc.getMap('meta');
    meta.observe(onChange);
    return () => meta.unobserve(onChange);
  }, [doc]);

  // Y.Text 인스턴스는 한 번 생기면 그대로라 스냅샷이 안정적이다 (재렌더 루프가 생기지 않는다)
  const snapshot = useCallback((): Y.Text | null => {
    if (!doc) return null;
    const t = doc.getMap('meta').get('title');
    return t instanceof Y.Text ? t : null;
  }, [doc]);

  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
