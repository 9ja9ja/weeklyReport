'use client';

/**
 * 주간보고 공유 문서 접속 (팀·주차당 문서 1개).
 *
 * 요약본(useBriefRealtime)과 같은 구조지만 문서 좌표에 팀이 들어가고, 편집 권한이
 * 팀원 전체다(요약본은 마스터만). 공동 편집 대상이 아닌 팀·주차는 조용히 legacy 로
 * 떨어져 기존 개인 작성 화면이 그대로 돈다.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import * as Y from 'yjs';
import YProvider from 'y-partyserver/provider';

export type DocMode = 'loading' | 'legacy' | 'realtime';

export interface DocPeer {
  uid: number;
  name: string;
  color: string;
}

export interface SharedDocState {
  mode: DocMode;
  legacyReason: string;
  doc: Y.Doc | null;
  provider: YProvider | null;
  /** 로컬 편집에 붙이는 origin — UndoManager 가 "내 변경만" 되돌리는 기준이 된다 */
  origin: object | null;
  undo: Y.UndoManager | null;
  connected: boolean;
  /** 서버 문서를 한 번이라도 받았는가. 순단으로 내려가지 않는다 */
  synced: boolean;
  readOnly: boolean;
  master: boolean;
  locked: boolean;
  frozen: boolean;
  revision: number;
  savedAt: number | null;
  notice: string;
  peers: DocPeer[];
  localUser: DocPeer | null;
}

/** 사람마다 고정 색 — 상단 접속자 표시와 칸 이름표가 같은 색이어야 누구인지 바로 안다 */
export function peerColor(uid: number): string {
  const palette = ['#2563eb', '#dc2626', '#059669', '#d97706', '#7c3aed', '#0891b2', '#db2777', '#65a30d'];
  return palette[Math.abs(uid) % palette.length];
}

const colorOf = peerColor;

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

const initial: SharedDocState = {
  mode: 'loading', legacyReason: '', doc: null, provider: null, origin: null, undo: null,
  connected: false, synced: false,
  readOnly: true, master: false, locked: false, frozen: false,
  revision: 0, savedAt: null, notice: '', peers: [], localUser: null
};

