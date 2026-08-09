'use client';

import { useEffect, useState, useRef, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useHistory } from '@/lib/useHistory';
import { getWeekNumber, getPrevWeek } from '@/lib/weekUtils';
import { useUser } from '@/lib/UserContext';
import {
  type ContentBlock, type SubBlock, type TableBlock,
  isTableBlock, generateId, createSubBlock, createTableBlock
} from '@/lib/reportBlocks';
import { TableBlockEditor, TableBlockView } from '@/components/TableBlock';

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

  const [year, setYear] = useState(paramYear ? parseInt(paramYear, 10) : new Date().getFullYear());
  const [weekNum, setWeekNum] = useState(paramWeek ? parseInt(paramWeek, 10) : getWeekNumber(new Date()));

  // 겸직 지원: 소속 팀 전부의 분류를 미리 받아두고, 탭으로 전환하며 한 번에 저장한다.
  const [activeTeamId, setActiveTeamId] = useState<number | null>(null);
  const [catsByTeam, setCatsByTeam] = useState<Record<number, Category[]>>({});
  const [majorsByTeam, setMajorsByTeam] = useState<Record<number, MajorResponse[]>>({});
  const [lockByTeam, setLockByTeam] = useState<Record<number, boolean>>({});

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const categories = activeTeamId ? catsByTeam[activeTeamId] ?? [] : [];
  const majorList = activeTeamId ? majorsByTeam[activeTeamId] ?? [] : [];
  const isLocked = activeTeamId ? lockByTeam[activeTeamId] ?? false : false;

  /** categoryId → teamId 역매핑 (저장 시 잠긴 팀 항목을 걸러내려고) */
  const teamOfCategory = (() => {
    const m = new Map<number, number>();
    Object.entries(catsByTeam).forEach(([tid, cats]) => cats.forEach(c => m.set(c.id, parseInt(tid, 10))));
    return m;
  })();

  const [prevWeekData, setPrevWeekData] = useState<EditorState>({});
  const { state: reportData, setState: setReportData, undo, redo, canUndo, canRedo, setInitialState } = useHistory<EditorState>({});

  const dragSubRef = useRef<{ catId: number; type: 'current'|'next'; idx: number } | null>(null);
  const dragBulletRef = useRef<{ catId: number; type: 'current'|'next'; subIdx: number; bulletIdx: number } | null>(null);
  const [dragOverSubId, setDragOverSubId] = useState<string | null>(null);
  const [dragOverBulletId, setDragOverBulletId] = useState<string | null>(null);

  useEffect(() => {
    if (isHydrating) return; // 세션 복원 전에는 판단하지 않는다
    if (!userId || !teamId) return router.push('/');
    setActiveTeamId(prev => (prev && teams.some(t => t.id === prev) ? prev : teamId));
    fetchAllTeamCategories().then(() => fetchReportsForWeek());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, teamId, year, weekNum, isHydrating]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isLocked) return;
      if (e.ctrlKey && e.key === 'z') { e.preventDefault(); undo(); }
      if (e.ctrlKey && e.key === 'y') { e.preventDefault(); redo(); }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undo, redo, isLocked]);

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

    const nextCats: Record<number, Category[]> = {};
    const nextMajors: Record<number, MajorResponse[]> = {};
    results.forEach(r => { nextCats[r.tid] = r.cats; nextMajors[r.tid] = r.majors; });
    setCatsByTeam(nextCats);
    setMajorsByTeam(nextMajors);
  };

  const fetchReportsForWeek = async () => {
    setLoading(true);
    try {
      // 소속 팀 전부의 잠금 상태
      const lockRes = await fetch(`/api/reports/summary/lock?year=${year}&weekNum=${weekNum}&all=true`);
      const lockData = await lockRes.json();
      const lockMap: Record<number, boolean> = {};
      if (Array.isArray(lockData)) lockData.forEach((l: { teamId: number; isLocked: boolean }) => { lockMap[l.teamId] = l.isLocked; });
      setLockByTeam(lockMap);

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
        return tid == null ? true : !lockByTeam[tid];
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

  const saveReport = () => {
    const items = buildSaveItems();
    if (items.length === 0) {
      alert(isLocked ? '이 주차는 잠겨있어 저장할 수 없습니다.' : '저장할 내용이 없습니다.');
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
      if (res.ok) alert('저장되었습니다.');
      else {
        const err = await res.json();
        alert(err.error || '저장 실패');
      }
    } catch (e) {
      alert('오류 발생');
    } finally {
      setSaving(false);
    }
  };

  // State Builders
  const updateState = (catId: number, type: 'current'|'next', modifyFn: (list: ContentBlock[]) => ContentBlock[]) => {
    if (isLocked) return;
    setReportData(prev => {
      const catData = prev[catId] ?? { current: [], next: [] };
      return { ...prev, [catId]: { ...catData, [type]: modifyFn([...catData[type]]) } };
    });
  };

  /** index 위치가 SubBlock 일 때만 적용 (표 블록에는 소분류 연산이 없다) */
  const updateSub = (catId: number, type: 'current'|'next', index: number, fn: (s: SubBlock) => SubBlock) =>
    updateState(catId, type, list => {
      const b = list[index];
      if (!b || isTableBlock(b)) return list;
      list[index] = fn(b);
      return list;
    });

  const addSub = (catId: number, type: 'current'|'next') => updateState(catId, type, list => [...list, createSubBlock()]);
  const addTable = (catId: number, type: 'current'|'next') =>
    updateState(catId, type, list => [...list, createTableBlock()]);
  const setTable = (catId: number, type: 'current'|'next', index: number, next: TableBlock) =>
    updateState(catId, type, list => { list[index] = next; return list; });

  const setSubText = (catId: number, type: 'current'|'next', index: number, val: string) => updateSub(catId, type, index, s => ({ ...s, subText: val }));
  const removeBlock = (catId: number, type: 'current'|'next', index: number) => updateState(catId, type, list => { list.splice(index, 1); return list; });
  const reorderSub = (catId: number, type: 'current'|'next', fromIdx: number, toIdx: number) => {
    if (fromIdx === toIdx) return;
    updateState(catId, type, list => { const n = [...list]; const [it] = n.splice(fromIdx, 1); n.splice(toIdx, 0, it); return n; });
  };
  const addBullet = (catId: number, type: 'current'|'next', index: number) => updateSub(catId, type, index, s => ({ ...s, bullets: [...s.bullets, { id: generateId(), text: '' }] }));
  const setBulletText = (catId: number, type: 'current'|'next', si: number, bi: number, val: string) => updateSub(catId, type, si, s => {
    const nb = [...s.bullets]; nb[bi] = { ...nb[bi], text: val }; return { ...s, bullets: nb };
  });
  const removeBullet = (catId: number, type: 'current'|'next', si: number, bi: number) => updateSub(catId, type, si, s => {
    const nb = [...s.bullets]; nb.splice(bi, 1); return { ...s, bullets: nb };
  });
  const reorderBullet = (catId: number, type: 'current'|'next', si: number, from: number, to: number) => {
    if (from === to) return;
    updateSub(catId, type, si, s => { const nb = [...s.bullets]; const [it] = nb.splice(from, 1); nb.splice(to, 0, it); return { ...s, bullets: nb }; });
  };

  const copyCurrentToNext = (catId: number) => {
    if (isLocked) return;
    const currentBlocks = reportData[catId]?.current || [];
    if (currentBlocks.length === 0) return;
    const existingNext = reportData[catId]?.next || [];
    if (existingNext.length > 0 && !confirm('기존 차주 내용을 덮어씁니다. 계속하시겠습니까?')) return;
    const copied: ContentBlock[] = currentBlocks.map(block =>
      isTableBlock(block)
        ? { ...block, id: generateId(), rows: block.rows.map(r => [...r]), headers: [...block.headers] }
        : {
            id: generateId(),
            type: 'sub' as const,
            subText: block.subText,
            bullets: block.bullets.map(b => ({ id: generateId(), text: b.text }))
          }
    );
    updateState(catId, 'next', () => copied);
  };

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
    const ro = isReadonly || isLocked;
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
              onChange={next => setTable(catId, type, idx, next)}
              onRemove={() => removeBlock(catId, type, idx)}
            />;
      }
      subSeq += 1;
      return renderSubBlock(catId, type, block, idx, subSeq, ro);
    });
  };

  const renderSubBlock = (catId: number, type: 'current'|'next', block: SubBlock, idx: number, seq: number, ro: boolean) => {
    return (
      <div key={block.id} draggable={!ro}
        onDragStart={e => { e.stopPropagation(); dragSubRef.current = { catId, type, idx }; (e.currentTarget as HTMLElement).classList.add('dragging'); }}
        onDragEnd={e => { (e.currentTarget as HTMLElement).classList.remove('dragging'); setDragOverSubId(null); }}
        onDragOver={e => { e.preventDefault(); e.stopPropagation(); setDragOverSubId(block.id); }}
        onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverSubId(null); }}
        onDrop={e => { e.preventDefault(); e.stopPropagation(); if (dragSubRef.current && dragSubRef.current.catId === catId && dragSubRef.current.type === type) reorderSub(catId, type, dragSubRef.current.idx, idx); dragSubRef.current = null; setDragOverSubId(null); }}
        className={`drag-block${dragOverSubId === block.id && dragSubRef.current?.idx !== idx ? ' drag-over' : ''}`}
        style={{ marginBottom: '0.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
          {!ro && <span className="drag-handle" title="드래그하여 순서 변경">⠿</span>}
          <span style={{ fontWeight: 700, minWidth: '1.4rem', color: 'var(--primary)', fontSize: '1rem', flexShrink: 0 }}>{seq < 10 ? `①②③④⑤⑥⑦⑧⑨⑩`[seq] : `(${seq+1})`}</span>
          {ro ? (
            <div style={{ flex: 1, padding: '0.4rem 0.2rem', fontWeight: 600, fontSize: '0.88rem', whiteSpace: 'pre-wrap', wordBreak: 'break-word', minHeight: '34px' }}>{block.subText}</div>
          ) : (
            <textarea value={block.subText} onChange={e => setSubText(catId, type, idx, e.target.value)} className="input-field" placeholder="소분류 내용을 입력하세요..." rows={1}
              onInput={handleTextareaResize}
              style={{ flex: 1, borderTop: 'none', borderLeft: 'none', borderRight: 'none', fontWeight: 600, resize: 'none', minHeight: '34px', overflow: 'hidden', fontSize: '0.88rem', lineHeight: '1.4' }} />
          )}
          {!ro && <>
            <button onClick={() => addBullet(catId, type, idx)} className="icon-btn add" title="항목 추가">+ 항목</button>
            <button onClick={() => removeBlock(catId, type, idx)} className="icon-btn del" title="소분류 삭제">✕</button>
          </>}
        </div>
        {block.bullets.map((bul, bid) => (
          <div key={bul.id} draggable={!ro}
            onDragStart={e => { e.stopPropagation(); dragBulletRef.current = { catId, type, subIdx: idx, bulletIdx: bid }; (e.currentTarget as HTMLElement).classList.add('dragging'); }}
            onDragEnd={e => { (e.currentTarget as HTMLElement).classList.remove('dragging'); setDragOverBulletId(null); }}
            onDragOver={e => { e.preventDefault(); e.stopPropagation(); setDragOverBulletId(bul.id); }}
            onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverBulletId(null); }}
            onDrop={e => { e.preventDefault(); e.stopPropagation(); if (dragBulletRef.current && dragBulletRef.current.catId === catId && dragBulletRef.current.type === type && dragBulletRef.current.subIdx === idx) reorderBullet(catId, type, idx, dragBulletRef.current.bulletIdx, bid); dragBulletRef.current = null; setDragOverBulletId(null); }}
            className={`drag-block${dragOverBulletId === bul.id && dragBulletRef.current?.bulletIdx !== bid ? ' drag-over' : ''}`}
            style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', paddingLeft: '1.8rem', marginTop: '0.2rem' }}>
            {!ro && <span className="drag-handle" style={{ fontSize: '0.75rem' }}>⠿</span>}
            <span style={{ fontWeight: 600, color: 'var(--text-muted)', flexShrink: 0 }}>-</span>
            {ro ? (
              <div style={{ flex: 1, padding: '0.25rem 0.5rem', fontSize: '0.88rem', whiteSpace: 'pre-wrap', wordBreak: 'break-word', minHeight: '30px' }}>{bul.text}</div>
            ) : (
              <textarea value={bul.text} onChange={e => setBulletText(catId, type, idx, bid, e.target.value)} className="input-field" placeholder="내용을 입력하세요..." rows={1}
                onInput={handleTextareaResize}
                style={{ flex: 1, borderTop: 'none', borderLeft: 'none', borderRight: 'none', borderBottomStyle: 'dashed', borderBottomWidth: '1px', fontSize: '0.88rem', resize: 'none', minHeight: '30px', overflow: 'hidden' }} />
            )}
            {!ro && <button onClick={() => removeBullet(catId, type, idx, bid)} className="icon-btn del">✕</button>}
          </div>
        ))}
      </div>
    );
  };

  // 파트 > 대분류 > 중분류 계층 구성
  // 대분류 이름은 파트가 다르면 중복될 수 있으므로 (partId, major)로 구분한다.
  /** + 소분류 / + 표 버튼 묶음 */
  const AddBlockBar = ({ catId, type }: { catId: number; type: 'current'|'next' }) => (
    <div style={{ display: 'flex', gap: '0.4rem', marginTop: '1.5rem' }}>
      <button onClick={() => addSub(catId, type)} className="btn" style={{ fontSize: '0.8rem', background: 'var(--btn-bg)', color: 'var(--foreground)', flex: 1 }}>+ 소분류 추가</button>
      <button onClick={() => addTable(catId, type)} className="btn" style={{ fontSize: '0.8rem', background: 'var(--btn-bg)', color: 'var(--foreground)', width: '112px' }}>+ 표 추가</button>
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
      {/* 잠금 배너 */}
      {isLocked && (
        <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: '8px', padding: '1rem 1.5rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#dc2626', fontWeight: 600 }}>
          {'\u{1F512}'} {teams.length > 1 ? `${teams.find(t => t.id === activeTeamId)?.name ?? ''} 팀은 ` : ''}
          이 주차 취합이 완료되어 잠겨있습니다. 조회만 가능합니다.
          {teams.length > 1 && <span style={{ fontWeight: 400, fontSize: '0.85rem' }}>다른 탭은 계속 작성할 수 있습니다.</span>}
        </div>
      )}

      <div className="glass-panel write-header" style={{ padding: '2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <div>
          <h2 style={{ marginBottom: '0.5rem' }}>{userName}님의 주간보고</h2>
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
            <label>연도: <input type="number" value={year} onChange={e => setYear(parseInt(e.target.value, 10))} className="input-field" style={{ width: '80px', marginLeft: '0.5rem', padding: '0.3rem' }} /></label>
            <label>주차: <input type="number" value={weekNum} onChange={e => setWeekNum(parseInt(e.target.value, 10))} className="input-field" style={{ width: '80px', marginLeft: '0.5rem', padding: '0.3rem' }} /></label>
          </div>
        </div>
        <div className="write-actions" style={{ display: 'flex', gap: '1rem' }}>
          <button onClick={undo} disabled={!canUndo} className="btn" style={{ fontSize: '0.9rem' }}>↶ 실행취소</button>
          <button onClick={redo} disabled={!canRedo} className="btn" style={{ fontSize: '0.9rem' }}>↷ 다시실행</button>
          <button className="btn btn-primary" onClick={saveReport} disabled={saving} style={{ padding: '0.8rem 2rem', fontSize: '1.1rem' }}>
            {saving ? '저장중...' : teams.length > 1 ? '전체 저장' : '저장하기'}
          </button>
        </div>
      </div>

      {/* 소속 팀 탭 — 겸직자는 탭을 오가며 작성하고 한 번에 저장한다 */}
      {teams.length > 1 && (
        <div style={{ display: 'flex', gap: '0.3rem', marginBottom: '1.5rem', flexWrap: 'wrap', borderBottom: '2px solid var(--border)', paddingBottom: '0' }}>
          {teams.map(t => {
            const active = t.id === activeTeamId;
            const locked = lockByTeam[t.id];
            const edited = Object.keys(reportData).some(k => {
              const tid = teamOfCategory.get(parseInt(k, 10));
              if (tid !== t.id) return false;
              const d = reportData[parseInt(k, 10)];
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
          {partGroups.map(part => (
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
                          {renderBlocks(cat.id, 'current', prevWeekData[cat.id]?.current || [], true)}
                        </div>
                        <div>
                          <h5 style={{ marginBottom: '1rem', fontSize: '0.95rem', borderLeft: '3px solid var(--border)', paddingLeft: '0.5rem' }}>차주 진행예정사항</h5>
                          {renderBlocks(cat.id, 'next', prevWeekData[cat.id]?.next || [], true)}
                        </div>
                      </div>
                      <div className="inner-box" style={{ borderTopColor: 'var(--primary)' }}>
                        <h4 style={{ color: 'var(--primary)', marginBottom: '1.2rem', fontWeight: 800, fontSize: '0.95rem' }}>[이번 주] 금주 진행사항</h4>
                        {renderBlocks(cat.id, 'current', reportData[cat.id]?.current || [])}
                        {!isLocked && <AddBlockBar catId={cat.id} type="current" />}
                      </div>
                      <div className="inner-box" style={{ borderTopColor: 'var(--primary)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.2rem' }}>
                          <h4 style={{ color: 'var(--primary)', fontWeight: 800, fontSize: '0.95rem', margin: 0 }}>[이번 주] 차주 진행예정사항</h4>
                          {!isLocked && (reportData[cat.id]?.current?.length ?? 0) > 0 && (
                            <button onClick={() => copyCurrentToNext(cat.id)} className="btn" style={{ fontSize: '0.7rem', padding: '0.15rem 0.5rem', background: 'var(--btn-bg)', color: 'var(--foreground)', border: '1px solid var(--border)' }}>📋 금주내용 복사</button>
                          )}
                        </div>
                        {renderBlocks(cat.id, 'next', reportData[cat.id]?.next || [])}
                        {!isLocked && <AddBlockBar catId={cat.id} type="next" />}
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
