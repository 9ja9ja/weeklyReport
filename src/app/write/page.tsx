'use client';

import { useEffect, useState, useRef, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useHistory } from '@/lib/useHistory';
import { getWeekNumber } from '@/lib/weekUtils';
import { useUser } from '@/lib/UserContext';

const generateId = () => Math.random().toString(36).substring(2, 10);

type Bullet = { id: string; text: string };
type SubBlock = { id: string; subText: string; authorText?: string; bullets: Bullet[] };
type CateData = { current: SubBlock[], next: SubBlock[] };
type EditorState = Record<number, CateData>;

interface Category { id: number; major: string; middle: string; orderIdx: number; }

function WriteContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const userId = searchParams.get('userId');
  const userName = searchParams.get('name');
  const paramYear = searchParams.get('year');
  const paramWeek = searchParams.get('weekNum');
  const { teamId } = useUser();

  const [year, setYear] = useState(paramYear ? parseInt(paramYear, 10) : new Date().getFullYear());
  const [weekNum, setWeekNum] = useState(paramWeek ? parseInt(paramWeek, 10) : getWeekNumber(new Date()));
  const [categories, setCategories] = useState<Category[]>([]);
  const [majors, setMajors] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [isLocked, setIsLocked] = useState(false);

  const [prevWeekData, setPrevWeekData] = useState<EditorState>({});
  const { state: reportData, setState: setReportData, undo, redo, canUndo, canRedo, setInitialState } = useHistory<EditorState>({});

  const dragSubRef = useRef<{ catId: number; type: 'current'|'next'; idx: number } | null>(null);
  const dragBulletRef = useRef<{ catId: number; type: 'current'|'next'; subIdx: number; bulletIdx: number } | null>(null);
  const [dragOverSubId, setDragOverSubId] = useState<string | null>(null);
  const [dragOverBulletId, setDragOverBulletId] = useState<string | null>(null);

  useEffect(() => {
    if (!userId || !teamId) return router.push('/');
    fetchCategories().then(() => fetchReportsForWeek());
  }, [userId, teamId, year, weekNum]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isLocked) return;
      if (e.ctrlKey && e.key === 'z') { e.preventDefault(); undo(); }
      if (e.ctrlKey && e.key === 'y') { e.preventDefault(); redo(); }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undo, redo, isLocked]);

  const fetchCategories = async () => {
    if (!teamId) return;
    const [catRes, majRes] = await Promise.all([fetch(`/api/categories?teamId=${teamId}`), fetch(`/api/majors?teamId=${teamId}`)]);
    const cd = await catRes.json(); setCategories(Array.isArray(cd) ? cd : []);
    const md = await majRes.json(); setMajors(Array.isArray(md) ? md.map((m: any) => m.name) : []);
  };

  const fetchReportsForWeek = async () => {
    setLoading(true);
    try {
      // 잠금 상태 확인
      const lockRes = await fetch(`/api/reports/summary/lock?year=${year}&weekNum=${weekNum}&teamId=${teamId}`);
      const lockData = await lockRes.json();
      setIsLocked(lockData.isLocked ?? false);

      const prevW = weekNum > 1 ? weekNum - 1 : 52;
      const prevY = weekNum > 1 ? year : year - 1;

      const prevRes = await fetch(`/api/reports?userId=${userId}&year=${prevY}&weekNum=${prevW}`);
      const prevData = await prevRes.json();

      const prevMap: EditorState = {};
      if (prevData?.items) {
        prevData.items.forEach((item: any) => {
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
        curData.items.forEach((item: any) => {
          curMap[item.categoryId] = {
            current: typeof item.currentContents === 'string' ? JSON.parse(item.currentContents) : item.currentContents,
            next: typeof item.nextContents === 'string' ? JSON.parse(item.nextContents) : item.nextContents,
          };
        });
        setInitialState(curMap);
      } else {
        const curMap: EditorState = {};
        if (prevData?.items) {
          prevData.items.forEach((item: any) => {
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

  const saveReport = () => {
    if (isLocked) { alert('이 주차는 잠겨있어 저장할 수 없습니다.'); return; }
    const items = Object.keys(reportData).map(catId => ({
      categoryId: parseInt(catId),
      currentContents: reportData[parseInt(catId)]?.current || [],
      nextContents: reportData[parseInt(catId)]?.next || []
    })).filter(item => item.currentContents.length > 0 || item.nextContents.length > 0);

    if (items.length === 0) { alert('저장할 내용이 없습니다.'); return; }
    setShowConfirm(true);
  };

  const handleConfirmSave = async () => {
    setSaving(true);
    setShowConfirm(false);
    try {
      const items = Object.keys(reportData).map(catId => ({
        categoryId: parseInt(catId),
        currentContents: reportData[parseInt(catId)]?.current || [],
        nextContents: reportData[parseInt(catId)]?.next || []
      })).filter(item => item.currentContents.length > 0 || item.nextContents.length > 0);

      const res = await fetch('/api/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: parseInt(userId as string), year, weekNum, items })
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
  const updateState = (catId: number, type: 'current'|'next', modifyFn: (list: SubBlock[]) => SubBlock[]) => {
    if (isLocked) return;
    setReportData(prev => {
      const catData = prev[catId] ?? { current: [], next: [] };
      return { ...prev, [catId]: { ...catData, [type]: modifyFn([...catData[type]]) } };
    });
  };

  const addSub = (catId: number, type: 'current'|'next') => updateState(catId, type, list => [...list, { id: generateId(), subText: '', bullets: [] }]);
  const setSubText = (catId: number, type: 'current'|'next', index: number, val: string) => updateState(catId, type, list => { list[index] = { ...list[index], subText: val }; return list; });
  const removeSub = (catId: number, type: 'current'|'next', index: number) => updateState(catId, type, list => { list.splice(index, 1); return list; });
  const reorderSub = (catId: number, type: 'current'|'next', fromIdx: number, toIdx: number) => {
    if (fromIdx === toIdx) return;
    updateState(catId, type, list => { const n = [...list]; const [it] = n.splice(fromIdx, 1); n.splice(toIdx, 0, it); return n; });
  };
  const addBullet = (catId: number, type: 'current'|'next', index: number) => updateState(catId, type, list => {
    list[index] = { ...list[index], bullets: [...list[index].bullets, { id: generateId(), text: '' }] }; return list;
  });
  const setBulletText = (catId: number, type: 'current'|'next', si: number, bi: number, val: string) => updateState(catId, type, list => {
    const nb = [...list[si].bullets]; nb[bi] = { ...nb[bi], text: val }; list[si] = { ...list[si], bullets: nb }; return list;
  });
  const removeBullet = (catId: number, type: 'current'|'next', si: number, bi: number) => updateState(catId, type, list => {
    const nb = [...list[si].bullets]; nb.splice(bi, 1); list[si] = { ...list[si], bullets: nb }; return list;
  });
  const reorderBullet = (catId: number, type: 'current'|'next', si: number, from: number, to: number) => {
    if (from === to) return;
    updateState(catId, type, list => { const nb = [...list[si].bullets]; const [it] = nb.splice(from, 1); nb.splice(to, 0, it); return list.map((b, i) => i === si ? { ...b, bullets: nb } : b); });
  };

  const renderBlocks = (catId: number, type: 'current'|'next', blocks: SubBlock[], isReadonly = false) => {
    const ro = isReadonly || isLocked;
    if (!blocks || blocks.length === 0) return <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>내용 없음</span>;
    return blocks.map((block, idx) => (
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
          <span style={{ fontWeight: 700, minWidth: '1.4rem', color: 'var(--primary)', fontSize: '1rem', flexShrink: 0 }}>{idx < 10 ? `①②③④⑤⑥⑦⑧⑨⑩`[idx] : `(${idx+1})`}</span>
          {ro ? (
            <div style={{ flex: 1, padding: '0.4rem 0.2rem', fontWeight: 600, fontSize: '0.88rem', whiteSpace: 'pre-wrap', wordBreak: 'break-word', minHeight: '34px' }}>{block.subText}</div>
          ) : (
            <textarea value={block.subText} onChange={e => setSubText(catId, type, idx, e.target.value)} className="input-field" placeholder="소분류 내용을 입력하세요..." rows={1}
              onInput={e => { const t = e.target as HTMLTextAreaElement; t.style.height = 'auto'; t.style.height = `${t.scrollHeight}px`; }}
              style={{ flex: 1, borderTop: 'none', borderLeft: 'none', borderRight: 'none', fontWeight: 600, resize: 'none', minHeight: '34px', overflow: 'hidden', fontSize: '0.88rem', lineHeight: '1.4' }} />
          )}
          {!ro && <>
            <button onClick={() => addBullet(catId, type, idx)} className="icon-btn add" title="항목 추가">+ 항목</button>
            <button onClick={() => removeSub(catId, type, idx)} className="icon-btn del" title="소분류 삭제">✕</button>
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
                onInput={e => { const t = e.target as HTMLTextAreaElement; t.style.height = 'auto'; t.style.height = `${t.scrollHeight}px`; }}
                style={{ flex: 1, borderTop: 'none', borderLeft: 'none', borderRight: 'none', borderBottomStyle: 'dashed', borderBottomWidth: '1px', fontSize: '0.88rem', resize: 'none', minHeight: '30px', overflow: 'hidden' }} />
            )}
            {!ro && <button onClick={() => removeBullet(catId, type, idx, bid)} className="icon-btn del">✕</button>}
          </div>
        ))}
      </div>
    ));
  };

  const FIXED_MAJORS = majors;
  if (!userId || !teamId) return null;

  // 컨펌 모달용 데이터 그룹핑
  const getConfirmGroups = () => {
    return FIXED_MAJORS.map(major => {
      const majorCats = categories.filter(c => c.major === major);
      const catsWithData = majorCats.map(cat => ({
        cat,
        current: reportData[cat.id]?.current || [],
        next: reportData[cat.id]?.next || []
      })).filter(c => c.current.length > 0 || c.next.length > 0);
      return { major, cats: catsWithData };
    }).filter(g => g.cats.length > 0);
  };

  return (
    <div style={{ marginTop: '2rem' }}>
      {/* 잠금 배너 */}
      {isLocked && (
        <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: '8px', padding: '1rem 1.5rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#dc2626', fontWeight: 600 }}>
          🔒 이 주차는 취합이 완료되어 잠겨있습니다. 조회만 가능합니다.
        </div>
      )}

      <div className="glass-panel" style={{ padding: '2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <div>
          <h2 style={{ marginBottom: '0.5rem' }}>{userName}님의 주간보고</h2>
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
            <label>연도: <input type="number" value={year} onChange={e => setYear(parseInt(e.target.value, 10))} className="input-field" style={{ width: '80px', marginLeft: '0.5rem', padding: '0.3rem' }} /></label>
            <label>주차: <input type="number" value={weekNum} onChange={e => setWeekNum(parseInt(e.target.value, 10))} className="input-field" style={{ width: '80px', marginLeft: '0.5rem', padding: '0.3rem' }} /></label>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '1rem' }}>
          {!isLocked && <>
            <button onClick={undo} disabled={!canUndo} className="btn" style={{ fontSize: '0.9rem' }}>↶ 실행취소</button>
            <button onClick={redo} disabled={!canRedo} className="btn" style={{ fontSize: '0.9rem' }}>↷ 다시실행</button>
            <button className="btn btn-primary" onClick={saveReport} disabled={saving} style={{ padding: '0.8rem 2rem', fontSize: '1.1rem' }}>
              {saving ? '저장중...' : '저장하기'}
            </button>
          </>}
        </div>
      </div>

      {loading ? <p>로딩중...</p> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
          {FIXED_MAJORS.map(major => {
            const majorCats = categories.filter(c => c.major === major);
            return (
              <div key={major} className="glass-panel" style={{ padding: '2rem' }}>
                <h3 style={{ fontSize: '1.3rem', color: 'var(--primary)', marginBottom: '1.5rem', borderBottom: '2px solid var(--border)', paddingBottom: '0.5rem' }}>{major}</h3>
                {majorCats.map((cat, idx) => (
                  <div key={cat.id} style={{ marginBottom: '2rem' }}>
                    <div style={{ fontWeight: 600, fontSize: '1.1rem', marginBottom: '1rem', background: 'rgba(0,0,0,0.03)', padding: '0.5rem 1rem', borderRadius: '4px' }}>
                      ({idx + 1}) {cat.middle}
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1.5rem' }}>
                      <div className="inner-box" style={{ background: 'rgba(0,0,0,0.02)' }}>
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
                        {!isLocked && <button onClick={() => addSub(cat.id, 'current')} className="btn" style={{ fontSize: '0.8rem', marginTop: '1.5rem', background: 'var(--btn-bg)', color: 'var(--foreground)', width: '100%' }}>+ 소분류 추가</button>}
                      </div>
                      <div className="inner-box" style={{ borderTopColor: 'var(--primary)' }}>
                        <h4 style={{ color: 'var(--primary)', marginBottom: '1.2rem', fontWeight: 800, fontSize: '0.95rem' }}>[이번 주] 차주 진행예정사항</h4>
                        {renderBlocks(cat.id, 'next', reportData[cat.id]?.next || [])}
                        {!isLocked && <button onClick={() => addSub(cat.id, 'next')} className="btn" style={{ fontSize: '0.8rem', marginTop: '1.5rem', background: 'var(--btn-bg)', color: 'var(--foreground)', width: '100%' }}>+ 소분류 추가</button>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            );
          })}

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
                  {getConfirmGroups().map(group => (
                    <div key={group.major} style={{ marginBottom: '1.5rem' }}>
                      <div style={{ background: 'var(--primary)', color: 'white', padding: '0.5rem 1rem', borderRadius: '6px 6px 0 0', fontWeight: 700, fontSize: '1.05rem' }}>{group.major}</div>
                      {group.cats.map(({ cat, current, next }) => (
                        <div key={cat.id} style={{ border: '1px solid var(--border)', borderTop: 'none', padding: '1rem' }}>
                          <div style={{ fontWeight: 700, marginBottom: '0.8rem', fontSize: '0.95rem', color: 'var(--primary)' }}>({categories.filter(c => c.major === cat.major).indexOf(cat) + 1}) {cat.middle}</div>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
                            {/* 금주 */}
                            <div>
                              <div style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '0.5rem', borderBottom: '1px solid var(--border)', paddingBottom: '0.3rem' }}>금주 진행사항</div>
                              {current.length > 0 ? current.map((sub, sIdx) => (
                                <div key={sub.id} style={{ marginBottom: '0.4rem' }}>
                                  <div style={{ fontWeight: 600, fontSize: '0.88rem' }}>{sIdx < 10 ? `①②③④⑤⑥⑦⑧⑨⑩`[sIdx] : `(${sIdx+1})`} {sub.subText}</div>
                                  {sub.bullets.map(b => <div key={b.id} style={{ paddingLeft: '1.5rem', fontSize: '0.85rem', color: 'var(--text-muted)' }}>- {b.text}</div>)}
                                </div>
                              )) : <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>내용 없음</span>}
                            </div>
                            {/* 차주 */}
                            <div>
                              <div style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '0.5rem', borderBottom: '1px solid var(--border)', paddingBottom: '0.3rem' }}>차주 진행예정사항</div>
                              {next.length > 0 ? next.map((sub, sIdx) => (
                                <div key={sub.id} style={{ marginBottom: '0.4rem' }}>
                                  <div style={{ fontWeight: 600, fontSize: '0.88rem' }}>{sIdx < 10 ? `①②③④⑤⑥⑦⑧⑨⑩`[sIdx] : `(${sIdx+1})`} {sub.subText}</div>
                                  {sub.bullets.map(b => <div key={b.id} style={{ paddingLeft: '1.5rem', fontSize: '0.85rem', color: 'var(--text-muted)' }}>- {b.text}</div>)}
                                </div>
                              )) : <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>내용 없음</span>}
                            </div>
                          </div>
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
