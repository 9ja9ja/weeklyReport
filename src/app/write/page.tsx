'use client';

import { useEffect, useState, useRef, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useHistory } from '@/lib/useHistory';

const generateId = () => Math.random().toString(36).substring(2, 10);

type Bullet = { id: string; text: string };
type SubBlock = { id: string; subText: string; authorText?: string; bullets: Bullet[] };
type CateData = { current: SubBlock[], next: SubBlock[] };
type EditorState = Record<number, CateData>;

function WriteContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  
  const userId = searchParams.get('userId');
  const userName = searchParams.get('name');

  const [year, setYear] = useState(new Date().getFullYear());
  const [weekNum, setWeekNum] = useState(getWeekNumber(new Date()));
  const [categories, setCategories] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [prevWeekData, setPrevWeekData] = useState<EditorState>({});
  const { state: reportData, setState: setReportData, undo, redo, canUndo, canRedo, setInitialState } = useHistory<EditorState>({});

  const dragSubRef = useRef<{ catId: number; type: 'current'|'next'; idx: number } | null>(null);
  const dragBulletRef = useRef<{ catId: number; type: 'current'|'next'; subIdx: number; bulletIdx: number } | null>(null);
  const [dragOverSubId, setDragOverSubId] = useState<string | null>(null);
  const [dragOverBulletId, setDragOverBulletId] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) return router.push('/');
    fetchCategories().then(() => fetchReportsForWeek());
    const intv = setInterval(fetchCategories, 5000);
    return () => clearInterval(intv);
  }, [userId, year, weekNum]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 'z') { e.preventDefault(); undo(); }
      if (e.ctrlKey && e.key === 'y') { e.preventDefault(); redo(); }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undo, redo]);

  const fetchCategories = async () => {
    const res = await fetch('/api/categories');
    setCategories(await res.json());
  };

  const fetchReportsForWeek = async () => {
    setLoading(true);
    try {
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

  const saveReport = async () => {
    setSaving(true);
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
      else alert('저장 실패');
    } catch (e) {
      alert('오류 발생');
    } finally {
      setSaving(false);
    }
  };

  const handleAddCategory = async (major: string) => {
    const middle = prompt(`[${major}] 아래에 추가할 중분류 명칭을 입력하세요:`);
    if (!middle || !middle.trim()) return;
    await fetch('/api/categories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ major, middle: middle.trim() })
    });
    fetchCategories();
  };

  const handleDeleteCategory = async (id: number) => {
    if (!confirm('중분류를 삭제하시겠습니까?')) return;
    await fetch(`/api/categories?id=${id}`, { method: 'DELETE' });
    fetchCategories();
  };

  // State Builders
  const updateState = (catId: number, type: 'current'|'next', modifyFn: (list: SubBlock[]) => SubBlock[]) => {
    setReportData(prev => {
      const catData = prev[catId] ?? { current: [], next: [] };
      const modifiedList = modifyFn([...catData[type]]);
      return {
        ...prev,
        [catId]: {
          ...catData,
          [type]: modifiedList
        }
      };
    });
  };

  const addSub = (catId: number, type: 'current'|'next') => {
    updateState(catId, type, list => [...list, { id: generateId(), subText: '', bullets: [] }]);
  };
  const setSubText = (catId: number, type: 'current'|'next', index: number, val: string) => {
    updateState(catId, type, list => { list[index] = { ...list[index], subText: val }; return list; });
  };
  const removeSub = (catId: number, type: 'current'|'next', index: number) => {
    updateState(catId, type, list => { list.splice(index, 1); return list; });
  };
  const reorderSub = (catId: number, type: 'current'|'next', fromIdx: number, toIdx: number) => {
    if (fromIdx === toIdx) return;
    updateState(catId, type, list => {
      const next = [...list];
      const [item] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, item);
      return next;
    });
  };
  const addBullet = (catId: number, type: 'current'|'next', index: number) => {
    updateState(catId, type, list => { 
      list[index] = { ...list[index], bullets: [...list[index].bullets, { id: generateId(), text: '' }] };
      return list; 
    });
  };
  const setBulletText = (catId: number, type: 'current'|'next', subIndex: number, bulletIndex: number, val: string) => {
    updateState(catId, type, list => {
      const newBullets = [...list[subIndex].bullets];
      newBullets[bulletIndex] = { ...newBullets[bulletIndex], text: val };
      list[subIndex] = { ...list[subIndex], bullets: newBullets };
      return list;
    });
  };
  const removeBullet = (catId: number, type: 'current'|'next', subIndex: number, bulletIndex: number) => {
    updateState(catId, type, list => {
      const newBullets = [...list[subIndex].bullets];
      newBullets.splice(bulletIndex, 1);
      list[subIndex] = { ...list[subIndex], bullets: newBullets };
      return list;
    });
  };
  const reorderBullet = (catId: number, type: 'current'|'next', subIndex: number, fromIdx: number, toIdx: number) => {
    if (fromIdx === toIdx) return;
    updateState(catId, type, list => {
      const newBullets = [...list[subIndex].bullets];
      const [item] = newBullets.splice(fromIdx, 1);
      newBullets.splice(toIdx, 0, item);
      return list.map((b, i) => i === subIndex ? { ...b, bullets: newBullets } : b);
    });
  };

  const renderBlocks = (catId: number, type: 'current'|'next', blocks: SubBlock[], isReadonly = false) => {
    if (!blocks || blocks.length === 0) return <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>내용 없음</span>;
    return blocks.map((block, idx) => (
      <div
        key={block.id}
        draggable={!isReadonly}
        onDragStart={e => { e.stopPropagation(); dragSubRef.current = { catId, type, idx }; (e.currentTarget as HTMLElement).classList.add('dragging'); }}
        onDragEnd={e => { (e.currentTarget as HTMLElement).classList.remove('dragging'); setDragOverSubId(null); }}
        onDragOver={e => { e.preventDefault(); e.stopPropagation(); setDragOverSubId(block.id); }}
        onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverSubId(null); }}
        onDrop={e => {
          e.preventDefault(); e.stopPropagation();
          if (dragSubRef.current && dragSubRef.current.catId === catId && dragSubRef.current.type === type)
            reorderSub(catId, type, dragSubRef.current.idx, idx);
          dragSubRef.current = null; setDragOverSubId(null);
        }}
        className={`drag-block${dragOverSubId === block.id && dragSubRef.current?.idx !== idx ? ' drag-over' : ''}`}
        style={{ marginBottom: '0.5rem' }}
      >
        {/* 소분류 행 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
          {!isReadonly && <span className="drag-handle" title="드래그하여 순서 변경">⠿</span>}
          <span style={{ fontWeight: 700, minWidth: '1.4rem', color: 'var(--primary)', fontSize: '1rem', flexShrink: 0 }}>{`①②③④⑤⑥⑦⑧⑨⑩`[idx] || '①'}</span>
          {isReadonly ? (
            <div style={{ flex: 1, padding: '0.4rem 0.2rem', fontWeight: 600, color: 'var(--foreground)', fontSize: '0.88rem', lineHeight: '1.4', whiteSpace: 'pre-wrap', wordBreak: 'break-word', minHeight: '34px' }}>
              {block.subText}
            </div>
          ) : (
            <textarea
              value={block.subText}
              onChange={e => !isReadonly && setSubText(catId, type, idx, e.target.value)}
              readOnly={isReadonly}
              className="input-field"
              placeholder="소분류 내용을 입력하세요..."
              rows={1}
              onInput={e => { const t = e.target as HTMLTextAreaElement; t.style.height = 'auto'; t.style.height = `${t.scrollHeight}px`; }}
              style={{ flex: 1, borderTop: 'none', borderLeft: 'none', borderRight: 'none', fontWeight: 600, color: 'var(--foreground)', resize: 'none', minHeight: '34px', overflow: 'hidden', fontSize: '0.88rem', lineHeight: '1.4', paddingBottom: '2px' }}
            />
          )}
          {!isReadonly && <>
            <button onClick={() => addBullet(catId, type, idx)} className="icon-btn add" title="항목 추가">+ 항목</button>
            <button onClick={() => removeSub(catId, type, idx)} className="icon-btn del" title="소분류 삭제">✕</button>
          </>}
        </div>

        {/* 항목(-) 목록 */}
        {block.bullets.map((bul, bid) => (
          <div
            key={bul.id}
            draggable={!isReadonly}
            onDragStart={e => { e.stopPropagation(); dragBulletRef.current = { catId, type, subIdx: idx, bulletIdx: bid }; (e.currentTarget as HTMLElement).classList.add('dragging'); }}
            onDragEnd={e => { (e.currentTarget as HTMLElement).classList.remove('dragging'); setDragOverBulletId(null); }}
            onDragOver={e => { e.preventDefault(); e.stopPropagation(); setDragOverBulletId(bul.id); }}
            onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverBulletId(null); }}
            onDrop={e => {
              e.preventDefault(); e.stopPropagation();
              if (dragBulletRef.current && dragBulletRef.current.catId === catId && dragBulletRef.current.type === type && dragBulletRef.current.subIdx === idx)
                reorderBullet(catId, type, idx, dragBulletRef.current.bulletIdx, bid);
              dragBulletRef.current = null; setDragOverBulletId(null);
            }}
            className={`drag-block${dragOverBulletId === bul.id && dragBulletRef.current?.bulletIdx !== bid ? ' drag-over' : ''}`}
            style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', paddingLeft: '1.8rem', marginTop: '0.2rem' }}
          >
            {!isReadonly && <span className="drag-handle" style={{ fontSize: '0.75rem' }} title="드래그하여 순서 변경">⠿</span>}
            <span style={{ fontWeight: 600, color: 'var(--text-muted)', flexShrink: 0 }}>-</span>
            {isReadonly ? (
              <div style={{ flex: 1, padding: '0.25rem 0.5rem', fontSize: '0.88rem', color: 'var(--foreground)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', minHeight: '30px' }}>
                {bul.text}
              </div>
            ) : (
              <textarea
                value={bul.text}
                onChange={e => setBulletText(catId, type, idx, bid, e.target.value)}
                className="input-field"
                placeholder="내용을 입력하세요..."
                rows={1}
                onInput={e => { const t = e.target as HTMLTextAreaElement; t.style.height = 'auto'; t.style.height = `${t.scrollHeight}px`; }}
                style={{ flex: 1, borderTop: 'none', borderLeft: 'none', borderRight: 'none', borderBottomStyle: 'dashed', borderBottomWidth: '1px', fontSize: '0.88rem', color: 'var(--foreground)', resize: 'none', minHeight: '30px', overflow: 'hidden' }}
              />
            )}
            {!isReadonly && <button onClick={() => removeBullet(catId, type, idx, bid)} className="icon-btn del" title="항목 삭제">✕</button>}
          </div>
        ))}
      </div>
    ));
  };

  const FIXED_MAJORS = ['서비스', '제휴', '운영'];
  if (!userId) return null;

  return (
    <div style={{ marginTop: '2rem' }}>
      <div className="glass-panel" style={{ padding: '2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <div>
          <h2 style={{ marginBottom: '0.5rem' }}>{userName}님의 주간보고</h2>
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
            <label>연도: 
              <input type="number" value={year} onChange={e => setYear(parseInt(e.target.value))} className="input-field" style={{ width: '80px', marginLeft: '0.5rem', padding: '0.3rem' }} />
            </label>
            <label>주차: 
              <input type="number" value={weekNum} onChange={e => setWeekNum(parseInt(e.target.value))} className="input-field" style={{ width: '80px', marginLeft: '0.5rem', padding: '0.3rem' }} />
            </label>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '1rem' }}>
          <button onClick={undo} disabled={!canUndo} className="btn" style={{ fontSize: '0.9rem' }}>↶ 실행취소</button>
          <button onClick={redo} disabled={!canRedo} className="btn" style={{ fontSize: '0.9rem' }}>↷ 다시실행</button>
          <button className="btn btn-primary" onClick={saveReport} disabled={saving} style={{ padding: '0.8rem 2rem', fontSize: '1.1rem' }}>
            {saving ? '저장중...' : '저장하기'}
          </button>
        </div>
      </div>

      {loading ? <p>로딩중...</p> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
          {FIXED_MAJORS.map(major => {
            const majorCats = categories.filter(c => c.major === major);
            
            return (
              <div key={major} className="glass-panel" style={{ padding: '2rem' }}>
                <h3 style={{ fontSize: '1.3rem', color: 'var(--primary)', marginBottom: '1.5rem', borderBottom: '2px solid var(--border)', paddingBottom: '0.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>{major}</span>
                  <button onClick={() => handleAddCategory(major)} className="btn" style={{ fontSize: '0.9rem', padding: '0.3rem 0.8rem', background: 'var(--border)' }}>+ {major} 중분류 추가</button>
                </h3>
                
                {majorCats.map((cat, idx) => (
                  <div key={cat.id} style={{ marginBottom: '2rem' }}>
                    <div style={{ fontWeight: 600, fontSize: '1.1rem', marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(0,0,0,0.03)', padding: '0.5rem 1rem', borderRadius: '4px' }}>
                      <span>({idx + 1}) {cat.middle}</span>
                      <button onClick={() => handleDeleteCategory(cat.id)} style={{ border: 'none', background: 'transparent', color: 'red', cursor: 'pointer', fontSize: '0.9rem', opacity: 0.6 }}>삭제</button>
                    </div>
                    
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1.5rem' }}>
                      {/* 1. Left: Previous Week Readonly */}
                      <div className="inner-box" style={{ background: 'rgba(0,0,0,0.02)' }}>
                        <h4 style={{ color: 'var(--text-muted)', marginBottom: '1.2rem', fontWeight: 700, fontSize: '0.9rem', opacity: 0.7 }}>[지난 주 작성본]</h4>
                        <div style={{ marginBottom: '1.5rem' }}>
                          <h5 style={{ marginBottom: '1rem', fontSize: '0.95rem', color: 'var(--foreground)', borderLeft: '3px solid var(--border)', paddingLeft: '0.5rem' }}>금주 진행사항</h5>
                          {renderBlocks(cat.id, 'current', prevWeekData[cat.id]?.current || [], true)}
                        </div>
                        <div>
                          <h5 style={{ marginBottom: '1rem', fontSize: '0.95rem', color: 'var(--foreground)', borderLeft: '3px solid var(--border)', paddingLeft: '0.5rem' }}>차주 진행예정사항</h5>
                          {renderBlocks(cat.id, 'next', prevWeekData[cat.id]?.next || [], true)}
                        </div>
                      </div>

                      {/* 2. Middle: Current Week 'Current' */}
                      <div className="inner-box" style={{ borderTopColor: 'var(--primary)' }}>
                        <h4 style={{ color: 'var(--primary)', marginBottom: '1.2rem', fontWeight: 800, fontSize: '0.95rem' }}>[이번 주] 금주 진행사항</h4>
                        {renderBlocks(cat.id, 'current', reportData[cat.id]?.current || [])}
                        <button onClick={() => addSub(cat.id, 'current')} className="btn" style={{ fontSize: '0.8rem', marginTop: '1.5rem', background: 'var(--btn-bg)', color: 'var(--foreground)', width: '100%' }}>+ 소분류 추가</button>
                      </div>

                      {/* 3. Right: Current Week 'Next' */}
                      <div className="inner-box" style={{ borderTopColor: 'var(--primary)' }}>
                        <h4 style={{ color: 'var(--primary)', marginBottom: '1.2rem', fontWeight: 800, fontSize: '0.95rem' }}>[이번 주] 차주 진행예정사항</h4>
                        {renderBlocks(cat.id, 'next', reportData[cat.id]?.next || [])}
                        <button onClick={() => addSub(cat.id, 'next')} className="btn" style={{ fontSize: '0.8rem', marginTop: '1.5rem', background: 'var(--btn-bg)', color: 'var(--foreground)', width: '100%' }}>+ 소분류 추가</button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function getWeekNumber(d: Date) {
  d = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay()||7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(),0,1));
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1)/7);
}

export default function WritePage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <WriteContent />
    </Suspense>
  );
}
