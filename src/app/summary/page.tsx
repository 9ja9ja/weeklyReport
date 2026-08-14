'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useHistory } from '@/lib/useHistory';
import { useUser } from '@/lib/UserContext';
import { canMasterEditAt, type SummaryStage } from '@/lib/summaryStage';
import { getNextWeek, getDefaultWeek } from '@/lib/weekUtils';
import {
  type ContentBlock, type SubBlock, type TableBlock,
  isTableBlock, generateId, createSubBlock, createTableBlock,
  tableToText, tableToHtml
} from '@/lib/reportBlocks';
import { TableBlockEditor, TableBlockView } from '@/components/TableBlock';

type CateData = { current: ContentBlock[]; next: ContentBlock[] };
type EditorState = Record<number, CateData>;

interface PartRef { id: number; name: string; orderIdx: number; }
interface Category { id: number; major: string; middle: string; orderIdx: number; partId: number; part?: PartRef; }
interface MajorInfo { id: number; name: string; orderIdx: number; partId: number; part?: PartRef; }

/** 파트 > 대분류 > 중분류 */
interface MajorGroup { key: string; name: string; partId: number; cats: Category[] }
interface PartGroup { id: number; name: string; majors: MajorGroup[] }

/** 테이블 한 줄 — 파트/대분류 셀은 첫 행에서만 rowSpan 으로 렌더 */
interface SummaryRow {
  cat: Category;
  midIdx: number;
  partName?: string;
  partRowSpan?: number;
  /** 파트명과 대분류명이 같아 두 칸을 하나로 합칠 때 */
  mergePartMajor?: boolean;
  majorName?: string;
  majorRowSpan?: number;
  majorKey: string;
}

// API 응답 타입
interface ReportItem {
  categoryId: number;
  currentContents: string | ContentBlock[];
  nextContents: string | ContentBlock[];
}

/**
 * 내용에 맞춰 textarea 높이를 잡는다.
 *
 * **모듈 스코프에 둔다** — 컴포넌트 안에서 정의하면 매 렌더 함수 정체성이 바뀌어
 * ref={autoResize} 가 화면의 모든 입력칸에서 해제·부착을 반복하며 강제 레이아웃을 일으킨다
 * (항목이 많은 취합본에서 키 입력마다 눈에 띄게 밀린다).
 */
const autoResize = (el: HTMLTextAreaElement | null) => {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
};

/** 화면의 모든 입력칸 높이를 다시 잡는다 (값이 입력 이벤트 없이 바뀐 뒤에 쓴다) */
const resizeAllTextareas = () => {
  document.querySelectorAll<HTMLTextAreaElement>('.summary-table textarea').forEach(autoResize);
};