export function useSharedDoc(
  teamId: number | null, year: number, weekNum: number,
  userId: number | null, userName: string
): SharedDocState {
  const [state, setState] = useState<SharedDocState>(initial);

  useEffect(() => {
    if (!userId || !teamId) return;

    let disposed = false;
    let provider: YProvider | null = null;
    let doc: Y.Doc | null = null;
    let undo: Y.UndoManager | null = null;
    let tokenFailures = 0;
    /** 서버 문서를 한 번이라도 받아 실시간으로 편집하고 있었는가 */
    let wasLive = false;

    /**
     * 실시간으로 편집하던 중에 연결이 끊긴 경우.
     *
     * 기존 방식으로 내려가면 화면이 **페이지를 열 때 받아 둔 개인 보고**로 갈아끼워져
     * 그동안 팀이 함께 쓴 내용이 사라져 보이고, 이어서 친 내용은 서버가 공동 편집 주차라며
     * 거부한다(409). 보고 있던 문서는 그대로 두고 편집만 막은 뒤 새로고침을 안내한다.
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
      undo?.destroy();
      provider?.destroy();
      doc?.destroy();
      undo = null; provider = null; doc = null;
      setState({ ...initial, mode: 'legacy', legacyReason: reason });
    };

    const fetchToken = async (seed = false): Promise<TokenResponse | { legacy: string }> => {
      try {
        const res = seed
          ? await fetch('/api/realtime/token', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ teamId, year, weekNum })
            })
          : await fetch(`/api/realtime/token?teamId=${teamId}&year=${year}&weekNum=${weekNum}`);
        if (res.ok) return res.json();
        // 409 = 공동 편집 대상이 아닌 주차, 503 = 미구성, 403 = 조회 전용 계정
        if ([403, 409, 503].includes(res.status)) return { legacy: '' };
        return { legacy: '실시간 편집에 연결하지 못했습니다. 기존 방식으로 작성합니다.' };
      } catch {
        return { legacy: '실시간 편집에 연결하지 못했습니다. 기존 방식으로 작성합니다.' };
      }
    };

    (async () => {
      const first = await fetchToken(true);
      if (disposed) return;
      if ('legacy' in first) { toLegacy(first.legacy); return; }
      if (!first.host) { toLegacy(''); return; }

      const localUser: DocPeer = { uid: userId, name: userName, color: colorOf(userId) };
      const origin = { local: true };

      doc = new Y.Doc();
      provider = new YProvider(first.host, first.room, doc, {
        params: async () => {
          const t = await fetchToken();
          if ('legacy' in t) {
            // 권한이 사라졌거나 컷오버가 꺼졌다. 토큰 없이 붙으면 401 재접속만 무한히 돈다.
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

      // 내 변경만 되돌린다. 기존 useHistory 는 화면 상태를 통째로 되돌려
      // 남이 방금 쓴 것까지 지웠다 — 공동 편집에서는 절대 쓰면 안 된다.
      undo = new Y.UndoManager([doc.getMap('cats')], { trackedOrigins: new Set([origin]) });

      provider.awareness.setLocalStateField('user', localUser);

      const readPeers = (): DocPeer[] => {
        const out: DocPeer[] = [];
        const seen = new Set<number>();
        provider?.awareness.getStates().forEach(st => {
          const u = (st as { user?: { uid?: number; name?: string; color?: string } }).user;
          if (!u || typeof u.uid !== 'number' || seen.has(u.uid)) return;
          seen.add(u.uid);
          out.push({ uid: u.uid, name: u.name ?? '', color: u.color ?? colorOf(u.uid) });
        });
        return out;
      };

      const patch = (p: Partial<SharedDocState>) => {
        if (!disposed) setState(s => ({ ...s, ...p }));
      };

      /** 권한은 한곳에서 계산한다 — 나눠 두면 잠금 해제 뒤에도 읽기전용이 남는다 */
      const applyPermission = (p: { locked?: boolean; frozen?: boolean }) => {
        if (disposed) return;
        setState(s => {
          const locked = p.locked ?? s.locked;
          const frozen = p.frozen ?? s.frozen;
          return { ...s, locked, frozen, readOnly: locked || frozen };
        });
      };

      /**
       * 토큰에도 readOnly 가 박혀 있어, 잠금이 풀려도 재접속 전까지 서버가 쓰기를 버린다.
       * 클라이언트만 열어주면 입력이 조용히 사라지므로 연결을 새로 맺는다.
       */
      const reconnect = () => {
        if (disposed || !provider) return;
        provider.disconnect();
        provider.connect();
      };

      provider.on('status', (e: { status: string }) => patch({ connected: e.status === 'connected' }));
      // 서버 문서를 받은 뒤로는 "실시간으로 편집 중"이다 — 끊겨도 기존 방식으로 되돌리지 않는다
      provider.on('sync', (ok: boolean) => { if (ok) { wasLive = true; patch({ synced: true }); } });
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
              ? '잠긴 주차라 저장되지 않았습니다.'
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
            reconnect();
            break;
          case 'locked':
            patch({ notice: '이 주차가 잠금 처리되었습니다.' });
            applyPermission({ locked: true, frozen: false });
            break;
          case 'unlocked':
            patch({ notice: '' });
            applyPermission({ locked: false, frozen: false });
            reconnect();
            break;
          case 'resynced':
            patch({ revision: Number(m.revision) || 0 });
            applyPermission({ locked: !!m.locked });
            break;
          case 'generation-changed':
            patch({ notice: '문서가 복원되었습니다. 새로고침해주세요.' });
            break;
          case 'stale-room':
            patch({ notice: '문서가 교체되었습니다. 새로고침해주세요.' });
            applyPermission({ frozen: true });
            break;
        }
      });

      patch({
        mode: 'realtime', legacyReason: '', doc, provider, origin, undo, localUser,
        master: first.master, locked: first.isLocked, frozen: false,
        // 쓰기 가능 여부는 토큰이 정한다. isLocked(취합완료)만 보면 작성마감 주차에서
        // 편집기가 열린 채로 Worker 가 모든 편집을 버려, 오류 없이 입력이 사라진다.
        readOnly: first.readOnly,
        revision: first.revision, peers: readPeers()
      });
    })().catch(() => toLegacy('실시간 편집에 연결하지 못했습니다. 기존 방식으로 작성합니다.'));

    return () => {
      disposed = true;
      undo?.destroy();
      provider?.destroy();
      doc?.destroy();
      setState(initial);
    };
    // userName 은 접속 중 바뀌지 않는다 — 넣으면 이름 로딩 시점에 룸이 재연결된다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId, year, weekNum, userId]);

  return state;
}

