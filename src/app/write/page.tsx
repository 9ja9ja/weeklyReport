'use client';

import { useEffect, useState, useRef, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useHistory } from '@/lib/useHistory';
import { getPrevWeek, getDefaultWeek } from '@/lib/weekUtils';
import { useUser } from '@/lib/UserContext';
import { type ContentBlock, type SubBlock, isTableBlock } from '@/lib/reportBlocks';
import { TableBlockEditor, TableBlockView } from '@/components/TableBlock';
import { useSharedDoc, useDocSnapshot } from '@/components/useSharedDoc';
import { localWriteOps, sharedWriteOps, type WriteOps } from '@/components/writeOps';
import { usePresence, PART } from '@/components/usePresence';
import YTextArea from '@/components/YTextArea';
import { materialize } from '@/lib/realtime/materialize';
import { isCollabWeek, type TeamCollabRange } from '@/lib/collabWeek';
import { membersCanWriteAt, type SummaryStage } from '@/lib/summaryStage';

type CateData = { current: ContentBlock[], next: ContentBlock[] };
type EditorState = Record<number, CateData>;

interface PartRef { id: number; name: string; orderIdx: number; }
interface Category { id: number; major: string; middle: string; orderIdx: number; partId: number; part?: PartRef; }

// API 응답 타입
interface MajorResponse { id: number; name: string; orderIdx: number; partId: number; part?: PartRef; }

/** 파트 > 대분류 > 중분류 계층 */
interface MajorGroup { key: string; name: string; cats: Category[] }
interface PartGroup { id: number; name: string; majors: MajorGroup[] }

interface ReportItem {
  categoryId: number;
  currentContents: string | ContentBlock[];
  nextContents: string | ContentBlock[];
}

function WriteContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const paramYear = searchParams.get('year');
  const paramWeek = searchParams.get('weekNum');
  // 작성 대상은 언제나 로그인한 본인이다.
  // (URL 의 userId/name 은 무시한다 — 예전에는 이 값으로 남의 보고를 열 수 있었다)
  const { userId, userName, teamId, teams, isHydrating } = useUser();

  // 월·화는 지난주(전주 마감), 수~일은 이번주를 기본으로 연다
  const defaultWeek = getDefaultWeek();
  const [year, setYear] = useState(paramYear ? parseInt(paramYear, 10) : defaultWeek.year);
  const [weekNum, setWeekNum] = useState(paramWeek ? parseInt(paramWeek, 10) : defaultWeek.weekNum);

  // 겸직 지원: 소속 팀 전부의 분류를 미리 받아두고, 탭으로 전환하며 한 번에 저장한다.
  const [activeTeamId, setActiveTeamId] = useState<number | null>(null);
  const [catsByTeam, setCatsByTeam] = useState<Record<number, Category[]>>({});
  const [majorsByTeam, setMajorsByTeam] = useState<Record<number, MajorResponse[]>>({});
  /** 팀별 주차 단계 — 작성중 / 작성마감 / 취합완료 */
  const [stageByTeam, setStageByTeam] = useState<Record<number, SummaryStage>>({});

  // "이번 주 작성 없음" — 팀별로 따로 관리한다(겸직 탭마다 상태가 다를 수 있다)
  /** 팀별 "작성 없음" 선언 여부 */
  const [excuseByTeam, setExcuseByTeam] = useState<Record<number, boolean>>({});
  /** 팀별 "이미 작성한 내용이 있는가" (Report 또는 공동 편집 실제 편집 이력) */
  const [hasReportByTeam, setHasReportByTeam] = useState<Record<number, boolean>>({});
  /** 위 두 값을 그 팀에 대해 한 번이라도 조회했는가 — 조회 전에는 버튼을 보여주지 않는다 */
  const [excuseReadyByTeam, setExcuseReadyByTeam] = useState<Record<number, boolean>>({});
  /** 선언/취소 요청 처리 중 — 중복 클릭 방지 */
  const [excuseActing, setExcuseActing] = useState(false);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const categories = activeTeamId ? catsByTeam[activeTeamId] ?? [] : [];
  const majorList = activeTeamId ? majorsByTeam[activeTeamId] ?? [] : [];
  const stageOfActive = activeTeamId ? stageByTeam[activeTeamId] ?? 'open' : 'open';
  /** 작성마감·취합완료 모두 팀원 입력은 막힌다. 문구만 달라진다. */
  const lockedByApi = !membersCanWriteAt(stageOfActive);

  /** 지금 보고 있는 탭이 "작성 없음" 선언된 상태인가 */
  const excuseActive = activeTeamId != null && !!excuseByTeam[activeTeamId];
  const excuseReady = activeTeamId != null && !!excuseReadyByTeam[activeTeamId];
  const hasContentForActiveTeam = activeTeamId != null && !!hasReportByTeam[activeTeamId];
  /** "이번 주 작성 없음" 버튼을 보여줄 조건 — 작성중 단계 + 조회 완료 + 미선언 + 기존 작성 내용 없음 */
  const canDeclareExcuse = excuseReady && !excuseActive && !hasContentForActiveTeam && stageOfActive === 'open';

  /** categoryId → teamId 역매핑 (저장 시 잠긴 팀 항목을 걸러내려고) */
  const teamOfCategory = (() => {
    const m = new Map<number, number>();
    Object.entries(catsByTeam).forEach(([tid, cats]) => cats.forEach(c => m.set(c.id, parseInt(tid, 10))));
    return m;
  })();

  const [prevWeekData, setPrevWeekData] = useState<EditorState>({});
  /** 화면 표시용 잠금 — 공동 편집 중에는 룸이 알려주는 값이 우선이다(남이 잠그면 즉시) */
  const { state: reportData, setState: setReportData, undo, redo, canUndo, canRedo, setInitialState } = useHistory<EditorState>({});

  /** 팀별 공동 편집 구간 — 저장 시 공동 편집 팀을 빼내는 데 쓴다 */
  const [collabByTeam, setCollabByTeam] = useState<Record<number, TeamCollabRange>>({});
  const teamIsCollab = (tid: number) => {
    const r = collabByTeam[tid];
    return !!r && isCollabWeek(r, year, weekNum);
  };

  // 지금 보고 있는 탭의 공유 문서. 대상이 아니면 mode='legacy' 로 떨어져 기존 흐름이 그대로 돈다.
  const rt = useSharedDoc(activeTeamId, year, weekNum, userId, userName);
  const collab = rt.mode === 'realtime';
  const EMPTY_STATE: EditorState = {};
  const docState = useDocSnapshot(rt.doc, materialize, EMPTY_STATE) as EditorState;

  /** 누가 어느 칸을 쓰고 있는지 — 그 칸에 테두리와 이름표가 붙는다 */
  const presence = usePresence(rt.provider, collab);

  /** 화면에 그릴 데이터 — 공동 편집이면 문서에서, 아니면 기존 상태에서 */
  const blocksOf = (catId: number, side: 'current' | 'next'): ContentBlock[] =>
    (collab ? docState[catId]?.[side] : reportData[catId]?.[side]) ?? [];

  // 드래그는 id 로 잡는다 — 인덱스로 잡으면 끄는 동안 남이 항목을 추가했을 때 엉뚱한 게 옮겨진다
  const dragSubRef = useRef<{ catId: number; type: 'current'|'next'; blockId: string } | null>(null);
  const dragBulletRef = useRef<{ catId: number; type: 'current'|'next'; blockId: string; bulletId: string } | null>(null);
  const [dragOverSubId, setDragOverSubId] = useState<string | null>(null);
  const [dragOverBulletId, setDragOverBulletId] = useState<string | null>(null);

  useEffect(() => {
    if (isHydrating) return; // 세션 복원 전에는 판단하지 않는다
    if (!userId || !teamId) return router.push('/');
    setActiveTeamId(prev => (prev && teams.some(t => t.id === prev) ? prev : teamId));
    fetchAllTeamCategories().then(() => fetchReportsForWeek());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, teamId, year, weekNum, isHydrating]);

  // 실행취소 단축키. 공동 편집에서는 화면 상태를 통째로 되돌리면 남이 방금 쓴 것까지 지우므로
  // 내 변경만 되돌리는 UndoManager 를 쓴다.
  const undoRef = useRef<() => void>(() => {});
  const redoRef = useRef<() => void>(() => {});
  const editableRef = useRef(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!editableRef.current) return;
      if (e.ctrlKey && e.key === 'z') { e.preventDefault(); undoRef.current(); }
      if (e.ctrlKey && e.key === 'y') { e.preventDefault(); redoRef.current(); }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  /** 소속 팀 전부의 분류를 한 번에 받아둔다 */
  const fetchAllTeamCategories = async () => {
    const targets = teams.length > 0 ? teams.map(t => t.id) : teamId ? [teamId] : [];
    if (targets.length === 0) return;

    const results = await Promise.all(
      targets.map(async tid => {
        const [catRes, majRes] = await Promise.all([
          fetch(`/api/categories?teamId=${tid}`),
          fetch(`/api/majors?teamId=${tid}`)
        ]);
        const cd = await catRes.json();
        const md = await majRes.json();
        return { tid, cats: Array.isArray(cd) ? cd : [], majors: Array.isArray(md) ? md : [] };
      })
    );

    // 팀별 공동 편집 구간 — 저장 배치에서 공동 편집 팀을 빼야 한다
    try {
      const tRes = await fetch('/api/teams');
      const tData = await tRes.json();
      if (Array.isArray(tData)) {
        const map: Record<number, TeamCollabRange> = {};
        tData.forEach((t: TeamCollabRange & { id: number }) => { map[t.id] = t; });
        setCollabByTeam(map);
      }
    } catch { }

    const nextCats: Record<number, Category[]> = {};
    const nextMajors: Record<number, MajorResponse[]> = {};
    results.forEach(r => { nextCats[r.tid] = r.cats; nextMajors[r.tid] = r.majors; });
    setCatsByTeam(nextCats);
    setMajorsByTeam(nextMajors);
  };

  const fetchReportsForWeek = async () => {
    setLoading(true);
    try {
      // 소속 팀 전부의 진행 단계
      const lockRes = await fetch(`/api/reports/summary/lock?year=${year}&weekNum=${weekNum}&all=true`);
      const lockData = await lockRes.json();
      const stageMap: Record<number, SummaryStage> = {};
      if (Array.isArray(lockData)) {
        lockData.forEach((l: { teamId: number; isLocked: boolean; stage?: SummaryStage }) => {
          stageMap[l.teamId] = l.stage ?? (l.isLocked ? 'locked' : 'open');
        });
      }
      setStageByTeam(stageMap);

      const { year: prevY, weekNum: prevW } = getPrevWeek(year, weekNum);

      const prevRes = await fetch(`/api/reports?userId=${userId}&year=${prevY}&weekNum=${prevW}`);
      const prevData = await prevRes.json();

      const prevMap: EditorState = {};
      if (prevData?.items) {
        prevData.items.forEach((item: ReportItem) => {
          prevMap[item.categoryId] = {
            current: typeof item.currentContents === 'string' ? JSON.parse(item.currentContents) : item.currentContents,
            next: typeof item.nextContents === 'string' ? JSON.parse(item.nextContents) : item.nextContents,
          };
        });
      }
      setPrevWeekData(prevMap);

      const curRes = await fetch(`/api/reports?userId=${userId}&year=${year}&weekNum=${weekNum}`);
      const curData = await curRes.json();

      if (curData?.items && curData.items.length > 0) {
        const curMap: EditorState = {};
        curData.items.forEach((item: ReportItem) => {
          curMap[item.categoryId] = {
            current: typeof item.currentContents === 'string' ? JSON.parse(item.currentContents) : item.currentContents,
            next: typeof item.nextContents === 'string' ? JSON.parse(item.nextContents) : item.nextContents,
          };
        });
        setInitialState(curMap);
      } else {
        const curMap: EditorState = {};
        if (prevData?.items) {
          prevData.items.forEach((item: ReportItem) => {
            const lastNext = typeof item.nextContents === 'string' ? JSON.parse(item.nextContents) : item.nextContents;
            curMap[item.categoryId] = { current: lastNext, next: [] };
          });
        }
        setInitialState(curMap);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  /** 잠기지 않은 팀의 항목만 추린다 (여러 팀 내용을 한 번에 저장) */
  const buildSaveItems = () =>
    Object.keys(reportData)
      .map(k => parseInt(k, 10))
      .filter(catId => {
        const tid = teamOfCategory.get(catId);
        // 어느 팀인지 모르는 항목(비활성 처리된 중분류의 잔여분 등)은 보내지 않는다.
        // 보내면 서버가 그 팀을 공동 편집으로 판정해 요청 전체를 409 로 막아,
        // 같이 보낸 개인 작성 팀까지 저장이 실패한다.
        if (tid == null) return false;
        // 공동 편집 팀은 문서가 알아서 저장한다. 여기 섞으면 서버가 요청 전체를 거부해
        // 같이 보낸 개인 작성 팀까지 저장이 막힌다.
        if (teamIsCollab(tid)) return false;
        return membersCanWriteAt(stageByTeam[tid] ?? 'open');
      })
      .map(catId => ({
        categoryId: catId,
        currentContents: reportData[catId]?.current || [],
        nextContents: reportData[catId]?.next || []
      }));

  /** 저장 대상이 되는 팀 목록 */
  const saveTargetTeams = (() => {
    const ids = new Set<number>();
    buildSaveItems().forEach(i => { const t = teamOfCategory.get(i.categoryId); if (t != null) ids.add(t); });
    return teams.filter(t => ids.has(t.id));
  })();

  const saveReport = async () => {
    const items = buildSaveItems();

    // 공동 편집 탭은 이미 자동 저장되고 있다. 버튼은 디바운스를 기다리지 않고 지금 반영시킨다.
    // 다만 겸직자는 다른 탭에 개인 작성 팀이 있을 수 있다 — 그쪽은 여기서 저장하지 않으면
    // 아무 데도 저장되지 않으므로, 남아 있으면 기존 확인 모달로 이어간다.
    if (collab) {
      setSaving(true);
      let flushed = false;
      let detail = '';
      try {
        const res = await fetch('/api/realtime/flush', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ teamId: activeTeamId, year, weekNum })
        });
        const d = await res.json().catch(() => null);
        flushed = res.ok && d?.ok !== false;
        if (!flushed) detail = d?.error ?? '실시간 서버가 저장을 마치지 못했습니다.';
      } catch { detail = '저장에 실패했습니다.'; }
      finally { setSaving(false); }

      if (!flushed) {
        // 자동 저장은 계속 재시도되므로 문서를 잃은 것은 아니다. 다만 "저장됨"이라고
        // 알리면 안 된다 — 사용자가 확인된 줄 알고 창을 닫는다.
        alert(`${detail}\n\n편집 내용은 계속 자동 저장을 시도합니다. 상단 표시를 확인해주세요.`);
      } else if (items.length === 0) {
        alert('저장되었습니다.');
      }
      // 개인 작성 팀 항목이 남아 있으면 이어서 저장한다
      if (items.length > 0) setShowConfirm(true);
      return;
    }

    if (items.length === 0) {
      alert(isLocked
        ? (stageOfActive === 'closed'
            ? '이 주차는 작성이 마감되어 저장할 수 없습니다.'
            : '이 주차는 취합이 완료되어 저장할 수 없습니다.')
        : '저장할 내용이 없습니다.');
      return;
    }
    setShowConfirm(true);
  };

  const handleConfirmSave = async () => {
    setSaving(true);
    setShowConfirm(false);
    try {
      const items = buildSaveItems();

      const res = await fetch('/api/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year, weekNum, items })
      });
      if (res.ok) {
        alert('저장되었습니다.');
        // 저장 직후 재조회 없이도 "이번 주 작성 없음" 버튼이 곧바로 숨겨지도록,
        // 방금 실제로 내용을 저장한 팀들의 hasReport 를 로컬 상태에 바로 반영한다.
        // (활성 탭만이 아니라 겸직으로 함께 저장된 다른 팀도 포함)
        const savedTeamIds = new Set<number>();
        items.forEach(i => {
          const tid = teamOfCategory.get(i.categoryId);
          if (tid != null) savedTeamIds.add(tid);
        });
        if (savedTeamIds.size > 0) {
          setHasReportByTeam(prev => {
            const next = { ...prev };
            savedTeamIds.forEach(tid => { next[tid] = true; });
            return next;
          });
        }
      } else {
        const err = await res.json();
        alert(err.error || '저장 실패');
      }
    } catch (e) {
      alert('오류 발생');
    } finally {
      setSaving(false);
    }
  };

  // ── 편집 연산 ──────────────────────────────────────────────
  //
  // 개인 작성과 공동 편집이 같은 인터페이스를 쓴다. 블록은 **id 로** 가리킨다 —
  // 인덱스로 가리키면 공동 편집에서 남이 위에 항목을 추가한 순간 엉뚱한 블록을 고친다.
  /**
   * 지금 편집할 수 없는 상태인가.
   *
   * 실시간 여부가 정해지기 전(mode==='loading')에도 막는다. 그 사이 열어준 편집기는
   * 개인 이월본을 보여주는데, 공동 편집으로 판정되는 순간 화면이 문서 기준으로 갈아끼워져
   * 그때까지 친 내용이 저장 경로 없이 사라진다.
   */
  const readOnly = rt.mode === 'loading'
    ? true
    : collab ? (rt.readOnly || !rt.synced) : lockedByApi;

  // 공동 편집 주차는 룸 상태와 단계 중 하나라도 막혔으면 막힌 것으로 본다.
  // rt.locked 는 취합완료만 반영하므로, 마감 직후 새로 들어온 사람은 이 항으로 걸린다.
  const isLocked = collab ? (rt.locked || !membersCanWriteAt(stageOfActive)) : lockedByApi;

  // 지난주 참고본: 공동 편집으로 전환된 주차에는 개인 Report 가 없다.
  // 그대로 두면 "지난주 작성본"이 전원 빈칸으로 보인다 — 팀 취합본(공유 문서의 미러)을 쓴다.
  const [prevTeamData, setPrevTeamData] = useState<EditorState>({});
  useEffect(() => {
    if (!activeTeamId) return;
    const prev = getPrevWeek(year, weekNum);
    const range = collabByTeam[activeTeamId];
    if (!range || !isCollabWeek(range, prev.year, prev.weekNum)) { setPrevTeamData({}); return; }
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/reports/summary?teamId=${activeTeamId}&year=${prev.year}&weekNum=${prev.weekNum}`);
        const d = await res.json();
        if (alive) setPrevTeamData(d?.contents ? JSON.parse(d.contents) : {});
      } catch { if (alive) setPrevTeamData({}); }
    })();
    return () => { alive = false; };
  }, [activeTeamId, year, weekNum, collabByTeam]);

  // "이번 주 작성 없음" 상태 조회 — 페이지 진입 시 + 팀 탭 전환 시 + 연도/주차 변경 시.
  //
  // hasReport 는 /api/reports/status(마이 소속팀 고정) 대신 팀별로 정확히 조회되는
  // /api/users?withStatus 를 쓴다 — 겸직 탭(주 소속이 아닌 팀)에서도 그 팀 기준으로
  // 공동 편집 여부에 맞게(Report 또는 DocActivity) 판정해준다.
  useEffect(() => {
    if (!activeTeamId || !userId) return;
    let alive = true;
    (async () => {
      try {
        const [excRes, statusRes] = await Promise.all([
          fetch(`/api/reports/excuse?teamId=${activeTeamId}&year=${year}&weekNum=${weekNum}`),
          fetch(`/api/users?teamId=${activeTeamId}&withStatus=true&year=${year}&weekNum=${weekNum}`)
        ]);
        const excData = excRes.ok ? await excRes.json().catch(() => null) : null;
        const statusData = statusRes.ok ? await statusRes.json().catch(() => null) : null;
        if (!alive) return;
        const me = Array.isArray(statusData) ? statusData.find((u: { id: number }) => u.id === userId) : null;
        setExcuseByTeam(prev => ({ ...prev, [activeTeamId]: !!excData?.hasExcuse }));
        setHasReportByTeam(prev => ({ ...prev, [activeTeamId]: !!me?.hasReport }));
        setExcuseReadyByTeam(prev => ({ ...prev, [activeTeamId]: true }));
      } catch {
        // 조회 실패 시에는 버튼을 보여주지 않는다(ready=false 로 남겨둔다) — 확인 못 한 채
        // "작성 내용 없음"으로 잘못 단정해 버튼을 노출하지 않기 위해서다.
      }
    })();
    return () => { alive = false; };
  }, [activeTeamId, year, weekNum, userId]);

  /** "이번 주 작성 없음" 선언 */
  const handleDeclareExcuse = async () => {
    if (!activeTeamId || excuseActing) return;
    if (!confirm('이번 주는 작성할 내용이 없는 것으로 처리합니다.\n작성 화면 대신 "작성 없음" 안내가 표시됩니다. 계속하시겠습니까?')) return;
    setExcuseActing(true);
    try {
      const res = await fetch('/api/reports/excuse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teamId: activeTeamId, year, weekNum })
      });
      if (res.ok) {
        setExcuseByTeam(prev => ({ ...prev, [activeTeamId]: true }));
      } else {
        const err = await res.json().catch(() => null);
        alert(err?.error || '처리에 실패했습니다.');
      }
    } catch {
      alert('오류가 발생했습니다.');
    } finally {
      setExcuseActing(false);
    }
  };

  /** "취소하고 작성하기" — 선언 취소 후 정상 작성 모드로 복귀 */
  const handleCancelExcuse = async () => {
    if (!activeTeamId || excuseActing) return;
    setExcuseActing(true);
    try {
      const res = await fetch('/api/reports/excuse', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teamId: activeTeamId, year, weekNum })
      });
      if (res.ok) {
        setExcuseByTeam(prev => ({ ...prev, [activeTeamId]: false }));
      } else {
        const err = await res.json().catch(() => null);
        alert(err?.error || '취소에 실패했습니다.');
      }
    } catch {
      alert('오류가 발생했습니다.');
    } finally {
      setExcuseActing(false);
    }
  };

  /** 지난주 참고본 — 그 주차가 공동 편집이었으면 팀 문서, 아니면 내 개인 보고 */
  const prevBlocksOf = (catId: number, side: 'current' | 'next'): ContentBlock[] =>
    (prevTeamData[catId]?.[side] ?? prevWeekData[catId]?.[side]) ?? [];

  undoRef.current = () => (collab ? rt.undo?.undo() : undo());
  redoRef.current = () => (collab ? rt.undo?.redo() : redo());
  editableRef.current = !readOnly;

  const ops: WriteOps = collab && rt.doc
    ? sharedWriteOps(
        rt.doc, rt.origin, { authorId: userId ?? null, authorText: userName },
        docState, rt.readOnly || !rt.synced
      )
    : localWriteOps(setReportData as (u: (p: EditorState) => EditorState) => void, isLocked);

  /** 한쪽 열을 통째로 갈아끼우기 전 확인 — 공동 편집이면 남의 작업도 사라진다고 알린다 */
  const copyInto = (catId: number, side: 'current' | 'next', source: ContentBlock[], label: string) => {
    if (readOnly || source.length === 0) return;
    const warn = collab
      ? `기존 ${label} 내용을 덮어씁니다. 다른 팀원이 작성한 내용도 함께 사라집니다. 계속하시겠습니까?`
      : `기존 ${label} 내용을 덮어씁니다. 계속하시겠습니까?`;
    if (blocksOf(catId, side).length > 0 && !confirm(warn)) return;
    ops.copyBlocksInto(catId, side, source);
  };

  const copyCurrentToNext = (catId: number) =>
    copyInto(catId, 'next', blocksOf(catId, 'current'), '차주');

  /**
   * 지난 주 금주 진행사항을 이번 주 금주로 가져온다.
   *
   * 자동 이월은 "지난 주 차주 예정"을 이번 주 금주로 옮기는데, 금주 결과만 적고 차주 예정을
   * 비워두는 사람이 많아 그 경우 빈칸으로 시작한다. 같은 일을 이어서 쓰는 주에는 지난 주
   * 금주를 그대로 끌어오는 편이 빠르다.
   */
  const copyPrevCurrent = (catId: number) =>
    copyInto(catId, 'current', prevBlocksOf(catId, 'current'), '금주');

  // textarea 높이 자동 조절 헬퍼
  const handleTextareaResize = (e: React.FormEvent<HTMLTextAreaElement>) => {
    const t = e.currentTarget;
    t.style.height = 'auto';
    t.style.height = `${t.scrollHeight}px`;
  };

  // 데이터 로드 후 모든 textarea 높이 재계산 (double RAF: 레이아웃 완료 보장)
  useEffect(() => {
    if (loading) return;
    let cancelled = false;
    requestAnimationFrame(() => {
      if (cancelled) return;
      requestAnimationFrame(() => {
        if (cancelled) return;
        document.querySelectorAll<HTMLTextAreaElement>('.write-columns textarea, .inner-box textarea').forEach(ta => {
          ta.style.height = 'auto';
          ta.style.height = `${ta.scrollHeight}px`;
        });
      });
    });
    return () => { cancelled = true; };
  }, [loading]);

  const renderBlocks = (catId: number, type: 'current'|'next', blocks: ContentBlock[], isReadonly = false) => {
    const ro = isReadonly || readOnly;
    if (!blocks || blocks.length === 0) return <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>내용 없음</span>;

    // 표 블록은 번호(①②③)를 매기지 않는다 — 서술 항목만 순번을 센다.
    let subSeq = -1;

    return blocks.map((block, idx) => {
      if (isTableBlock(block)) {
        return ro
          ? <TableBlockView key={block.id} block={block} />
          : <TableBlockEditor
              key={block.id}
              block={block}
              onChange={() => { /* ops 를 주므로 통째 교체 경로는 쓰이지 않는다 */ }}
              ops={ops.tableOps(catId, type, block.id)}
              presence={ops.collaborative ? presence.block(catId, type, block.id) : undefined}
              // 제목은 Y.Text 에 직접 묶고, 행·열은 문서 id 를 key 로 준다 (공동 편집일 때만 값이 온다)
              captionText={ops.captionText(catId, type, block.id)}
              origin={rt.origin}
              rowKeys={ops.tableKeys(catId, type, block.id)?.rows}
              colKeys={ops.tableKeys(catId, type, block.id)?.cols}
              onRemove={() => ops.removeBlock(catId, type, block.id)}
            />;
      }
      subSeq += 1;
      return renderSubBlock(catId, type, block, idx, subSeq, ro);
    });
  };

  const renderSubBlock = (catId: number, type: 'current'|'next', block: SubBlock, idx: number, seq: number, ro: boolean) => {
    // 공동 편집일 때만 편집 위치를 주고받는다
    const bp = ops.collaborative ? presence.block(catId, type, block.id) : null;
    return (
      <div key={block.id} draggable={!ro}
        onDragStart={e => { e.stopPropagation(); dragSubRef.current = { catId, type, blockId: block.id }; (e.currentTarget as HTMLElement).classList.add('dragging'); }}
        onDragEnd={e => { (e.currentTarget as HTMLElement).classList.remove('dragging'); setDragOverSubId(null); }}
        onDragOver={e => { e.preventDefault(); e.stopPropagation(); setDragOverSubId(block.id); }}
        onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverSubId(null); }}
        onDrop={e => { e.preventDefault(); e.stopPropagation(); const d = dragSubRef.current; if (d && d.catId === catId && d.type === type && d.blockId !== block.id) ops.moveBlock(catId, type, d.blockId, block.id); dragSubRef.current = null; setDragOverSubId(null); }}
        className={`drag-block${dragOverSubId === block.id && dragSubRef.current?.blockId !== block.id ? ' drag-over' : ''}`}
        style={{ marginBottom: '0.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
          {!ro && <span className="drag-handle" title="드래그하여 순서 변경">⠿</span>}
          <span style={{ fontWeight: 700, minWidth: '1.4rem', color: 'var(--primary)', fontSize: '1rem', flexShrink: 0 }}>{seq < 10 ? `①②③④⑤⑥⑦⑧⑨⑩`[seq] : `(${seq+1})`}</span>
          {ro ? (
            <div style={{ flex: 1, padding: '0.4rem 0.2rem', fontWeight: 600, fontSize: '0.88rem', whiteSpace: 'pre-wrap', wordBreak: 'break-word', minHeight: '34px' }}>{block.subText}</div>
          ) : (
            ops.collaborative ? (
              <YTextArea
                ytext={ops.subText(catId, type, block.id)}
                origin={rt.origin}
                readOnly={readOnly}
                peers={bp?.peers(PART.sub)}
                {...bp?.focusProps(PART.sub)}
                placeholder="소분류 내용을 입력하세요..."
                className="input-field"
                style={{ flex: 1, borderTop: 'none', borderLeft: 'none', borderRight: 'none', fontWeight: 600, resize: 'none', minHeight: '34px', overflow: 'hidden', fontSize: '0.88rem', lineHeight: '1.4' }}
              />
            ) : (
              <textarea value={block.subText} onChange={e => ops.setSubText(catId, type, block.id, e.target.value)} className="input-field" placeholder="소분류 내용을 입력하세요..." rows={1}
                onInput={handleTextareaResize}
                style={{ flex: 1, borderTop: 'none', borderLeft: 'none', borderRight: 'none', fontWeight: 600, resize: 'none', minHeight: '34px', overflow: 'hidden', fontSize: '0.88rem', lineHeight: '1.4' }} />
            )
          )}
          {!ro && <>
            <button onClick={() => ops.addBullet(catId, type, block.id)} className="icon-btn add" title="항목 추가">+ 항목</button>
            <button onClick={() => ops.removeBlock(catId, type, block.id)} className="icon-btn del" title="소분류 삭제">✕</button>
          </>}
        </div>
        {block.bullets.map(bul => (
          <div key={bul.id} draggable={!ro}
            onDragStart={e => { e.stopPropagation(); dragBulletRef.current = { catId, type, blockId: block.id, bulletId: bul.id }; (e.currentTarget as HTMLElement).classList.add('dragging'); }}
            onDragEnd={e => { (e.currentTarget as HTMLElement).classList.remove('dragging'); setDragOverBulletId(null); }}
            onDragOver={e => { e.preventDefault(); e.stopPropagation(); setDragOverBulletId(bul.id); }}
            onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverBulletId(null); }}
            onDrop={e => { e.preventDefault(); e.stopPropagation(); const d = dragBulletRef.current; if (d && d.catId === catId && d.type === type && d.blockId === block.id && d.bulletId !== bul.id) ops.moveBullet(catId, type, block.id, d.bulletId, bul.id); dragBulletRef.current = null; setDragOverBulletId(null); }}
            className={`drag-block${dragOverBulletId === bul.id && dragBulletRef.current?.bulletId !== bul.id ? ' drag-over' : ''}`}
            style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', paddingLeft: '1.8rem', marginTop: '0.2rem' }}>
            {!ro && <span className="drag-handle" style={{ fontSize: '0.75rem' }}>⠿</span>}
            <span style={{ fontWeight: 600, color: 'var(--text-muted)', flexShrink: 0 }}>-</span>
            {ro ? (
              <div style={{ flex: 1, padding: '0.25rem 0.5rem', fontSize: '0.88rem', whiteSpace: 'pre-wrap', wordBreak: 'break-word', minHeight: '30px' }}>{bul.text}</div>
            ) : (
              ops.collaborative ? (
                <YTextArea
                  ytext={ops.bulletText(catId, type, block.id, bul.id)}
                  origin={rt.origin}
                  readOnly={readOnly}
                  peers={bp?.peers(PART.bullet(bul.id))}
                  {...bp?.focusProps(PART.bullet(bul.id))}
                  placeholder="내용을 입력하세요..."
                  className="input-field"
                  style={{ flex: 1, borderTop: 'none', borderLeft: 'none', borderRight: 'none', borderBottomStyle: 'dashed', borderBottomWidth: '1px', fontSize: '0.88rem', resize: 'none', minHeight: '30px', overflow: 'hidden' }}
                />
              ) : (
                <textarea value={bul.text} onChange={e => ops.setBulletText(catId, type, block.id, bul.id, e.target.value)} className="input-field" placeholder="내용을 입력하세요..." rows={1}
                  onInput={handleTextareaResize}
                  style={{ flex: 1, borderTop: 'none', borderLeft: 'none', borderRight: 'none', borderBottomStyle: 'dashed', borderBottomWidth: '1px', fontSize: '0.88rem', resize: 'none', minHeight: '30px', overflow: 'hidden' }} />
              )
            )}
            {!ro && <button onClick={() => ops.removeBullet(catId, type, block.id, bul.id)} className="icon-btn del">✕</button>}
          </div>
        ))}
      </div>
    );
  };

  // 파트 > 대분류 > 중분류 계층 구성
  // 대분류 이름은 파트가 다르면 중복될 수 있으므로 (partId, major)로 구분한다.
  /**
   * + 소분류 / + 표 버튼 묶음.
   *
   * 컴포넌트로 만들지 않고 함수로 둔다. 렌더 함수 안에서 컴포넌트를 정의하면 매 렌더마다
   * 새 타입이 되어 React 가 서브트리를 리마운트하는데, 공동 편집에서는 원격 입력마다
   * 리렌더되므로 mousedown 과 mouseup 사이에 버튼이 교체돼 클릭이 삼켜진다.
   */
  const addBlockBar = (catId: number, type: 'current'|'next') => (
    <div style={{ display: 'flex', gap: '0.4rem', marginTop: '1.5rem' }}>
      <button onClick={() => ops.addSub(catId, type)} className="btn" style={{ fontSize: '0.8rem', background: 'var(--btn-bg)', color: 'var(--foreground)', flex: 1 }}>+ 소분류 추가</button>
      <button onClick={() => ops.addTable(catId, type)} className="btn" style={{ fontSize: '0.8rem', background: 'var(--btn-bg)', color: 'var(--foreground)', width: '112px' }}>+ 표 추가</button>
    </div>
  );

  /** 컨펌 모달용 요약 렌더 (표 포함) */
  const renderConfirmBlocks = (blocks: ContentBlock[]) => {
    if (blocks.length === 0) return <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>내용 없음</span>;
    let seq = -1;
    return blocks.map(b => {
      if (isTableBlock(b)) return <TableBlockView key={b.id} block={b} />;
      seq += 1;
      const mark = seq < 10 ? `①②③④⑤⑥⑦⑧⑨⑩`[seq] : `(${seq + 1})`;
      return (
        <div key={b.id} style={{ marginBottom: '0.4rem' }}>
          <div style={{ fontWeight: 600, fontSize: '0.88rem' }}>{mark} {b.subText}</div>
          {b.bullets.map(x => <div key={x.id} style={{ paddingLeft: '1.5rem', fontSize: '0.85rem', color: 'var(--text-muted)' }}>- {x.text}</div>)}
        </div>
      );
    });
  };

  const partGroups: PartGroup[] = (() => {
    const byPart = new Map<number, PartGroup>();
    majorList.forEach(m => {
      const pid = m.partId;
      if (!byPart.has(pid)) {
        byPart.set(pid, { id: pid, name: m.part?.name ?? '', majors: [] });
      }
      byPart.get(pid)!.majors.push({
        key: `${pid}:${m.name}`,
        name: m.name,
        cats: categories.filter(c => c.partId === pid && c.major === m.name)
      });
    });
    return Array.from(byPart.values());
  })();

  /** 파트가 1개뿐이고 이름이 팀과 사실상 같은 경우 파트 헤더를 감춘다 */
  const showPartHeader = partGroups.length > 1;

  if (!userId || !teamId) return null;

  /** 특정 팀의 파트 계층 (컨펌 모달에서 팀별로 묶어 보여주려고) */
  const buildPartGroups = (tid: number): PartGroup[] => {
    const byPart = new Map<number, PartGroup>();
    (majorsByTeam[tid] ?? []).forEach(m => {
      if (!byPart.has(m.partId)) byPart.set(m.partId, { id: m.partId, name: m.part?.name ?? '', majors: [] });
      byPart.get(m.partId)!.majors.push({
        key: `${m.partId}:${m.name}`,
        name: m.name,
        cats: (catsByTeam[tid] ?? []).filter(c => c.partId === m.partId && c.major === m.name)
      });
    });
    return Array.from(byPart.values());
  };

  // 컨펌 모달용 — 저장 대상 팀별로 묶는다
  const getConfirmGroups = () =>
    saveTargetTeams.map(team => ({
      team,
      parts: buildPartGroups(team.id)
        .map(p => ({
          part: p,
          majors: p.majors
            .map(mg => ({
              ...mg,
              cats: mg.cats
                .map(cat => ({
                  cat,
                  current: reportData[cat.id]?.current || [],
                  next: reportData[cat.id]?.next || []
                }))
                .filter(c => c.current.length > 0 || c.next.length > 0)
            }))
            .filter(mg => mg.cats.length > 0)
        }))
        .filter(p => p.majors.length > 0)
    })).filter(t => t.parts.length > 0);

  return (
    <div style={{ marginTop: '2rem' }}>
      {/* 단계 배너 — 작성마감과 취합완료는 둘 다 조회 전용이지만 뜻이 다르다.
          작성마감은 "팀장이 취합 정리 중", 취합완료는 "이번 주차 끝". */}
      {isLocked && (
        <div style={{
          background: stageOfActive === 'closed' ? 'rgba(217,119,6,0.10)' : '#fef2f2',
          border: `1px solid ${stageOfActive === 'closed' ? '#d97706' : '#fca5a5'}`,
          borderRadius: '8px', padding: '1rem 1.5rem', marginBottom: '1rem',
          display: 'flex', alignItems: 'center', gap: '0.5rem',
          color: stageOfActive === 'closed' ? '#92400e' : '#dc2626', fontWeight: 600
        }}>
          ▣ {teams.length > 1 ? `${teams.find(t => t.id === activeTeamId)?.name ?? ''} 팀은 ` : ''}
          {stageOfActive === 'closed'
            ? '이 주차 작성이 마감되었습니다. 팀장이 취합본을 정리하는 중이라 조회만 가능합니다.'
            : '이 주차 취합이 완료되었습니다. 조회만 가능합니다.'}
          {teams.length > 1 && <span style={{ fontWeight: 400, fontSize: '0.85rem' }}>다른 탭은 계속 작성할 수 있습니다.</span>}
        </div>
      )}

      {/* "이번 주 작성 없음" 안내 — 경고가 아니라 확인용이라 위 잠금 배너와는 다른(차분한) 톤을 쓴다 */}
      {excuseActive && (
        <div style={{
          background: 'var(--primary-alpha-subtle)', border: '1px solid var(--primary)',
          borderRadius: '8px', padding: '1rem 1.5rem', marginBottom: '1rem',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.8rem'
        }}>
          <span style={{ color: 'var(--foreground)', fontWeight: 600 }}>
            ▣ {teams.length > 1 ? `${teams.find(t => t.id === activeTeamId)?.name ?? ''} 팀 — ` : ''}
            이번 주 작성 없음으로 처리되었습니다.
          </span>
          {stageOfActive === 'open' && (
            <button onClick={handleCancelExcuse} disabled={excuseActing} className="btn" style={{ fontSize: '0.85rem' }}>
              {excuseActing ? '처리중...' : '취소하고 작성하기'}
            </button>
          )}
        </div>
      )}

      {/* 실시간 여부를 판정하는 동안에는 편집을 막고 그 사실을 알린다.
          아무 표시 없이 편집기를 열어두면 저장 경로 없는 입력이 쌓인다. */}
      {rt.mode === 'loading' && (
        <div className="brief-live-bar" style={{ marginBottom: '1rem' }}>
          <span className="brief-live-dot" />
          <span className="brief-live-label">작성 방식을 확인하는 중입니다...</span>
        </div>
      )}
      {rt.mode === 'legacy' && rt.legacyReason && (
        <div style={{ background: 'var(--danger-alpha)', border: '1px solid #fca5a5', borderRadius: '8px', padding: '0.8rem 1.2rem', marginBottom: '1rem', color: '#dc2626', fontSize: '0.9rem' }}>
          {rt.legacyReason}
        </div>
      )}

      {collab && (
        <div className="brief-live-bar" style={{ marginBottom: '1rem' }}>
          <span className={`brief-live-dot${rt.connected && rt.synced ? ' on' : ''}`} />
          <span className="brief-live-label">
            {!rt.connected ? '연결 중...' : !rt.synced ? '문서 받는 중...' : '팀원과 함께 작성 중'}
          </span>
          <div className="brief-peers">
            {rt.peers.map(p => (
              <span key={p.uid} className="brief-peer" style={{ borderColor: p.color, color: p.color }}>
                {p.name || '익명'}
              </span>
            ))}
          </div>
          <span className="brief-live-saved">
            {rt.notice || (rt.savedAt ? '자동 저장됨' : '')}
          </span>
        </div>
      )}

      <div className="glass-panel write-header" style={{ padding: '2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <div>
          <h2 style={{ marginBottom: '0.5rem' }}>{userName}님의 주간보고</h2>
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
            {/* 타이핑 중간값(예: 53 을 치다가 5)으로 엉뚱한 주차 문서가 만들어지지 않게
                입력을 마친 뒤(blur/Enter)에만 반영한다 */}
            <label>연도: <input type="number" defaultValue={year} key={`y${year}`}
              onBlur={e => { const v = parseInt(e.target.value, 10); if (v >= 2000 && v <= 2100) setYear(v); else e.target.value = String(year); }}
              onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
              className="input-field" style={{ width: '80px', marginLeft: '0.5rem', padding: '0.3rem' }} /></label>
            <label>주차: <input type="number" defaultValue={weekNum} key={`w${weekNum}`}
              onBlur={e => { const v = parseInt(e.target.value, 10); if (v >= 1 && v <= 53) setWeekNum(v); else e.target.value = String(weekNum); }}
              onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
              className="input-field" style={{ width: '80px', marginLeft: '0.5rem', padding: '0.3rem' }} /></label>
          </div>
          {canDeclareExcuse && (
            <button
              onClick={handleDeclareExcuse}
              disabled={excuseActing}
              style={{
                marginTop: '0.7rem', background: 'none', border: 'none', padding: 0,
                color: 'var(--text-muted)', fontSize: '0.82rem', textDecoration: 'underline', cursor: 'pointer'
              }}
            >
              이번 주 작성 없음
            </button>
          )}
        </div>
        <div className="write-actions" style={{ display: 'flex', gap: '1rem' }}>
          {/* 공동 편집에서는 화면 상태를 통째로 되돌리면 남이 방금 쓴 것까지 지운다.
              Y.UndoManager 가 내 변경만 되돌린다. */}
          <button
            onClick={() => { if (readOnly) return; if (collab) rt.undo?.undo(); else undo(); }}
            disabled={readOnly || (collab ? !rt.undo : !canUndo)}
            className="btn" style={{ fontSize: '0.9rem' }}
          >↶ 실행취소</button>
          <button
            onClick={() => { if (readOnly) return; if (collab) rt.undo?.redo(); else redo(); }}
            disabled={readOnly || (collab ? !rt.undo : !canRedo)}
            className="btn" style={{ fontSize: '0.9rem' }}
          >↷ 다시실행</button>
          <button className="btn btn-primary" onClick={saveReport} disabled={saving} style={{ padding: '0.8rem 2rem', fontSize: '1.1rem' }}>
            {saving ? '저장중...' : collab ? '저장' : teams.length > 1 ? '전체 저장' : '저장하기'}
          </button>
        </div>
      </div>

      {/* 소속 팀 탭 — 겸직자는 탭을 오가며 작성하고 한 번에 저장한다 */}
      {teams.length > 1 && (
        <div style={{ display: 'flex', gap: '0.3rem', marginBottom: '1.5rem', flexWrap: 'wrap', borderBottom: '2px solid var(--border)', paddingBottom: '0' }}>
          {teams.map(t => {
            const active = t.id === activeTeamId;
            const locked = !membersCanWriteAt(stageByTeam[t.id] ?? 'open');
            // 공동 편집 팀은 지금 보고 있는 탭만 문서가 열려 있다 — 그 탭은 문서 기준으로 센다
            const source = t.id === activeTeamId && collab ? docState : reportData;
            const edited = Object.keys(source).some(k => {
              const tid = teamOfCategory.get(parseInt(k, 10));
              if (tid !== t.id) return false;
              const d = source[parseInt(k, 10)];
              return (d?.current?.length ?? 0) > 0 || (d?.next?.length ?? 0) > 0;
            });
            return (
              <button
                key={t.id}
                onClick={() => setActiveTeamId(t.id)}
                style={{
                  border: '1px solid var(--border)',
                  borderBottom: active ? '2px solid var(--primary)' : '1px solid var(--border)',
                  borderRadius: '6px 6px 0 0',
                  background: active ? 'var(--primary)' : 'var(--btn-bg)',
                  color: active ? 'white' : 'var(--foreground)',
                  fontWeight: active ? 700 : 500,
                  fontSize: '0.9rem',
                  padding: '0.5rem 1rem',
                  cursor: 'pointer',
                  marginBottom: '-2px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.35rem'
                }}
              >
                {t.name}
                {!t.isPrimary && (
                  <span style={{ fontSize: '0.62rem', opacity: 0.75, border: '1px solid currentColor', borderRadius: '3px', padding: '0 0.25rem' }}>겸직</span>
                )}
                {locked && <span title="잠금" style={{ fontSize: '0.7rem' }}>{'\u{1F512}'}</span>}
                {edited && !locked && (
                  <span title="작성된 내용 있음" style={{ width: '6px', height: '6px', borderRadius: '50%', background: active ? 'white' : '#16a34a' }} />
                )}
              </button>
            );
          })}
        </div>
      )}

      {loading ? <p>로딩중...</p> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
          {excuseActive ? (
            <div className="glass-panel" style={{ padding: '3rem 2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
              <p style={{ fontSize: '0.95rem' }}>이번 주는 &quot;작성 없음&quot;으로 처리되어 있습니다.</p>
              <p style={{ fontSize: '0.85rem', marginTop: '0.4rem' }}>
                {stageOfActive === 'open'
                  ? '작성할 내용이 생기면 위의 [취소하고 작성하기] 버튼을 눌러주세요.'
                  : '작성 기간이 마감되어 취소할 수 없습니다.'}
              </p>
            </div>
          ) : partGroups.map(part => (
            <div key={part.id} className="glass-panel" style={{ padding: '2rem' }}>
              {showPartHeader && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '1.5rem', paddingBottom: '0.6rem', borderBottom: '3px solid var(--primary)' }}>
                  <span style={{ fontSize: '0.7rem', fontWeight: 700, color: 'white', background: 'var(--primary)', borderRadius: '3px', padding: '0.15rem 0.5rem' }}>파트</span>
                  <h3 style={{ fontSize: '1.35rem', margin: 0 }}>{part.name}</h3>
                </div>
              )}
              {part.majors.map(mg => (
                <div key={mg.key} style={{ marginBottom: '2rem' }}>
                  <h3 style={{ fontSize: '1.15rem', color: 'var(--primary)', marginBottom: '1.5rem', borderBottom: '2px solid var(--border)', paddingBottom: '0.5rem' }}>{mg.name}</h3>
                  {mg.cats.length === 0 && (
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', paddingLeft: '0.5rem' }}>등록된 중분류가 없습니다.</p>
                  )}
                  {mg.cats.map((cat, idx) => (
                  <div key={cat.id} style={{ marginBottom: '2rem' }}>
                    <div style={{ fontWeight: 600, fontSize: '1.1rem', marginBottom: '1rem', background: 'var(--surface-dim)', padding: '0.5rem 1rem', borderRadius: '4px' }}>
                      ({idx + 1}) {cat.middle}
                    </div>
                    <div className="write-columns">
                      <div className="inner-box write-col-prev" style={{ background: 'var(--surface-dim)' }}>
                        <h4 style={{ color: 'var(--text-muted)', marginBottom: '1.2rem', fontWeight: 700, fontSize: '0.9rem', opacity: 0.7 }}>[지난 주 작성본]</h4>
                        <div style={{ marginBottom: '1.5rem' }}>
                          <h5 style={{ marginBottom: '1rem', fontSize: '0.95rem', borderLeft: '3px solid var(--border)', paddingLeft: '0.5rem' }}>금주 진행사항</h5>
                          {renderBlocks(cat.id, 'current', prevBlocksOf(cat.id, 'current'), true)}
                        </div>
                        <div>
                          <h5 style={{ marginBottom: '1rem', fontSize: '0.95rem', borderLeft: '3px solid var(--border)', paddingLeft: '0.5rem' }}>차주 진행예정사항</h5>
                          {renderBlocks(cat.id, 'next', prevBlocksOf(cat.id, 'next'), true)}
                        </div>
                      </div>
                      <div className="inner-box" style={{ borderTopColor: 'var(--primary)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.4rem', marginBottom: '1.2rem' }}>
                          <h4 style={{ color: 'var(--primary)', fontWeight: 800, fontSize: '0.95rem', margin: 0 }}>[이번 주] 금주 진행사항</h4>
                          {/* 차주 예정을 안 적고 마감하는 사람이 많아 자동 이월이 빈칸으로 온다.
                              같은 일을 이어 쓰는 주에는 지난 주 금주를 그대로 끌어오는 게 빠르다. */}
                          {!readOnly && prevBlocksOf(cat.id, 'current').length > 0 && (
                            <button onClick={() => copyPrevCurrent(cat.id)} className="btn" title="[지난 주 작성본]의 금주 진행사항을 그대로 가져옵니다" style={{ fontSize: '0.7rem', padding: '0.15rem 0.5rem', whiteSpace: 'nowrap', background: 'var(--btn-bg)', color: 'var(--foreground)', border: '1px solid var(--border)' }}>← 전주 금주 복사</button>
                          )}
                        </div>
                        {renderBlocks(cat.id, 'current', blocksOf(cat.id, 'current'))}
                        {!readOnly && addBlockBar(cat.id, 'current')}
                      </div>
                      <div className="inner-box" style={{ borderTopColor: 'var(--primary)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.2rem' }}>
                          <h4 style={{ color: 'var(--primary)', fontWeight: 800, fontSize: '0.95rem', margin: 0 }}>[이번 주] 차주 진행예정사항</h4>
                          {!readOnly && blocksOf(cat.id, 'current').length > 0 && (
                            <button onClick={() => copyCurrentToNext(cat.id)} className="btn" style={{ fontSize: '0.7rem', padding: '0.15rem 0.5rem', background: 'var(--btn-bg)', color: 'var(--foreground)', border: '1px solid var(--border)' }}>📋 금주내용 복사</button>
                          )}
                        </div>
                        {renderBlocks(cat.id, 'next', blocksOf(cat.id, 'next'))}
                        {!readOnly && addBlockBar(cat.id, 'next')}
                      </div>
                    </div>
                  </div>
                  ))}
                </div>
              ))}
            </div>
          ))}

          {/* 최종 컨펌 모달 - 2컬럼 리디자인 */}
          {showConfirm && (
            <div className="modal-overlay">
              <div className="modal-content" style={{ maxWidth: '1100px' }}>
                <div className="modal-header">
                  <h3 style={{ margin: 0 }}>최종 컨펌 (저장 전 확인)</h3>
                  <button className="icon-btn" onClick={() => setShowConfirm(false)}>✕</button>
                </div>
                <div className="modal-body" style={{ maxHeight: '70vh', overflowY: 'auto' }}>
                  <p style={{ marginBottom: '1.5rem', fontWeight: 600, color: 'var(--text-muted)', textAlign: 'center' }}>
                    아래 내용을 최종적으로 확인해 주세요.
                  </p>
                  {getConfirmGroups().map(tg => (
                    <div key={tg.team.id} style={{ marginBottom: '2.5rem' }}>
                      {teams.length > 1 && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.8rem', paddingBottom: '0.4rem', borderBottom: '2px solid var(--primary)' }}>
                          <span style={{ fontSize: '0.65rem', fontWeight: 700, color: 'white', background: 'var(--primary)', borderRadius: '3px', padding: '0.1rem 0.4rem' }}>팀</span>
                          <span style={{ fontWeight: 700, fontSize: '1.05rem' }}>{tg.team.name}</span>
                          {!tg.team.isPrimary && <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>겸직</span>}
                        </div>
                      )}
                      {tg.parts.map(pg => (
                    <div key={pg.part.id} style={{ marginBottom: '2rem' }}>
                      {tg.parts.length > 1 && (
                        <div style={{ fontWeight: 700, fontSize: '0.8rem', color: 'var(--text-muted)', letterSpacing: '0.5px', marginBottom: '0.5rem' }}>
                          파트 · {pg.part.name}
                        </div>
                      )}
                      {pg.majors.map(group => (
                    <div key={group.key} style={{ marginBottom: '1.5rem' }}>
                      <div style={{ background: 'var(--primary)', color: 'white', padding: '0.5rem 1rem', borderRadius: '6px 6px 0 0', fontWeight: 700, fontSize: '1.05rem' }}>{group.name}</div>
                      {group.cats.map(({ cat, current, next }, cIdx) => (
                        <div key={cat.id} style={{ border: '1px solid var(--border)', borderTop: 'none', padding: '1rem' }}>
                          <div style={{ fontWeight: 700, marginBottom: '0.8rem', fontSize: '0.95rem', color: 'var(--primary)' }}>({cIdx + 1}) {cat.middle}</div>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
                            {/* 금주 */}
                            <div>
                              <div style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '0.5rem', borderBottom: '1px solid var(--border)', paddingBottom: '0.3rem' }}>금주 진행사항</div>
                              {renderConfirmBlocks(current)}
                            </div>
                            {/* 차주 */}
                            <div>
                              <div style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '0.5rem', borderBottom: '1px solid var(--border)', paddingBottom: '0.3rem' }}>차주 진행예정사항</div>
                              {renderConfirmBlocks(next)}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                      ))}
                    </div>
                      ))}
                    </div>
                  ))}
                </div>
                <div className="modal-footer">
                  <button className="btn" onClick={() => setShowConfirm(false)}>수정하기</button>
                  <button className="btn btn-primary" onClick={handleConfirmSave} disabled={saving}>
                    {saving ? '저장중...' : '최종 확인 및 저장'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function WritePage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <WriteContent />
    </Suspense>
  );
}