export default function SummaryPage() {
  // 월·화는 지난주, 수~일은 이번주로 연다
  const defaultWeek = getDefaultWeek();
  const [year, setYear] = useState(defaultWeek.year);
  const [weekNum, setWeekNum] = useState(defaultWeek.weekNum);
  const [categories, setCategories] = useState<Category[]>([]);
  const [majors, setMajors] = useState<MajorInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  /** 주차 단계 — 작성중 → 작성마감 → 취합완료 */
  const [stage, setStage] = useState<SummaryStage>('open');
  /** 이 팀·주차가 공동 편집인가 */
  const [collabWeek, setCollabWeek] = useState(false);
  const { isMasterOrAbove, userId: currentUserId, teamId } = useUser();

  const { state: aggregatedMap, setState: setAggregatedMap, undo, redo, canUndo, canRedo, setInitialState } = useHistory<EditorState>({});

  const dragSubRef = useRef<{ catId: number; type: 'current' | 'next'; idx: number } | null>(null);
  const dragBulletRef = useRef<{ catId: number; type: 'current' | 'next'; subIdx: number; bulletIdx: number } | null>(null);
  const [dragOverSubId, setDragOverSubId] = useState<string | null>(null);
  const [dragOverBulletId, setDragOverBulletId] = useState<string | null>(null);
  const [copyExclude, setCopyExclude] = useState<Record<number, boolean>>({});
  const [includeEmpty, setIncludeEmptyLocal] = useState(true);
  const [includeAuthor, setIncludeAuthorLocal] = useState(true);
  const [teamUsers, setTeamUsers] = useState<{ id: number; name: string; role: string; hasReport: boolean; hasExcuse?: boolean; lastUpdated: string | null }[]>([]);

  /** 표시 설정을 서버에 즉시 반영 — 전체 취합본에서 팀별로 읽는다 */
  const patchDisplayPref = useCallback(async (patch: { includeEmpty?: boolean; includeAuthor?: boolean }) => {
    if (!teamId) return;
    try {
      await fetch('/api/reports/summary', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year, weekNum, teamId, ...patch })
      });
    } catch { /* 저장 실패해도 화면 체크는 유지 */ }
  }, [year, weekNum, teamId]);

  const setIncludeEmpty = useCallback((v: boolean | ((prev: boolean) => boolean)) => {
    setIncludeEmptyLocal(prev => {
      const next = typeof v === 'function' ? v(prev) : v;
      patchDisplayPref({ includeEmpty: next });
      return next;
    });
  }, [patchDisplayPref]);

  const setIncludeAuthor = useCallback((v: boolean | ((prev: boolean) => boolean)) => {
    setIncludeAuthorLocal(prev => {
      const next = typeof v === 'function' ? v(prev) : v;
      patchDisplayPref({ includeAuthor: next });
      return next;
    });
  }, [patchDisplayPref]);

  const isLocked = stage === 'locked';
  // 공동 편집 주차의 취합본은 공유 문서의 미러라, 팀원 룸이 살아있는 동안 고치면
  // 룸의 다음 저장이 몇 초 뒤 덮어쓴다. 그래서 [작성 마감] 으로 팀원 입력을 멈춘
  // 뒤에만 편집을 연다. 개인 작성 주차는 룸이 없어 예전처럼 바로 편집한다.
  const isEditMode = isMasterOrAbove && canMasterEditAt(stage, collabWeek);
  const showCopyButtons = isLocked;

  // 파트 > 대분류 > 중분류 계층 (대분류 이름은 파트가 다르면 중복될 수 있음)
  const partGroups: PartGroup[] = (() => {
    const byPart = new Map<number, PartGroup>();
    majors.forEach(m => {
      if (!byPart.has(m.partId)) byPart.set(m.partId, { id: m.partId, name: m.part?.name ?? '', majors: [] });
      byPart.get(m.partId)!.majors.push({
        key: `${m.partId}:${m.name}`,
        name: m.name,
        partId: m.partId,
        cats: categories.filter(c => c.partId === m.partId && c.major === m.name)
      });
    });
    return Array.from(byPart.values());
  })();

  const showPartColumn = partGroups.length > 1;

  // rowSpan 계산해 평탄화
  const summaryRows: SummaryRow[] = (() => {
    const rows: SummaryRow[] = [];
    partGroups.forEach(part => {
      const partCatCount = part.majors.reduce((n, mg) => n + mg.cats.length, 0);
      if (partCatCount === 0) return;
      let firstOfPart = true;

      // 파트에 대분류가 하나뿐이고 이름까지 같으면 두 칸을 합쳐 중복 표기를 없앤다
      // 파트 컬럼 자체를 안 그리는 팀(파트 1개)은 합칠 대상이 아니다
      const shown = part.majors.filter(mg => mg.cats.length > 0);
      const mergePartMajor = showPartColumn && shown.length === 1 && shown[0].name === part.name;

      part.majors.forEach(mg => {
        mg.cats.forEach((cat, idx) => {
          rows.push({
            cat,
            midIdx: idx,
            majorKey: mg.key,
            ...(idx === 0 && !mergePartMajor ? { majorName: mg.name, majorRowSpan: mg.cats.length } : {}),
            ...(firstOfPart ? { partName: part.name, partRowSpan: partCatCount, mergePartMajor } : {})
          });
          firstOfPart = false;
        });
      });
    });
    return rows;
  })();

  const loadFromUsers = useCallback(async () => {
    if (!teamId) return {};
    try {
      const repRes = await fetch(`/api/reports?all=true&year=${year}&weekNum=${weekNum}&teamId=${teamId}`);
      const repData = await repRes.json();
      const map: EditorState = {};
      if (Array.isArray(repData)) {
        repData.forEach(report => {
          const userName = report.user.name;
          (report.items || []).forEach((item: ReportItem) => {
            if (!map[item.categoryId]) map[item.categoryId] = { current: [], next: [] };
            const cur: ContentBlock[] = (typeof item.currentContents === 'string' ? JSON.parse(item.currentContents) : item.currentContents) ?? [];
            const nxt: ContentBlock[] = (typeof item.nextContents === 'string' ? JSON.parse(item.nextContents) : item.nextContents) ?? [];
            cur.forEach(b => { map[item.categoryId].current.push({ ...b, authorText: b.authorText || userName }); });
            nxt.forEach(b => { map[item.categoryId].next.push({ ...b, authorText: b.authorText || userName }); });
          });
        });
      }
      return map;
    } catch (e) { console.error(e); return {}; }
  }, [year, weekNum, teamId]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      if (!teamId) return;
      const [catRes, majRes, sumRes, teamRes] = await Promise.all([
        fetch(`/api/categories?teamId=${teamId}`),
        fetch(`/api/majors?teamId=${teamId}`),
        fetch(`/api/reports/summary?year=${year}&weekNum=${weekNum}&teamId=${teamId}`),
        fetch(`/api/teams?withUsers=true&year=${year}&weekNum=${weekNum}`)
      ]);
      setCategories(await catRes.json());
      setMajors(await majRes.json());
      const teamsData = await teamRes.json();
      const myTeam = Array.isArray(teamsData) ? teamsData.find((t: { id: number }) => t.id === teamId) : null;
      setTeamUsers(myTeam?.users ?? []);
      const sumData = await sumRes.json();
      setStage((sumData?.stage as SummaryStage) ?? 'open');
      setCollabWeek(!!sumData?.collab);
      if (sumData?.contents) { setInitialState(JSON.parse(sumData.contents)); }
      else { setInitialState(await loadFromUsers()); }
      setIncludeEmptyLocal(sumData?.includeEmpty ?? true);
      setIncludeAuthorLocal(sumData?.includeAuthor ?? true);
      setCopyExclude({});
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [year, weekNum, teamId, setInitialState, loadFromUsers]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // 실행취소·다시실행은 입력 이벤트 없이 값이 바뀐다 — 입력칸 높이를 한 번 다시 잡아 준다
  // (ref 를 모듈 스코프로 고정한 뒤로는 렌더마다 저절로 재계산되지 않는다)
  const undoAndResize = useCallback(() => { undo(); requestAnimationFrame(resizeAllTextareas); }, [undo]);
  const redoAndResize = useCallback(() => { redo(); requestAnimationFrame(resizeAllTextareas); }, [redo]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (!isEditMode) return;
      if (e.ctrlKey && e.key === 'z') { e.preventDefault(); undoAndResize(); }
      if (e.ctrlKey && e.key === 'y') { e.preventDefault(); redoAndResize(); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [undoAndResize, redoAndResize, isEditMode]);

  const handleReset = async () => {
    if (isLocked) return;
    // 화면에서 감췄어도 여기서 한 번 더 막는다 — 공동 편집 주차에는 개인 보고가 없어
    // 재조회가 곧 전체 삭제가 된다.
    if (collabWeek) return;
    if (!confirm('개별 사용자들이 입력한 원본을 다시 불러오시겠습니까?')) return;
    setLoading(true);
    try { setInitialState(await loadFromUsers()); } finally { setLoading(false); }
  };

  const handleSave = async () => {
    if (isLocked) return;
    setSaving(true);
    try {
      const res = await fetch('/api/reports/summary', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ year, weekNum, teamId, contents: JSON.stringify(aggregatedMap) }) });
      // 거부(잠금·공동 편집 주차 등)를 성공으로 알리면, 저장된 줄 알고 화면을 떠나
      // 다듬은 내용을 통째로 잃는다. 서버가 보낸 사유를 그대로 보여준다.
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        alert(d.error || '저장 실패');
        return;
      }
      alert('취합본이 저장되었습니다.');
    } catch { alert('저장 실패'); }
    finally { setSaving(false); }
  };

  /** 단계 전환 — 작성중 ↔ 작성마감 ↔ 취합완료 */
  const changeStage = async (next: SummaryStage, confirmText: string) => {
    // 미작성 인원이 있어도 막지 않는다 — 안 쓴 사람을 기다리느라 마감을 못 하면
    // 취합 자체가 멈춘다. 대신 누가 안 썼는지는 알려주고 판단은 팀장이 한다.
    // "이번 주 작성 없음"을 선언한 인원은 의도적으로 안 쓴 것이라 미작성 목록에서 뺀다.
    const pending = next === 'open' ? [] : teamUsers.filter(u => !u.hasReport && !u.hasExcuse);
    const notice = pending.length
      ? `\n\n미작성 ${pending.length}명: ${pending.map(u => u.name).join(', ')}\n그대로 진행할 수 있습니다.`
      : '';
    if (!confirm(`${year}년 ${weekNum}주차 — ${confirmText}${notice}`)) return;
    const res = await fetch('/api/reports/summary/lock', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ year, weekNum, teamId, stage: next })
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) { alert(d.error || '실패'); return; }
    setStage((d.stage as SummaryStage) ?? next);
    // 작성마감 시점의 공유 문서 내용을 다시 읽어와야 팀원의 마지막 편집까지 정리 대상에 들어온다
    await fetchData();
  };

  const nextWeekLabel = (() => {
    const nw = getNextWeek(year, weekNum);
    return nw.year !== year ? `${nw.year}년 ${nw.weekNum}주차` : `${nw.weekNum}주차`;
  })();

  // ── Copy ──
  const generateCopyData = (mode: 'all' | 'current' | 'next', targetMajorKey: string | null = null, excludeOverride?: Record<number, boolean>, skipEmpty = false) => {
    if (!aggregatedMap) return { text: '', html: '' };
    const exclude = excludeOverride ?? copyExclude;
    let text = '';
    const htmlLines: string[] = [];
    const allMajorGroups = partGroups.flatMap(p => p.majors);
    const majorsToCopy = targetMajorKey ? allMajorGroups.filter(m => m.key === targetMajorKey) : allMajorGroups;
    const circled = (i: number) => i < 10 ? `⑴⑵⑶⑷⑸⑹⑺⑻⑼⑽`[i] : `(${i + 1})`;

    const renderSection = (cp: string, middle: string, blocks: ContentBlock[]) => {
      let t = `${cp} ${middle || ''}\n`;
      let h = `<div>${cp} ${middle || ''}</div>`;
      let seq = -1;
      blocks.forEach(block => {
        if (isTableBlock(block)) {
          // 표는 번호를 매기지 않고 실제 <table> 로 내보낸다 (워드/문서에 표로 붙는다)
          t += tableToText(block);
          h += `<div style="margin-left:14pt;">${tableToHtml(block)}</div>`;
          return;
        }
        seq += 1;
        const pf = seq < 10 ? `①②③④⑤⑥⑦⑧⑨⑩`[seq] : `(${seq + 1})`;
        const auth = (includeAuthor && block.authorText) ? ` [${block.authorText}]` : '';
        t += `     ${pf} ${block.subText || ''}${auth}\n`;
        h += `<div>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;${pf} ${block.subText || ''}${auth}</div>`;
        block.bullets.forEach(bul => {
          t += `          - ${bul.text || ''}\n`;
          h += `<div>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;- ${bul.text || ''}</div>`;
        });
      });
      if (blocks.length === 0) {
        t += `     ① 내용없음\n`;
        h += `<div>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;① 내용없음</div>`;
      }
      return { t, h };
    };

    majorsToCopy.forEach(mg => {
      const majorCats = mg.cats;
      if (majorCats.length === 0) return;
      const catsToRender = majorCats.filter(cat => !exclude[cat.id]);
      if (catsToRender.length === 0) return;
      let majorCurText = '', majorNxtText = '', majorCurHtml = '', majorNxtHtml = '';

      if (skipEmpty && mode === 'all') {
        // 금주/차주 각각 독립적으로 빈 항목 제외 + 번호 재정렬
        const curCats = catsToRender.filter(cat => (aggregatedMap[cat.id]?.current?.length ?? 0) > 0);
        const nxtCats = catsToRender.filter(cat => (aggregatedMap[cat.id]?.next?.length ?? 0) > 0);
        curCats.forEach((cat, idx) => {
          const data = aggregatedMap[cat.id] || { current: [], next: [] };
          const r = renderSection(circled(idx), cat.middle, data.current);
          majorCurText += r.t; majorCurHtml += r.h;
        });
        nxtCats.forEach((cat, idx) => {
          const data = aggregatedMap[cat.id] || { current: [], next: [] };
          const r = renderSection(circled(idx), cat.middle, data.next);
          majorNxtText += r.t; majorNxtHtml += r.h;
        });
      } else {
        catsToRender.forEach((cat, idx) => {
          const data = aggregatedMap[cat.id] || { current: [], next: [] };
          const cp = circled(idx);
          if (mode === 'all' || mode === 'current') { const r = renderSection(cp, cat.middle, data.current); majorCurText += r.t; majorCurHtml += r.h; }
          if (mode === 'all' || mode === 'next') { const r = renderSection(cp, cat.middle, data.next); majorNxtText += r.t; majorNxtHtml += r.h; }
        });
      }

      if (mode === 'all') {
        text += `${majorCurText.trim()}\t${majorNxtText.trim()}\n`;
        const td = 'border: 0.5pt solid #7f7f7f; padding: 2pt; vertical-align: top;';
        htmlLines.push(`<tr style="border: 0.5pt solid #7f7f7f;"><td style="${td}">${majorCurHtml}</td><td style="${td}">${majorNxtHtml}</td></tr>`);
      } else if (mode === 'current') { text += `${majorCurText.trim()}\n\n`; htmlLines.push(`<div>${majorCurHtml}</div><br/>`); }
      else { text += `${majorNxtText.trim()}\n\n`; htmlLines.push(`<div>${majorNxtHtml}</div><br/>`); }
    });

    const html = mode === 'all' ? `<table style="border-collapse:collapse;width:100%;border:0.5pt solid #7f7f7f;">${htmlLines.join('')}</table>` : htmlLines.join('');
    return { text: text.trim(), html };
  };

  const handleCopy = (mode: 'all' | 'current' | 'next', majorKey: string | null = null) => {
    let excludeForCopy = copyExclude;
    if (!includeEmpty && aggregatedMap) {
      const newExclude: Record<number, boolean> = { ...copyExclude };
      categories.forEach(cat => {
        const data = aggregatedMap[cat.id] || { current: [], next: [] };
        if (data.current.length === 0 && data.next.length === 0) {
          newExclude[cat.id] = true;
        }
      });
      excludeForCopy = newExclude;
    }
    const { text, html } = generateCopyData(mode, majorKey, excludeForCopy, !includeEmpty);
    if (!text) { alert('복사할 내용이 없습니다.'); return; }
    if (navigator.clipboard && window.isSecureContext && window.ClipboardItem) {
      navigator.clipboard.write([new ClipboardItem({ 'text/plain': new Blob([text], { type: 'text/plain' }), 'text/html': new Blob([html], { type: 'text/html' }) })]).then(() => alert('복사 완료')).catch(() => alert('복사 실패'));
    } else {
      const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.left = '-9999px'; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); alert('복사 완료');
    }
  };

  // ── State Builders ──
  const updateState = (catId: number, type: 'current' | 'next', fn: (l: ContentBlock[]) => ContentBlock[]) => {
    if (!isEditMode) return;
    setAggregatedMap((prev: EditorState) => {
      const d = prev[catId] ?? { current: [], next: [] };
      return { ...prev, [catId]: { ...d, [type]: fn([...d[type]]) } };
    });
  };

  /** i 위치가 SubBlock 일 때만 적용 */
  const updateSub = (c: number, t: 'current' | 'next', i: number, fn: (s: SubBlock) => SubBlock) =>
    updateState(c, t, l => {
      const b = l[i];
      if (!b || isTableBlock(b)) return l;
      l[i] = fn(b);
      return l;
    });

  const setSubText = (c: number, t: 'current' | 'next', i: number, v: string) => updateSub(c, t, i, s => ({ ...s, subText: v }));
  const setAuthorText = (c: number, t: 'current' | 'next', i: number, v: string) => updateState(c, t, l => { l[i] = { ...l[i], authorText: v }; return l; });
  const removeBlock = (c: number, t: 'current' | 'next', i: number) => updateState(c, t, l => { l.splice(i, 1); return l; });
  const reorderSub = (c: number, t: 'current' | 'next', from: number, to: number) => { if (from === to) return; updateState(c, t, l => { const n = [...l]; const [it] = n.splice(from, 1); n.splice(to, 0, it); return n; }); };
  const addSub = (c: number, t: 'current' | 'next') => updateState(c, t, l => [...l, createSubBlock()]);
  const addTable = (c: number, t: 'current' | 'next') => updateState(c, t, l => [...l, createTableBlock()]);
  const setTable = (c: number, t: 'current' | 'next', i: number, next: TableBlock) => updateState(c, t, l => { l[i] = next; return l; });
  const addBullet = (c: number, t: 'current' | 'next', i: number) => updateSub(c, t, i, s => ({ ...s, bullets: [...s.bullets, { id: generateId(), text: '' }] }));
  const setBulletText = (c: number, t: 'current' | 'next', si: number, bi: number, v: string) => updateSub(c, t, si, s => { const nb = [...s.bullets]; nb[bi] = { ...nb[bi], text: v }; return { ...s, bullets: nb }; });
  const removeBullet = (c: number, t: 'current' | 'next', si: number, bi: number) => updateSub(c, t, si, s => { const nb = [...s.bullets]; nb.splice(bi, 1); return { ...s, bullets: nb }; });
  const reorderBullet = (c: number, t: 'current' | 'next', si: number, from: number, to: number) => { if (from === to) return; updateSub(c, t, si, s => { const nb = [...s.bullets]; const [it] = nb.splice(from, 1); nb.splice(to, 0, it); return { ...s, bullets: nb }; }); };

  const moveBulletGlobal = (fc: number, ft: 'current' | 'next', fsi: number, fbi: number, tc: number, tt: 'current' | 'next', tsi: number) => {
    if (!isEditMode) return;
    setAggregatedMap(prev => {
      const nm = { ...prev };
      const sd = { ...nm[fc] }; const sl = [...(sd[ft] || [])];
      const src = sl[fsi];
      if (!src || isTableBlock(src)) return prev; // 표 블록에는 불릿이 없다
      const ss: SubBlock = { ...src }; const mb = ss.bullets[fbi]; if (!mb) return prev;
      ss.bullets = ss.bullets.filter((_, i) => i !== fbi); sl[fsi] = ss;
      let removed = false;
      if (!ss.subText.trim() && ss.bullets.length === 0) { sl.splice(fsi, 1); removed = true; }
      nm[fc] = { ...sd, [ft]: sl };
      const dd = { ...nm[tc] }; const dl = [...(dd[tt] || [])];
      let fi = tsi;
      if (fc === tc && ft === tt && removed && fsi < tsi) fi--;
      const dst = dl[fi];
      if (!dst || isTableBlock(dst)) return nm; // 표 위로는 드롭 불가
      const ds: SubBlock = { ...dst }; ds.bullets = [...ds.bullets, mb]; dl[fi] = ds;
      nm[tc] = { ...dd, [tt]: dl };
      return nm;
    });
  };

  // ── Render ──
  const renderReadOnlyBlocks = (blocks: ContentBlock[]) => {
    if (!blocks || blocks.length === 0) return <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem', paddingLeft: '1rem' }}>내용 없음</span>;
    let seq = -1;
    return blocks.map(b => {
      if (isTableBlock(b)) return <TableBlockView key={b.id} block={b} />;
      seq += 1;
      return (
        <div key={b.id} style={{ marginBottom: '0.4rem' }}>
          <div style={{ fontWeight: 600, fontSize: '0.88rem' }}>
            {seq < 10 ? `①②③④⑤⑥⑦⑧⑨⑩`[seq] : `(${seq + 1})`} {b.subText}
            {b.authorText && <span style={{ color: 'var(--primary)', fontWeight: 700, marginLeft: '0.3rem' }}>[{b.authorText}]</span>}
          </div>
          {b.bullets.map(bul => <div key={bul.id} style={{ paddingLeft: '2rem', fontSize: '0.85rem', color: 'var(--text-muted)' }}>- {bul.text}</div>)}
        </div>
      );
    });
  };

  // 데이터 로드 후 모든 textarea 높이 재계산
  // double RAF: 1차 RAF에서 레이아웃 계산 → 2차 RAF에서 높이 적용
  useEffect(() => {
    if (loading) return;
    let cancelled = false;
    requestAnimationFrame(() => {
      if (cancelled) return;
      requestAnimationFrame(() => {
        if (cancelled) return;
        resizeAllTextareas();
      });
    });
    return () => { cancelled = true; };
  }, [loading]);

  const renderEditBlocks = (catId: number, type: 'current' | 'next', blocks: ContentBlock[]) => {
    if (!blocks || blocks.length === 0) return <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem', paddingLeft: '2rem' }}>내용 없음</span>;
    let seq = -1;
    return blocks.map((block, idx) => {
      if (isTableBlock(block)) {
        return (
          <TableBlockEditor
            key={block.id}
            block={block}
            onChange={next => setTable(catId, type, idx, next)}
            onRemove={() => removeBlock(catId, type, idx)}
            onAuthorChange={v => setAuthorText(catId, type, idx, v)}
          />
        );
      }
      seq += 1;
      return renderEditSubBlock(catId, type, block, idx, seq);
    });
  };

  /** 취합본 편집용 + 소분류 / + 표 (컴포넌트로 두면 렌더마다 새 타입이라 버튼이 재마운트된다) */
  const renderAddBlockBar = (catId: number, type: 'current' | 'next') => (
    <div style={{ display: 'flex', gap: '0.3rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
      <button onClick={() => addSub(catId, type)} className="btn" style={{ fontSize: '0.75rem', background: 'var(--btn-bg)', color: 'var(--foreground)', opacity: 0.6 }}>+ 소분류</button>
      <button onClick={() => addTable(catId, type)} className="btn" style={{ fontSize: '0.75rem', background: 'var(--btn-bg)', color: 'var(--foreground)', opacity: 0.6 }}>+ 표</button>
    </div>
  );

  const renderEditSubBlock = (catId: number, type: 'current' | 'next', block: SubBlock, idx: number, seq: number) => {
    return (
      <div key={block.id} draggable
        onDragStart={e => { e.stopPropagation(); dragSubRef.current = { catId, type, idx }; (e.currentTarget as HTMLElement).classList.add('dragging'); }}
        onDragEnd={e => { (e.currentTarget as HTMLElement).classList.remove('dragging'); setDragOverSubId(null); }}
        onDragOver={e => { e.preventDefault(); e.stopPropagation(); setDragOverSubId(block.id); }}
        onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverSubId(null); }}
        onDrop={e => {
          e.preventDefault(); e.stopPropagation();
          if (dragSubRef.current && dragSubRef.current.catId === catId && dragSubRef.current.type === type) reorderSub(catId, type, dragSubRef.current.idx, idx);
          else if (dragBulletRef.current) moveBulletGlobal(dragBulletRef.current.catId, dragBulletRef.current.type, dragBulletRef.current.subIdx, dragBulletRef.current.bulletIdx, catId, type, idx);
          dragSubRef.current = null; dragBulletRef.current = null; setDragOverSubId(null);
        }}
        className={`drag-block${dragOverSubId === block.id ? ' drag-over' : ''}`}
        style={{ marginBottom: '0.3rem', padding: '0.2rem 0.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
          <span className="drag-handle">⠿</span>
          <span style={{ fontWeight: 700, minWidth: '1.4rem', color: 'var(--primary)', fontSize: '1rem', flexShrink: 0 }}>{seq < 10 ? `①②③④⑤⑥⑦⑧⑨⑩`[seq] : `(${seq + 1})`}</span>
          <textarea ref={autoResize} value={block.subText} onChange={e => setSubText(catId, type, idx, e.target.value)} className="input-field" placeholder="소분류 내용..." rows={1}
            onInput={e => autoResize(e.target as HTMLTextAreaElement)}
            style={{ flex: 1, borderTop: 'none', borderLeft: 'none', borderRight: 'none', fontWeight: 600, resize: 'none', minHeight: '34px', overflow: 'hidden', fontSize: '0.88rem', lineHeight: '1.4' }} />
          <span style={{ color: 'var(--primary)', fontWeight: 700, flexShrink: 0 }}>[</span>
          <input value={block.authorText || ''} onChange={e => setAuthorText(catId, type, idx, e.target.value)} className="input-field"
            style={{ width: '60px', padding: '0.2rem 0.1rem', background: 'transparent', borderTop: 'none', borderLeft: 'none', borderRight: 'none', borderBottomColor: 'var(--primary)', color: 'var(--primary)', fontWeight: 600, textAlign: 'center', fontSize: '0.85rem' }} />
          <span style={{ color: 'var(--primary)', fontWeight: 700, flexShrink: 0 }}>]</span>
          <button onClick={() => addBullet(catId, type, idx)} className="icon-btn add">+ 항목</button>
          <button onClick={() => removeBlock(catId, type, idx)} className="icon-btn del">✕</button>
        </div>
        {block.bullets.map((bul, bid) => (
          <div key={bul.id} draggable
            onDragStart={e => { e.stopPropagation(); dragBulletRef.current = { catId, type, subIdx: idx, bulletIdx: bid }; (e.currentTarget as HTMLElement).classList.add('dragging'); }}
            onDragEnd={e => { (e.currentTarget as HTMLElement).classList.remove('dragging'); setDragOverBulletId(null); }}
            onDragOver={e => { e.preventDefault(); e.stopPropagation(); setDragOverBulletId(bul.id); }}
            onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverBulletId(null); }}
            onDrop={e => {
              e.preventDefault(); e.stopPropagation();
              if (dragBulletRef.current) {
                const same = dragBulletRef.current.catId === catId && dragBulletRef.current.type === type && dragBulletRef.current.subIdx === idx;
                if (same) reorderBullet(catId, type, idx, dragBulletRef.current.bulletIdx, bid);
                else moveBulletGlobal(dragBulletRef.current.catId, dragBulletRef.current.type, dragBulletRef.current.subIdx, dragBulletRef.current.bulletIdx, catId, type, idx);
              }
              dragBulletRef.current = null; dragSubRef.current = null; setDragOverBulletId(null);
            }}
            className={`drag-block${dragOverBulletId === bul.id && dragBulletRef.current?.bulletIdx !== bid ? ' drag-over' : ''}`}
            style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', paddingLeft: '2.2rem', marginTop: '0.3rem' }}>
            <span className="drag-handle" style={{ fontSize: '0.75rem' }}>⠿</span>
            <span style={{ fontWeight: 600, color: 'var(--text-muted)', flexShrink: 0 }}>-</span>
            <textarea ref={autoResize} value={bul.text} onChange={e => setBulletText(catId, type, idx, bid, e.target.value)} className="input-field" rows={1}
              onInput={e => autoResize(e.target as HTMLTextAreaElement)}
              style={{ flex: 1, borderTop: 'none', borderLeft: 'none', borderRight: 'none', borderBottom: '1px dashed var(--border)', fontSize: '0.88rem', resize: 'none', minHeight: '30px', overflow: 'hidden', padding: '0.25rem 0.5rem' }} />
            <button onClick={() => removeBullet(catId, type, idx, bid)} className="icon-btn del">✕</button>
          </div>
        ))}
      </div>
    );
  };

  if (!aggregatedMap) return null;

  return (
    <div className="glass-panel" style={{ padding: '2rem', marginTop: '2rem' }}>
      {collabWeek && stage === 'open' && (
        <div style={{ background: 'var(--primary-alpha-subtle)', border: '1px solid var(--primary)', borderRadius: '8px', padding: '0.9rem 1.4rem', marginBottom: '1rem', fontSize: '0.9rem' }}>
          이 주차는 팀이 <strong>주간보고 화면에서 함께 작성</strong>하는 중입니다.
          취합본을 정리하려면 <strong>[작성 마감]</strong> 으로 팀원 입력을 먼저 멈춰주세요.
        </div>
      )}
      {collabWeek && stage === 'closed' && (
        <div style={{ background: 'rgba(217,119,6,0.10)', border: '1px solid #d97706', borderRadius: '8px', padding: '0.9rem 1.4rem', marginBottom: '1rem', fontSize: '0.9rem', color: '#92400e' }}>
          <strong>작성마감</strong> 상태입니다. 팀원 입력이 멈췄고, 지금부터 팀장이 정리할 수 있습니다.
          여기서 <strong>저장</strong>하면 팀 공동 편집본에도 그대로 반영됩니다.
        </div>
      )}
      {isLocked && (
        <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: '8px', padding: '0.8rem 1.5rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#dc2626', fontWeight: 600, fontSize: '0.9rem' }}>
          ▣ 취합완료된 주차입니다. 고치려면 취합완료를 해제해주세요.
        </div>
      )}

      <div className="summary-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div className="summary-actions" style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
          <h2 style={{ fontSize: '1.5rem', margin: 0 }}>주간보고 취합본</h2>
          {showCopyButtons && (
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <label style={{ fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.25rem', cursor: 'pointer' }}>
                <input type="checkbox" checked={includeEmpty} onChange={() => setIncludeEmpty(v => !v)} style={{ cursor: 'pointer', accentColor: 'var(--primary)' }} />
                내용없음 포함
              </label>
              <label style={{ fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.25rem', cursor: 'pointer' }}>
                <input type="checkbox" checked={includeAuthor} onChange={() => setIncludeAuthor(v => !v)} style={{ cursor: 'pointer', accentColor: 'var(--primary)' }} />
                작성자 포함
              </label>
              <div style={{ width: '1px', height: '1.2rem', background: '#ccc', margin: '0 0.25rem' }} />
              <button onClick={() => handleCopy('all')} className="btn" style={{ fontSize: '0.8rem', padding: '0.3rem 0.8rem', background: 'var(--primary)', color: 'white' }}>전체 복사</button>
              <button onClick={() => handleCopy('current')} className="btn" style={{ fontSize: '0.8rem', padding: '0.3rem 0.8rem', background: 'var(--primary)', color: 'white', opacity: 0.9 }}>금주만 복사</button>
              <button onClick={() => handleCopy('next')} className="btn" style={{ fontSize: '0.8rem', padding: '0.3rem 0.8rem', background: 'var(--primary)', color: 'white', opacity: 0.9 }}>차주만 복사</button>
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <label>연도: <input type="number" value={year} onChange={e => setYear(parseInt(e.target.value, 10))} className="input-field" style={{ width: '80px', marginLeft: '0.5rem', padding: '0.3rem' }} /></label>
          <label>주차: <input type="number" value={weekNum} onChange={e => setWeekNum(parseInt(e.target.value, 10))} className="input-field" style={{ width: '80px', marginLeft: '0.5rem', padding: '0.3rem' }} /></label>
          <button onClick={fetchData} className="btn btn-primary" style={{ padding: '0.4rem 1rem' }}>조회</button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
        {isEditMode && <>
          {/* 원본 재조회는 개인 보고에서 다시 읽어온다. 공동 편집 주차에는 개인 보고가 없어
              누르는 순간 내용이 비고, 그대로 저장하면 팀 문서가 통째로 비워진다. */}
          {!collabWeek && (
            <button onClick={handleReset} className="btn" style={{ fontSize: '0.9rem', color: 'var(--primary)', borderColor: 'var(--primary)' }}>⟲ 원본 재조회</button>
          )}
          <button onClick={undoAndResize} disabled={!canUndo} className="btn" style={{ fontSize: '0.9rem' }}>↶ 실행취소</button>
          <button onClick={redoAndResize} disabled={!canRedo} className="btn" style={{ fontSize: '0.9rem' }}>↷ 다시실행</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving} style={{ padding: '0.4rem 2rem', fontSize: '1rem' }}>{saving ? '저장중...' : '저장'}</button>
        </>}
        {isMasterOrAbove && (() => {
          const btn = (label: string, next: SummaryStage, confirmText: string, bg: string) => (
            <button key={label} onClick={() => changeStage(next, confirmText)} className="btn"
              style={{ fontSize: '0.9rem', padding: '0.4rem 1.2rem', background: bg, color: 'white', border: 'none' }}>
              {label}
            </button>
          );
          // 공동 편집 주차는 작성마감을 거쳐야 정리할 수 있다. 개인 작성 주차는 기존 2단계 그대로.
          if (collabWeek && stage === 'open') {
            return btn('작성 마감', 'closed', '팀원 입력을 마감하고 취합 정리를 시작할까요?\n마감 후에는 팀원이 주간보고 화면에서 수정할 수 없습니다.', '#d97706');
          }
          if (collabWeek && stage === 'closed') {
            return <>
              {btn('마감 취소', 'open', '팀원 입력을 다시 열까요?\n정리한 내용은 그대로 두고 팀원이 이어서 작성합니다.', '#64748b')}
              {btn('취합 완료', 'locked', '취합을 완료할까요?\n완료 후에는 취합본도 수정할 수 없습니다.', '#ef4444')}
            </>;
          }
          if (stage === 'locked') {
            return btn('취합완료 해제', collabWeek ? 'closed' : 'open', '취합완료를 해제할까요?', '#22c55e');
          }
          return btn('취합 완료', 'locked', '취합을 완료할까요?\n완료 후에는 개별 입력과 편집이 차단됩니다.', '#ef4444');
        })()}
      </div>

      {!loading && teamUsers.length > 0 && (
        <div className="glass-panel" style={{ padding: '0.8rem 1.2rem', marginBottom: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.5rem' }}>
            <span style={{ fontWeight: 700, fontSize: '0.9rem' }}>작성 현황</span>
            <span style={{ fontSize: '0.85rem', color: 'var(--primary)', fontWeight: 600 }}>
              {teamUsers.filter(u => u.hasReport || u.hasExcuse).length}/{teamUsers.length}
            </span>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
            {teamUsers.map(u => (
              <span key={u.id} style={{
                display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
                padding: '0.25rem 0.6rem', borderRadius: '4px', fontSize: '0.82rem',
                background: u.hasReport ? 'rgba(34,197,94,0.1)' : u.hasExcuse ? 'rgba(156,163,175,0.15)' : 'rgba(239,68,68,0.1)',
                color: u.hasReport ? '#16a34a' : u.hasExcuse ? '#9ca3af' : '#dc2626',
                fontWeight: 600
              }}>
                {u.name}
                <span style={{ fontSize: '0.75rem' }}>{u.hasReport ? '완료' : u.hasExcuse ? '작성없음' : '미작성'}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {loading ? <p>데이터를 불러오는 중입니다...</p> : isEditMode ? (
        /* ── 편집 모드 (마스터 + 미잠금) ── */
        <><p className="scroll-hint" style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textAlign: 'center', marginBottom: '0.5rem' }}>↔ 좌우로 스크롤하세요</p>
        <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
          <table className="summary-table">
            <thead>
              <tr>
                {showPartColumn && <th style={{ width: '8%' }}>파트</th>}
                <th style={{ width: showPartColumn ? '9%' : '10%' }}>분류</th>
                <th style={{ width: '12%' }}></th>
                <th style={{ width: showPartColumn ? '35.5%' : '39%' }}>{weekNum}주차 금주</th>
                <th style={{ width: showPartColumn ? '35.5%' : '39%' }}>{nextWeekLabel} 차주</th>
              </tr>
            </thead>
            <tbody>
              {summaryRows.map(row => {
                const data = aggregatedMap[row.cat.id] || { current: [], next: [] };
                return (
                  <tr key={row.cat.id}>
                    {showPartColumn && row.partName !== undefined && (
                      <td rowSpan={row.partRowSpan} colSpan={row.mergePartMajor ? 2 : 1} style={{ fontWeight: 700, textAlign: 'center', verticalAlign: 'middle', background: 'var(--surface-dim)' }}>{row.partName}</td>
                    )}
                    {row.majorName !== undefined && (
                      <td rowSpan={row.majorRowSpan} style={{ fontWeight: 'bold', textAlign: 'center', verticalAlign: 'middle' }}>{row.majorName}</td>
                    )}
                    <td style={{ fontWeight: 500 }}>({row.midIdx + 1}) {row.cat.middle}</td>
                    <td style={{ verticalAlign: 'top' }}>
                      {renderEditBlocks(row.cat.id, 'current', data.current)}
                      {renderAddBlockBar(row.cat.id, 'current')}
                    </td>
                    <td style={{ verticalAlign: 'top' }}>
                      {renderEditBlocks(row.cat.id, 'next', data.next)}
                      {renderAddBlockBar(row.cat.id, 'next')}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div></>
      ) : (
        /* ── 읽기전용 모드 ── */
        <><p className="scroll-hint" style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textAlign: 'center', marginBottom: '0.5rem' }}>↔ 좌우로 스크롤하세요</p>
        <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
          <table className="summary-table">
            <thead>
              <tr>
                {showPartColumn && <th style={{ width: '8%' }}>파트</th>}
                <th style={{ width: showPartColumn ? '9%' : '10%' }}>분류</th>
                <th style={{ width: '12%' }}></th>
                <th style={{ width: showPartColumn ? '35.5%' : '39%' }}>{weekNum}주차 금주</th>
                <th style={{ width: showPartColumn ? '35.5%' : '39%' }}>{nextWeekLabel} 차주</th>
              </tr>
            </thead>
            <tbody>
              {summaryRows.map(row => {
                const cat = row.cat;
                const data = aggregatedMap[cat.id] || { current: [], next: [] };
                const dimmed = copyExclude[cat.id];
                return (
                  <tr key={cat.id}>
                    {showPartColumn && row.partName !== undefined && (
                      <td rowSpan={row.partRowSpan} colSpan={row.mergePartMajor ? 2 : 1} style={{ fontWeight: 700, textAlign: 'center', verticalAlign: 'middle', background: 'var(--surface-dim)' }}>{row.partName}</td>
                    )}
                    {row.majorName !== undefined && (
                      <td rowSpan={row.majorRowSpan} style={{ fontWeight: 'bold', textAlign: 'center', verticalAlign: 'middle' }}>
                        {row.majorName}
                        {showCopyButtons && (
                          <div style={{ marginTop: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.2rem', alignItems: 'center' }}>
                            <button onClick={() => handleCopy('all', row.majorKey)} className="btn" style={{ fontSize: '0.7rem', padding: '0.15rem 0.3rem', width: '90%' }}>복사</button>
                          </div>
                        )}
                      </td>
                    )}
                    <td style={{ fontWeight: 500, opacity: dimmed ? 0.4 : 1, background: dimmed ? 'var(--surface-dim)' : undefined }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                        {showCopyButtons && (
                          <input type="checkbox" checked={!dimmed} onChange={() => setCopyExclude(prev => {
                            const next = { ...prev };
                            if (next[cat.id]) { delete next[cat.id]; } else { next[cat.id] = true; }
                            return next;
                          })} style={{ cursor: 'pointer', accentColor: 'var(--primary)' }} title="복사 포함/제외" />
                        )}
                        ({row.midIdx + 1}) {cat.middle}
                      </div>
                    </td>
                    <td style={{ verticalAlign: 'top', padding: '0.8rem', opacity: dimmed ? 0.4 : 1, background: dimmed ? 'var(--surface-dim)' : undefined }}>{renderReadOnlyBlocks(data.current)}</td>
                    <td style={{ verticalAlign: 'top', padding: '0.8rem', opacity: dimmed ? 0.4 : 1, background: dimmed ? 'var(--surface-dim)' : undefined }}>{renderReadOnlyBlocks(data.next)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div></>
      )}
    </div>
  );
}