/**
 * Y.Doc 이 바뀔 때마다 다시 그리기 위한 구독.
 *
 * materialize 는 문서 전체를 훑으므로 키 입력마다 돌리면 큰 문서에서 눈에 띄게 느려진다.
 * 애니메이션 프레임 단위로 묶어 한 번만 계산한다.
 */
export function useDocSnapshot<T>(doc: Y.Doc | null, read: (d: Y.Doc) => T, empty: T): T {
  const [snapshot, setSnapshot] = useState<T>(empty);
  const readRef = useRef(read);
  readRef.current = read;

  useEffect(() => {
    if (!doc) { setSnapshot(empty); return; }
    let queued = 0;
    const recompute = () => {
      queued = 0;
      setSnapshot(readRef.current(doc));
    };
    const onChange = () => {
      if (queued) return;
      queued = requestAnimationFrame(recompute);
    };
    setSnapshot(readRef.current(doc));
    doc.on('update', onChange);
    return () => {
      doc.off('update', onChange);
      if (queued) cancelAnimationFrame(queued);
    };
    // empty 는 상수로 넘어온다 — 의존성에 넣으면 매 렌더 재구독한다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc]);

  return snapshot;
}

/**
 * Y.Text 를 textarea/input 에 묶는다. **한글 조합 중에는 원격 변경을 화면에 반영하지 않는다** —
 * 반영하면 조합이 깨져 글자가 튄다.
 *
 * 반영은 직전 로컬 값과의 차이만 계산해 넣는다. Y.Text 현재값과 비교하면
 * 그 사이 상대가 앞에 끼워 넣은 글자가 "내가 지운 것"으로 계산돼 사라진다.
 */
export function useYTextBinding(ytext: Y.Text | null, origin?: unknown) {
  const [value, setValue] = useState(() => ytext?.toString() ?? '');
  const [tracked, setTracked] = useState(ytext);
  const composing = useRef(false);
  const valueRef = useRef(value);
  /** 입력칸 DOM — 원격 변경을 얹은 뒤 내 커서를 제자리로 돌리는 데 쓴다 */
  const elRef = useRef<HTMLTextAreaElement | HTMLInputElement | null>(null);
  /** 다음 렌더에서 되돌릴 커서 위치 */
  const caret = useRef<{ start: number; end: number } | null>(null);

  if (tracked !== ytext) {
    setTracked(ytext);
    setValue(ytext?.toString() ?? '');
  }

  const commit = useCallback((v: string) => {
    valueRef.current = v;
    setValue(v);
  }, []);

  /**
   * 원격 변경을 화면에 얹는다.
   *
   * 제어 컴포넌트라 문자열이 바뀌면 React 가 DOM value 를 통째로 다시 넣고,
   * 브라우저는 그때 커서를 **문자열 끝**으로 보낸다. 문장 중간을 고치던 사람은
   * 팀원이 같은 칸을 건드리는 순간 커서를 잃고 글자가 끝에 가서 붙는다.
   * 그래서 바뀐 구간만큼만 커서를 밀어 두고, 그린 직후 되돌린다.
   */
  const commitRemote = useCallback((next: string) => {
    const el = elRef.current;
    if (el && el === document.activeElement && next !== valueRef.current) {
      const { index, removed, added } = textDiff(valueRef.current, next);
      const shift = added.length - removed;
      const map = (p: number) =>
        p <= index ? p : p >= index + removed ? p + shift : index + added.length;
      caret.current = { start: map(el.selectionStart ?? 0), end: map(el.selectionEnd ?? 0) };
    }
    commit(next);
  }, [commit]);

  useLayoutEffect(() => {
    const c = caret.current;
    caret.current = null;
    const el = elRef.current;
    if (c && el && el === document.activeElement) el.setSelectionRange(c.start, c.end);
  }, [value]);

  useEffect(() => {
    if (!ytext) { valueRef.current = ''; return; }
    const sync = () => { if (!composing.current) commitRemote(ytext.toString()); };
    ytext.observe(sync);
    sync();
    return () => ytext.unobserve(sync);
  }, [ytext, commitRemote]);

  const push = useCallback((next: string) => {
    const prev = valueRef.current;
    commit(next);
    if (!ytext || prev === next) return;
    applyLocalEdit(ytext, prev, next, origin);
  }, [ytext, commit, origin]);

  /**
   * 조합을 끝내고 문서 값으로 맞춘다.
   *
   * compositionend 가 오지 않는 경로가 있다(조합 중 마우스로 다른 칸 클릭, iOS WebView,
   * 잠금으로 입력칸이 통째로 사라지는 경우). 그때 플래그가 true 로 굳으면 이 칸은
   * 그 뒤로 원격 변경을 영영 반영하지 못하고, 다음 입력의 diff 기준까지 어긋난다.
   * 그래서 칸을 떠날 때도 반드시 풀어 준다.
   */
  const endComposing = useCallback(() => {
    if (!composing.current) return;
    composing.current = false;
    if (ytext) commit(ytext.toString());
  }, [ytext, commit]);

  const compositionProps = {
    onCompositionStart: () => { composing.current = true; },
    onCompositionEnd: endComposing
  };

  return { value, push, compositionProps, endComposing, elRef };
}

/**
 * 내가 친 구간을 문서에 반영한다.
 *
 * 한글 조합 중에는 원격 변경을 화면에 얹지 않는다(얹으면 조합이 깨진다). 그래서 그동안
 * **내 화면 좌표와 문서 좌표가 어긋난다** — 팀원이 내 앞에 글자를 넣었으면 내 화면의 3번째 칸이
 * 문서에서는 7번째다. 그 좌표로 그대로 쓰면 내 음절이 남의 문장 한가운데 박히고
 * 그 자리의 남의 글자가 지워진다("긴급 월간각계획"처럼 뒤엉킨다).
 *
 * 내 편집은 전부 즉시 문서로 나가므로 "내 화면 → 문서" 의 차이는 곧 **원격이 바꾼 구간**이다.
 * 그만큼만 내 위치를 옮겨서 넣는다.
 */
export function applyLocalEdit(ytext: Y.Text, prev: string, next: string, origin?: unknown): void {
  const { index, removed, added } = textDiff(prev, next);
  const doc = ytext.toString();

  let at = index;
  if (doc !== prev) {
    const remote = textDiff(prev, doc);
    // 내 편집 자리가 원격 변경 뒤쪽이면 그 길이 차이만큼 민다 (앞쪽이면 그대로)
    if (index > remote.index) {
      at = Math.max(remote.index, index + (remote.added.length - remote.removed));
    }
  }

  const len = ytext.length;
  at = Math.min(Math.max(at, 0), len);
  const del = Math.min(removed, len - at);
  if (del === 0 && !added) return;
  ytext.doc?.transact(() => {
    if (del > 0) ytext.delete(at, del);
    if (added) ytext.insert(at, added);
  }, origin);
}

const isLowSurrogate = (code: number) => code >= 0xdc00 && code <= 0xdfff;

/**
 * 두 문자열의 변경 구간. **코드포인트 경계**를 지킨다.
 * 코드유닛 단위로 자르면 이모지의 서로게이트 페어가 반쪽만 지워져
 * 화면이 깨질 뿐 아니라 JSON 직렬화에서 요청 자체가 거부된다.
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
