'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useHistory } from '@/lib/useHistory';
import { useUser } from '@/lib/UserContext';
import { getWeekNumber } from '@/lib/weekUtils';

type Bullet = { id: string; text: string };
type SubBlock = { id: string; subText: string; authorText?: string; bullets: Bullet[] };
type CateData = { current: SubBlock[]; next: SubBlock[] };
type EditorState = Record<number, CateData>;

interface Category { id: number; major: string; middle: string; orderIdx: number; }
interface MajorInfo { id: number; name: string; orderIdx: number; }

export default function SummaryPage() {
  const [year, setYear] = useState(new Date().getFullYear());
  const [weekNum, setWeekNum] = useState(getWeekNumber(new Date()));
  const [categories, setCategories] = useState<Category[]>([]);
  const [majors, setMajors] = useState<MajorInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isLocked, setIsLocked] = useState(false);
  const { isMasterOrAbove, userId: currentUserId, teamId } = useUser();

  const { state: aggregatedMap, setState: setAggregatedMap, undo, redo, canUndo, canRedo, setInitialState } = useHistory<EditorState>({});

  const dragSubRef = useRef<{ catId: number; type: 'current' | 'next'; idx: number } | null>(null);
  const dragBulletRef = useRef<{ catId: number; type: 'current' | 'next'; subIdx: number; bulletIdx: number } | null>(null);
  const [dragOverSubId, setDragOverSubId] = useState<string | null>(null);
  const [dragOverBulletId, setDragOverBulletId] = useState<string | null>(null);
  const [copyExclude, setCopyExclude] = useState<Record<number, boolean>>({});

  const isEditMode = isMasterOrAbove && !isLocked;
  const showCopyButtons = isLocked;
  const majorNames = majors.map(m => m.name);

  const loadFromUsers = useCallback(async () => {
    if (!teamId) return {};
    try {
      const repRes = await fetch(`/api/reports?all=true&year=${year}&weekNum=${weekNum}&teamId=${teamId}`);
      const repData = await repRes.json();
      const map: EditorState = {};
      if (Array.isArray(repData)) {
        repData.forEach(report => {
          const userName = report.user.name;
          (report.items || []).forEach((item: any) => {
            if (!map[item.categoryId]) map[item.categoryId] = { current: [], next: [] };
            const cur: SubBlock[] = (typeof item.currentContents === 'string' ? JSON.parse(item.currentContents) : item.currentContents) ?? [];
            const nxt: SubBlock[] = (typeof item.nextContents === 'string' ? JSON.parse(item.nextContents) : item.nextContents) ?? [];
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
      const [catRes, majRes, sumRes] = await Promise.all([
        fetch(`/api/categories?teamId=${teamId}`),
        fetch(`/api/majors?teamId=${teamId}`),
        fetch(`/api/reports/summary?year=${year}&weekNum=${weekNum}&teamId=${teamId}`)
      ]);
      setCategories(await catRes.json());
      setMajors(await majRes.json());
      const sumData = await sumRes.json();
      setIsLocked(sumData?.isLocked ?? false);
      if (sumData?.contents) { setInitialState(JSON.parse(sumData.contents)); }
      else { setInitialState(await loadFromUsers()); }
      setCopyExclude({});
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [year, weekNum, teamId, setInitialState, loadFromUsers]);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (!isEditMode) return;
      if (e.ctrlKey && e.key === 'z') { e.preventDefault(); undo(); }
      if (e.ctrlKey && e.key === 'y') { e.preventDefault(); redo(); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [undo, redo, isEditMode]);

  const handleReset = async () => {
    if (isLocked) return;
    if (!confirm('개별 사용자들이 입력한 원본을 다시 불러오시겠습니까?')) return;
    setLoading(true);
    try { setInitialState(await loadFromUsers()); } finally { setLoading(false); }
  };

  const handleSave = async () => {
    if (isLocked) return;
    setSaving(true);
    try {
      await fetch('/api/reports/summary', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ year, weekNum, teamId, contents: JSON.stringify(aggregatedMap), requestUserId: currentUserId }) });
      alert('취합본이 저장되었습니다.');
    } catch { alert('저장 실패'); }
    finally { setSaving(false); }
  };

  const handleToggleLock = async () => {
    const action = isLocked ? '잠금을 해제' : '잠금을 설정';
    if (!confirm(`${year}년 ${weekNum}주차 ${action}하시겠습니까?${!isLocked ? '\n잠금 시 개별 입력과 편집이 차단됩니다.' : ''}`)) return;
    const res = await fetch('/api/reports/summary/lock', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ year, weekNum, teamId, isLocked: !isLocked, requestUserId: currentUserId }) });
    if (res.ok) { setIsLocked(!isLocked); alert(isLocked ? '잠금 해제됨' : '잠금 설정됨'); }
    else { const d = await res.json(); alert(d.error || '실패'); }
  };

  const nextWeekLabel = weekNum >= 52 ? `${year + 1}년 1주차` : `${weekNum + 1}주차`;

  // ── Copy ──
  const generateCopyData = (mode: 'all' | 'current' | 'next', targetMajor: string | null = null, excludeOverride?: Record<number, boolean>, skipEmpty = false) => {
    if (!aggregatedMap) return { text: '', html: '' };
    const exclude = excludeOverride ?? copyExclude;
    let text = '';
    let htmlLines: string[] = [];
    const majorsToCopy = targetMajor ? [targetMajor] : majorNames;
    const circled = (i: number) => i < 10 ? `⑴⑵⑶⑷⑸⑹⑺⑻⑼⑽`[i] : `(${i + 1})`;

    const renderSection = (cp: string, middle: string, blocks: SubBlock[]) => {
      let t = `${cp} ${middle || ''}\n`;
      let h = `<div>${cp} ${middle || ''}</div>`;
      blocks.forEach((block, i) => {
        const pf = i < 10 ? `①②③④⑤⑥⑦⑧⑨⑩`[i] : `(${i + 1})`;
        const auth = block.authorText ? ` [${block.authorText}]` : '';
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

    majorsToCopy.forEach(major => {
      const majorCats = categories.filter(c => c.major === major);
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

  const handleCopy = (mode: 'all' | 'current' | 'next', major: string | null = null) => {
    const { text, html } = generateCopyData(mode, major);
    if (!text) { alert('복사할 내용이 없습니다.'); return; }
    if (navigator.clipboard && window.isSecureContext && window.ClipboardItem) {
      navigator.clipboard.write([new ClipboardItem({ 'text/plain': new Blob([text], { type: 'text/plain' }), 'text/html': new Blob([html], { type: 'text/html' }) })]).then(() => alert('복사 완료')).catch(() => alert('복사 실패'));
    } else {
      const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.left = '-9999px'; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); alert('복사 완료');
    }
  };

  const handleCopyExcludeEmpty = () => {
    if (!aggregatedMap) return;
    const newExclude: Record<number, boolean> = {};
    categories.forEach(cat => {
      const data = aggregatedMap[cat.id] || { current: [], next: [] };
      if (data.current.length === 0 && data.next.length === 0) {
        newExclude[cat.id] = true;
      }
    });
    setCopyExclude(newExclude);
    const { text, html } = generateCopyData('all', null, newExclude, true);
    if (!text) { alert('복사할 내용이 없습니다.'); return; }
    if (navigator.clipboard && window.isSecureContext && window.ClipboardItem) {
      navigator.clipboard.write([new ClipboardItem({ 'text/plain': new Blob([text], { type: 'text/plain' }), 'text/html': new Blob([html], { type: 'text/html' }) })]).then(() => alert('복사 완료')).catch(() => alert('복사 실패'));
    } else {
      const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.left = '-9999px'; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); alert('복사 완료');
    }
  };

  // ── State Builders ──
  const updateState = (catId: number, type: 'current' | 'next', fn: (l: SubBlock[]) => SubBlock[]) => {
    if (!isEditMode) return;
    setAggregatedMap((prev: EditorState) => {
      const d = prev[catId] ?? { current: [], next: [] };
      return { ...prev, [catId]: { ...d, [type]: fn([...d[type]]) } };
    });
  };

  const setSubText = (c: number, t: 'current' | 'next', i: number, v: string) => updateState(c, t, l => { l[i] = { ...l[i], subText: v }; return l; });
  const setAuthorText = (c: number, t: 'current' | 'next', i: number, v: string) => updateState(c, t, l => { l[i] = { ...l[i], authorText: v }; return l; });
  const removeSub = (c: number, t: 'current' | 'next', i: number) => updateState(c, t, l => { l.splice(i, 1); return l; });
  const reorderSub = (c: number, t: 'current' | 'next', from: number, to: number) => { if (from === to) return; updateState(c, t, l => { const n = [...l]; const [it] = n.splice(from, 1); n.splice(to, 0, it); return n; }); };
  const addSub = (c: number, t: 'current' | 'next') => updateState(c, t, l => [...l, { id: Math.random().toString(36).slice(2, 10), subText: '', bullets: [] }]);
  const addBullet = (c: number, t: 'current' | 'next', i: number) => updateState(c, t, l => { l[i] = { ...l[i], bullets: [...l[i].bullets, { id: Math.random().toString(36).slice(2, 10), text: '' }] }; return l; });
  const setBulletText = (c: number, t: 'current' | 'next', si: number, bi: number, v: string) => updateState(c, t, l => { const nb = [...l[si].bullets]; nb[bi] = { ...nb[bi], text: v }; l[si] = { ...l[si], bullets: nb }; return l; });
  const removeBullet = (c: number, t: 'current' | 'next', si: number, bi: number) => updateState(c, t, l => { const nb = [...l[si].bullets]; nb.splice(bi, 1); l[si] = { ...l[si], bullets: nb }; return l; });
  const reorderBullet = (c: number, t: 'current' | 'next', si: number, from: number, to: number) => { if (from === to) return; updateState(c, t, l => { const nb = [...l[si].bullets]; const [it] = nb.splice(from, 1); nb.splice(to, 0, it); return l.map((b, i) => i === si ? { ...b, bullets: nb } : b); }); };

  const moveBulletGlobal = (fc: number, ft: 'current' | 'next', fsi: number, fbi: number, tc: number, tt: 'current' | 'next', tsi: number) => {
    if (!isEditMode) return;
    setAggregatedMap(prev => {
      const nm = { ...prev };
      const sd = { ...nm[fc] }; const sl = [...(sd[ft] || [])];
      if (!sl[fsi]) return prev;
      const ss = { ...sl[fsi] }; const mb = ss.bullets[fbi]; if (!mb) return prev;
      ss.bullets = ss.bullets.filter((_, i) => i !== fbi); sl[fsi] = ss;
      let removed = false;
      if (!ss.subText.trim() && ss.bullets.length === 0) { sl.splice(fsi, 1); removed = true; }
      nm[fc] = { ...sd, [ft]: sl };
      const dd = { ...nm[tc] }; const dl = [...(dd[tt] || [])];
      let fi = tsi;
      if (fc === tc && ft === tt && removed && fsi < tsi) fi--;
      if (!dl[fi]) return nm;
      const ds = { ...dl[fi] }; ds.bullets = [...ds.bullets, mb]; dl[fi] = ds;
      nm[tc] = { ...dd, [tt]: dl };
      return nm;
    });
  };

  // ── Render ──
  const renderReadOnlyBlocks = (blocks: SubBlock[]) => {
    if (!blocks || blocks.length === 0) return <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem', paddingLeft: '1rem' }}>내용 없음</span>;
    return blocks.map((b, idx) => (
      <div key={b.id} style={{ marginBottom: '0.4rem' }}>
        <div style={{ fontWeight: 600, fontSize: '0.88rem' }}>
          {idx < 10 ? `①②③④⑤⑥⑦⑧⑨⑩`[idx] : `(${idx + 1})`} {b.subText}
          {b.authorText && <span style={{ color: 'var(--primary)', fontWeight: 700, marginLeft: '0.3rem' }}>[{b.authorText}]</span>}
        </div>
        {b.bullets.map(bul => <div key={bul.id} style={{ paddingLeft: '2rem', fontSize: '0.85rem', color: 'var(--text-muted)' }}>- {bul.text}</div>)}
      </div>
    ));
  };

  const renderEditBlocks = (catId: number, type: 'current' | 'next', blocks: SubBlock[]) => {
    if (!blocks || blocks.length === 0) return <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem', paddingLeft: '2rem' }}>내용 없음</span>;
    return blocks.map((block, idx) => (
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
          <span style={{ fontWeight: 700, minWidth: '1.4rem', color: 'var(--primary)', fontSize: '1rem', flexShrink: 0 }}>{idx < 10 ? `①②③④⑤⑥⑦⑧⑨⑩`[idx] : `(${idx + 1})`}</span>
          <textarea value={block.subText} onChange={e => setSubText(catId, type, idx, e.target.value)} className="input-field" placeholder="소분류 내용..." rows={1}
            onInput={e => { const t = e.target as HTMLTextAreaElement; t.style.height = 'auto'; t.style.height = `${t.scrollHeight}px`; }}
            style={{ flex: 1, borderTop: 'none', borderLeft: 'none', borderRight: 'none', fontWeight: 600, resize: 'none', minHeight: '34px', overflow: 'hidden', fontSize: '0.88rem', lineHeight: '1.4' }} />
          <span style={{ color: 'var(--primary)', fontWeight: 700, flexShrink: 0 }}>[</span>
          <input value={block.authorText || ''} onChange={e => setAuthorText(catId, type, idx, e.target.value)} className="input-field"
            style={{ width: '60px', padding: '0.2rem 0.1rem', background: 'transparent', borderTop: 'none', borderLeft: 'none', borderRight: 'none', borderBottomColor: 'var(--primary)', color: 'var(--primary)', fontWeight: 600, textAlign: 'center', fontSize: '0.85rem' }} />
          <span style={{ color: 'var(--primary)', fontWeight: 700, flexShrink: 0 }}>]</span>
          <button onClick={() => addBullet(catId, type, idx)} className="icon-btn add">+ 항목</button>
          <button onClick={() => removeSub(catId, type, idx)} className="icon-btn del">✕</button>
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
            <textarea value={bul.text} onChange={e => setBulletText(catId, type, idx, bid, e.target.value)} className="input-field" rows={1}
              onInput={e => { const t = e.target as HTMLTextAreaElement; t.style.height = 'auto'; t.style.height = `${t.scrollHeight}px`; }}
              style={{ flex: 1, borderTop: 'none', borderLeft: 'none', borderRight: 'none', borderBottom: '1px dashed var(--border)', fontSize: '0.88rem', resize: 'none', minHeight: '30px', overflow: 'hidden', padding: '0.25rem 0.5rem' }} />
            <button onClick={() => removeBullet(catId, type, idx, bid)} className="icon-btn del">✕</button>
          </div>
        ))}
      </div>
    ));
  };

  if (!aggregatedMap) return null;

  return (
    <div className="glass-panel" style={{ padding: '2rem', marginTop: '2rem' }}>
      {isLocked && (
        <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: '8px', padding: '0.8rem 1.5rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#dc2626', fontWeight: 600, fontSize: '0.9rem' }}>
          🔒 이 주차의 취합본은 잠겨있습니다.
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
          <h2 style={{ fontSize: '1.5rem', margin: 0 }}>주간보고 취합본</h2>
          {showCopyButtons && (
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button onClick={() => handleCopy('all')} className="btn" style={{ fontSize: '0.8rem', padding: '0.3rem 0.8rem', background: 'var(--primary)', color: 'white' }}>전체 복사</button>
              <button onClick={() => handleCopy('current')} className="btn" style={{ fontSize: '0.8rem', padding: '0.3rem 0.8rem', background: 'var(--primary)', color: 'white', opacity: 0.9 }}>금주만 복사</button>
              <button onClick={() => handleCopy('next')} className="btn" style={{ fontSize: '0.8rem', padding: '0.3rem 0.8rem', background: 'var(--primary)', color: 'white', opacity: 0.9 }}>차주만 복사</button>
              <button onClick={handleCopyExcludeEmpty} className="btn" style={{ fontSize: '0.8rem', padding: '0.3rem 0.8rem', background: '#f59e0b', color: 'white', border: 'none' }}>내용없음 빼고 복사</button>
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
          <button onClick={handleReset} className="btn" style={{ fontSize: '0.9rem', color: 'var(--primary)', borderColor: 'var(--primary)' }}>⟲ 원본 재조회</button>
          <button onClick={undo} disabled={!canUndo} className="btn" style={{ fontSize: '0.9rem' }}>↶ 실행취소</button>
          <button onClick={redo} disabled={!canRedo} className="btn" style={{ fontSize: '0.9rem' }}>↷ 다시실행</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving} style={{ padding: '0.4rem 2rem', fontSize: '1rem' }}>{saving ? '저장중...' : '저장'}</button>
        </>}
        {isMasterOrAbove && (
          <button onClick={handleToggleLock} className="btn" style={{ fontSize: '0.9rem', padding: '0.4rem 1.2rem', background: isLocked ? '#22c55e' : '#ef4444', color: 'white', border: 'none' }}>
            {isLocked ? '🔓 잠금 해제' : '🔒 잠금 설정'}
          </button>
        )}
      </div>

      {loading ? <p>데이터를 불러오는 중입니다...</p> : isEditMode ? (
        /* ── 편집 모드 (마스터 + 미잠금) ── */
        <div style={{ overflowX: 'auto' }}>
          <table style={{ minWidth: '1000px' }}>
            <thead>
              <tr>
                <th style={{ width: '10%' }}>분류</th>
                <th style={{ width: '12%' }}></th>
                <th style={{ width: '39%' }}>{weekNum}주차 금주</th>
                <th style={{ width: '39%' }}>{nextWeekLabel} 차주</th>
              </tr>
            </thead>
            <tbody>
              {majorNames.map(major => {
                const majorCats = categories.filter(c => c.major === major);
                if (majorCats.length === 0) return null;
                return majorCats.map((cat, idx) => {
                  const data = aggregatedMap[cat.id] || { current: [], next: [] };
                  return (
                    <tr key={cat.id}>
                      {idx === 0 && (
                        <td rowSpan={majorCats.length} style={{ fontWeight: 'bold', textAlign: 'center', verticalAlign: 'middle' }}>{major}</td>
                      )}
                      <td style={{ fontWeight: 500 }}>({idx + 1}) {cat.middle}</td>
                      <td style={{ verticalAlign: 'top' }}>
                        {renderEditBlocks(cat.id, 'current', data.current)}
                        <button onClick={() => addSub(cat.id, 'current')} className="btn" style={{ fontSize: '0.75rem', marginTop: '0.5rem', background: 'var(--btn-bg)', color: 'var(--foreground)', opacity: 0.6 }}>+ 소분류</button>
                      </td>
                      <td style={{ verticalAlign: 'top' }}>
                        {renderEditBlocks(cat.id, 'next', data.next)}
                        <button onClick={() => addSub(cat.id, 'next')} className="btn" style={{ fontSize: '0.75rem', marginTop: '0.5rem', background: 'var(--btn-bg)', color: 'var(--foreground)', opacity: 0.6 }}>+ 소분류</button>
                      </td>
                    </tr>
                  );
                });
              })}
            </tbody>
          </table>
        </div>
      ) : (
        /* ── 읽기전용 모드 ── */
        <div style={{ overflowX: 'auto' }}>
          <table style={{ minWidth: '1000px' }}>
            <thead>
              <tr>
                <th style={{ width: '10%' }}>분류</th>
                <th style={{ width: '12%' }}></th>
                <th style={{ width: '39%' }}>{weekNum}주차 금주</th>
                <th style={{ width: '39%' }}>{nextWeekLabel} 차주</th>
              </tr>
            </thead>
            <tbody>
              {majorNames.map(major => {
                const majorCats = categories.filter(c => c.major === major);
                if (majorCats.length === 0) return null;
                return majorCats.map((cat, idx) => {
                  const data = aggregatedMap[cat.id] || { current: [], next: [] };
                  return (
                    <tr key={cat.id}>
                      {idx === 0 && (
                        <td rowSpan={majorCats.length} style={{ fontWeight: 'bold', textAlign: 'center', verticalAlign: 'middle' }}>
                          {major}
                          {showCopyButtons && (
                            <div style={{ marginTop: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.2rem', alignItems: 'center' }}>
                              <button onClick={() => handleCopy('all', major)} className="btn" style={{ fontSize: '0.7rem', padding: '0.15rem 0.3rem', width: '90%' }}>복사</button>
                            </div>
                          )}
                        </td>
                      )}
                      <td style={{ fontWeight: 500, opacity: copyExclude[cat.id] ? 0.4 : 1, background: copyExclude[cat.id] ? 'rgba(0,0,0,0.03)' : undefined }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                          {showCopyButtons && (
                            <input type="checkbox" checked={!copyExclude[cat.id]} onChange={() => setCopyExclude(prev => {
                              const next = { ...prev };
                              if (next[cat.id]) { delete next[cat.id]; } else { next[cat.id] = true; }
                              return next;
                            })} style={{ cursor: 'pointer', accentColor: 'var(--primary)' }} title="복사 포함/제외" />
                          )}
                          ({idx + 1}) {cat.middle}
                        </div>
                      </td>
                      <td style={{ verticalAlign: 'top', padding: '0.8rem', opacity: copyExclude[cat.id] ? 0.4 : 1, background: copyExclude[cat.id] ? 'rgba(0,0,0,0.03)' : undefined }}>{renderReadOnlyBlocks(data.current)}</td>
                      <td style={{ verticalAlign: 'top', padding: '0.8rem', opacity: copyExclude[cat.id] ? 0.4 : 1, background: copyExclude[cat.id] ? 'rgba(0,0,0,0.03)' : undefined }}>{renderReadOnlyBlocks(data.next)}</td>
                    </tr>
                  );
                });
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

