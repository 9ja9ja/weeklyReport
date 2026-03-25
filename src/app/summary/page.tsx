'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useHistory } from '@/lib/useHistory';

type Bullet = { id: string; text: string };
type SubBlock = { id: string; subText: string; authorText?: string; bullets: Bullet[] };
type CateData = { current: SubBlock[], next: SubBlock[] };
type EditorState = Record<number, CateData>;

interface Category {
  id: number;
  major: string;
  middle: string;
  orderIndex: number;
}

export default function SummaryPage() {
  const [year, setYear] = useState(new Date().getFullYear());
  const [weekNum, setWeekNum] = useState(getWeekNumber(new Date()));
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const { state: aggregatedMap, setState: setAggregatedMap, undo, redo, canUndo, canRedo, setInitialState } = useHistory<EditorState>({});

  const dragSubRef = useRef<{ catId: number; type: 'current'|'next'; idx: number } | null>(null);
  const dragBulletRef = useRef<{ catId: number; type: 'current'|'next'; subIdx: number; bulletIdx: number } | null>(null);
  const [dragOverSubId, setDragOverSubId] = useState<string | null>(null);
  const [dragOverBulletId, setDragOverBulletId] = useState<string | null>(null);

  const loadFromUsers = useCallback(async () => {
    try {
      const repRes = await fetch(`/api/reports?all=true&year=${year}&weekNum=${weekNum}`);
      const repData = await repRes.json();
      
      const map: EditorState = {};
      if (Array.isArray(repData)) {
        repData.forEach(report => {
          const userName = report.user.name;
          (report.items || []).forEach((item: any) => {
            if (!map[item.categoryId]) map[item.categoryId] = { current: [], next: [] };
            
            const curBlocks: SubBlock[] = (typeof item.currentContents === 'string' ? JSON.parse(item.currentContents) : item.currentContents) ?? [];
            const nextBlocks: SubBlock[] = (typeof item.nextContents === 'string' ? JSON.parse(item.nextContents) : item.nextContents) ?? [];

            curBlocks.forEach(b => {
               const block = { ...b };
               block.authorText = block.authorText || userName; 
               map[item.categoryId].current.push(block);
            });
            nextBlocks.forEach(b => {
               const block = { ...b };
               block.authorText = block.authorText || userName;
               map[item.categoryId].next.push(block);
            });
          });
        });
      }
      return map;
    } catch (e) {
      console.error(e);
      return {};
    }
  }, [year, weekNum]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const catRes = await fetch('/api/categories');
      setCategories(await catRes.json());

      const sumRes = await fetch(`/api/reports/summary?year=${year}&weekNum=${weekNum}`);
      const sumData = await sumRes.json();
      
      if (sumData?.contents) {
        setInitialState(JSON.parse(sumData.contents));
      } else {
        const merged = await loadFromUsers();
        setInitialState(merged);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [year, weekNum, setInitialState, loadFromUsers]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleReset = async () => {
    if (!confirm('기존 저장된 취합본을 편집중인 화면에서 무시하고, 개별 사용자들이 입력한 원본을 다시 불러오시겠습니까?')) return;
    setLoading(true);
    try {
      const merged = await loadFromUsers();
      setInitialState(merged);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await fetch('/api/reports/summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year, weekNum, contents: JSON.stringify(aggregatedMap) })
      });
      alert('취합본이 저장되었습니다.');
    } catch (e) {
      alert('저장 실패');
    } finally {
      setSaving(false);
    }
  };

  const deleteCategory = (catId: number) => {
    if (!confirm('문서 취합 화면에서 해당 중분류 항목을 삭제하시겠습니까? (DB 원본은 보존되나 취합본에서는 제외됩니다)')) return;
    setCategories(prev => prev.filter(c => c.id !== catId));
  };

  const moveCategory = async (major: string, catIdx: number, dir: -1|1) => {
    const majorCats = categories.filter((c: Category) => c.major === major);
    if (catIdx + dir < 0 || catIdx + dir >= majorCats.length) return;

    const catA = majorCats[catIdx];
    const catB = majorCats[catIdx + dir];

    const newCats = [...categories];
    const aGlobIdx = newCats.findIndex((c: Category) => c.id === catA.id);
    const bGlobIdx = newCats.findIndex((c: Category) => c.id === catB.id);

    newCats[aGlobIdx] = catB;
    newCats[bGlobIdx] = catA;

    // 1. UI 선반영
    setCategories(newCats);

    // 2. API 호출
    const orderedIds = newCats.map(c => c.id);
    fetch('/api/categories', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ categoryIds: orderedIds })
    }).catch(err => {
      console.error('Failed to update category order:', err);
      alert('순서 저장에 실패했습니다. 화면을 새로고침 해주세요.');
    });
  };

  const generateId = () => Math.random().toString(36).substring(2, 10);

  const addSub = (catId: number, type: 'current'|'next') => {
    updateState(catId, type, list => [...list, { id: generateId(), subText: '', bullets: [] }]);
  };
  
  const addBullet = (catId: number, type: 'current'|'next', index: number) => {
    updateState(catId, type, list => { 
      const newList = [...list];
      newList[index] = { ...newList[index], bullets: [...newList[index].bullets, { id: generateId(), text: '' }] };
      return newList; 
    });
  };

  const FIXED_MAJORS = ['서비스', '제휴', '운영'];
  const nextWeekLabel = weekNum >= 52 ? `${year + 1}년 1주차` : `${weekNum + 1}주차`;

  const generateCopyData = (mode: 'all' | 'current' | 'next', targetMajor: string | null = null) => {
    if (!aggregatedMap) return { text: '', html: '' };
    let text = '';
    let htmlLines: string[] = [];
    const majorsToCopy = targetMajor ? [targetMajor] : FIXED_MAJORS;

    majorsToCopy.forEach(major => {
      const majorCats = categories.filter(c => c.major === major);
      if (majorCats.length === 0) return;

      let majorCurText = '';
      let majorNxtText = '';
      let majorCurHtml = '';
      let majorNxtHtml = '';

      majorCats.forEach((cat, idx) => {
        const data = aggregatedMap[cat.id] || { current: [], next: [] };

        const catPrefix = `⑴⑵⑶⑷⑸⑹⑺⑻⑼⑽`[idx] || `(${idx + 1})`;

        // Current
        if (mode === 'all' || mode === 'current') {
          majorCurText += `${catPrefix} ${cat.middle || ''}\n`;
          majorCurHtml += `<div>${catPrefix} ${cat.middle || ''}</div>`;
          
          if (data.current.length > 0) {
            data.current.forEach((block, i) => {
              const prefix = i < 10 ? `①②③④⑤⑥⑦⑧⑨⑩`[i] : `(${i + 1})`;
              const auth = block.authorText ? ` [${block.authorText}]` : '';
              majorCurText += `     ${prefix} ${block.subText || ''}${auth}\n`;
              majorCurHtml += `<div>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;${prefix} ${block.subText || ''}${auth}</div>`;
              
              block.bullets.forEach(bul => {
                majorCurText += `          - ${bul.text || ''}\n`;
                majorCurHtml += `<div>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;- ${bul.text || ''}</div>`;
              });
            });
          } else {
            // 소분류가 없을 경우 '① 내용없음' 추가
            majorCurText += `     ① 내용없음\n`;
            majorCurHtml += `<div>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;① 내용없음</div>`;
          }
        }

        // Next
        if (mode === 'all' || mode === 'next') {
          majorNxtText += `${catPrefix} ${cat.middle || ''}\n`;
          majorNxtHtml += `<div>${catPrefix} ${cat.middle || ''}</div>`;
          
          if (data.next.length > 0) {
            data.next.forEach((block, i) => {
              const prefix = i < 10 ? `①②③④⑤⑥⑦⑧⑨⑩`[i] : `(${i + 1})`;
              const auth = block.authorText ? ` [${block.authorText}]` : '';
              majorNxtText += `     ${prefix} ${block.subText || ''}${auth}\n`;
              majorNxtHtml += `<div>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;${prefix} ${block.subText || ''}${auth}</div>`;
              
              block.bullets.forEach(bul => {
                majorNxtText += `          - ${bul.text || ''}\n`;
                majorNxtHtml += `<div>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;- ${bul.text || ''}</div>`;
              });
            });
          } else {
            // 소분류가 없을 경우 '① 내용없음' 추가
            majorNxtText += `     ① 내용없음\n`;
            majorNxtHtml += `<div>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;① 내용없음</div>`;
          }
        }
      });

      if (mode === 'all') {
        text += `${majorCurText.trim()}\t${majorNxtText.trim()}\n`;
        const tdStyle = 'border: 0.5pt solid #7f7f7f; padding: 2pt; vertical-align: top;';
        htmlLines.push(`<tr style="border: 0.5pt solid #7f7f7f;"><td style="${tdStyle}">${majorCurHtml}</td><td style="${tdStyle}">${majorNxtHtml}</td></tr>`);
      } else if (mode === 'current') {
        text += `${majorCurText.trim()}\n\n`;
        htmlLines.push(`<div>${majorCurHtml}</div><br/>`);
      } else {
        text += `${majorNxtText.trim()}\n\n`;
        htmlLines.push(`<div>${majorNxtHtml}</div><br/>`);
      }
    });

    const finalHtml = mode === 'all' 
      ? `<table style="border-collapse: collapse; width: 100%; border: 0.5pt solid #7f7f7f;">${htmlLines.join('')}</table>` 
      : htmlLines.join('');

    return { text: text.trim(), html: finalHtml };
  };

  const handleCopy = (mode: 'all' | 'current' | 'next', major: string | null = null) => {
    try {
      const { text, html } = generateCopyData(mode, major);
      if (!text) {
        alert('복사할 내용이 없습니다.');
        return;
      }

      const copyToClipboard = async (str: string, htmlStr: string) => {
        if (navigator.clipboard && window.isSecureContext && window.ClipboardItem) {
          const typeText = "text/plain";
          const typeHtml = "text/html";
          const blobText = new Blob([str], { type: typeText });
          const blobHtml = new Blob([htmlStr], { type: typeHtml });
          const data = [new ClipboardItem({ [typeText]: blobText, [typeHtml]: blobHtml })];
          return navigator.clipboard.write(data);
        } else {
          // Fallback to text only for older browsers
          const textArea = document.createElement("textarea");
          textArea.value = str;
          textArea.style.position = "fixed";
          textArea.style.left = "-999999px";
          textArea.style.top = "-999999px";
          document.body.appendChild(textArea);
          textArea.focus();
          textArea.select();
          document.execCommand('copy');
          textArea.remove();
        }
      };

      copyToClipboard(text, html).then(() => {
        const modeText = mode === 'all' ? '전체' : (mode === 'current' ? '금주내용' : '차주내용');
        alert(`${major ? `[${major}] ` : ''}${modeText} 복사가 완료되었습니다.`);
      }).catch(err => {
        console.error('Copy failed:', err);
        alert('복사에 실패했습니다.');
      });
    } catch (error) {
      console.error('Error in handleCopy:', error);
      alert('오류가 발생했습니다.');
    }
  };

  // State Builders
  const updateState = (catId: number, type: 'current'|'next', modifyFn: (list: SubBlock[]) => SubBlock[]) => {
    setAggregatedMap((prev: EditorState) => {
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

  const setSubText = (catId: number, type: 'current'|'next', index: number, val: string) => updateState(catId, type, list => { list[index] = { ...list[index], subText: val }; return list; });
  const setAuthorText = (catId: number, type: 'current'|'next', index: number, val: string) => updateState(catId, type, list => { list[index] = { ...list[index], authorText: val }; return list; });
  const removeSub = (catId: number, type: 'current'|'next', index: number) => updateState(catId, type, list => { list.splice(index, 1); return list; });
  const reorderSub = (catId: number, type: 'current'|'next', fromIdx: number, toIdx: number) => {
    if (fromIdx === toIdx) return;
    updateState(catId, type, list => {
      const next = [...list];
      const [item] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, item);
      return next;
    });
  };

  const setBulletText = (catId: number, type: 'current'|'next', subIndex: number, bulletIndex: number, val: string) => updateState(catId, type, list => {
    const newBullets = [...list[subIndex].bullets];
    newBullets[bulletIndex] = { ...newBullets[bulletIndex], text: val };
    list[subIndex] = { ...list[subIndex], bullets: newBullets };
    return list;
  });
  const removeBullet = (catId: number, type: 'current'|'next', subIndex: number, bulletIndex: number) => updateState(catId, type, list => {
    const newBullets = [...list[subIndex].bullets];
    newBullets.splice(bulletIndex, 1);
    list[subIndex] = { ...list[subIndex], bullets: newBullets };
    return list;
  });
  const reorderBullet = (catId: number, type: 'current'|'next', subIndex: number, fromIdx: number, toIdx: number) => {
    if (fromIdx === toIdx) return;
    updateState(catId, type, list => {
      const newBullets = [...list[subIndex].bullets];
      const [item] = newBullets.splice(fromIdx, 1);
      newBullets.splice(toIdx, 0, item);
      return list.map((b, i) => i === subIndex ? { ...b, bullets: newBullets } : b);
    });
  };

  const moveBulletGlobal = (
    fromCatId: number, fromType: 'current'|'next', fromSubIdx: number, fromBulIdx: number,
    toCatId: number, toType: 'current'|'next', toSubIdx: number
  ) => {
    setAggregatedMap(prev => {
      const nextMap = { ...prev };
      
      // 1. 소스 데이터에서 항목 제거
      const sourceData = { ...nextMap[fromCatId] };
      const sourceList = [...(sourceData[fromType] || [])];
      if (!sourceList[fromSubIdx]) return prev;
      
      const sourceSub = { ...sourceList[fromSubIdx] };
      const movedBullet = sourceSub.bullets[fromBulIdx];
      if (!movedBullet) return prev;
      
      sourceSub.bullets = sourceSub.bullets.filter((_, idx: number) => idx !== fromBulIdx);
      sourceList[fromSubIdx] = sourceSub;
      
      let removedSourceSub = false;
      if (!sourceSub.subText.trim() && sourceSub.bullets.length === 0) {
        sourceList.splice(fromSubIdx, 1);
        removedSourceSub = true;
      }
      nextMap[fromCatId] = { ...sourceData, [fromType]: sourceList };

      // 2. 타겟 데이터에 항목 추가
      const destData = { ...nextMap[toCatId] };
      const destList = [...(destData[toType] || [])];
      
      // 인덱스 보정: 같은 리스트 내에서 이전 항목이 삭제된 경우
      let finalToIdx = toSubIdx;
      if (fromCatId === toCatId && fromType === toType && removedSourceSub && fromSubIdx < toSubIdx) {
        finalToIdx = toSubIdx - 1;
      }
      
      if (!destList[finalToIdx]) return nextMap;
      
      const destSub = { ...destList[finalToIdx] };
      destSub.bullets = [...destSub.bullets, movedBullet];
      destList[finalToIdx] = destSub;
      
      nextMap[toCatId] = { ...destData, [toType]: destList };
      
      return nextMap;
    });
  };

  const renderBlocks = (catId: number, type: 'current'|'next', blocks: SubBlock[]) => {
    if (!blocks || blocks.length === 0) return <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem', paddingLeft: '2rem' }}>내용 없음</span>;
    return blocks.map((block, idx) => (
      <div
        key={block.id}
        draggable
        onDragStart={e => { e.stopPropagation(); dragSubRef.current = { catId, type, idx }; (e.currentTarget as HTMLElement).classList.add('dragging'); }}
        onDragEnd={e => { (e.currentTarget as HTMLElement).classList.remove('dragging'); setDragOverSubId(null); }}
        onDragOver={e => { e.preventDefault(); e.stopPropagation(); setDragOverSubId(block.id); }}
        onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverSubId(null); }}
        onDrop={e => {
          e.preventDefault(); e.stopPropagation();
          // Case 1: 소분류 순서 변경 (같은 카테고리/타입 내에서만)
          if (dragSubRef.current && dragSubRef.current.catId === catId && dragSubRef.current.type === type) {
            reorderSub(catId, type, dragSubRef.current.idx, idx);
          } 
          // Case 2: 항목 이동 (다른 중분류, 다른 타입(금주/차주) 간 이동 가능)
          else if (dragBulletRef.current) {
            moveBulletGlobal(
              dragBulletRef.current.catId, dragBulletRef.current.type, dragBulletRef.current.subIdx, dragBulletRef.current.bulletIdx,
              catId, type, idx
            );
          }
          dragSubRef.current = null;
          dragBulletRef.current = null;
          setDragOverSubId(null);
        }}
        className={`drag-block${dragOverSubId === block.id ? ' drag-over' : ''}`}
        style={{ marginBottom: '0.3rem', padding: '0.2rem 0.5rem', transition: 'all 0.2s' }}
      >
        {/* 소분류 행 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
          <span className="drag-handle" title="드래그하여 순서 변경">⠿</span>
          <span style={{ fontWeight: 700, minWidth: '1.4rem', color: 'var(--primary)', fontSize: '1rem', flexShrink: 0 }}>{`①②③④⑤⑥⑦⑧⑨⑩`[idx] || '①'}</span>
          <textarea
            value={block.subText}
            placeholder="소분류 내용을 입력하세요..."
            onChange={e => setSubText(catId, type, idx, e.target.value)}
            className="input-field"
            rows={1}
            onInput={e => { const t = e.target as HTMLTextAreaElement; t.style.height = 'auto'; t.style.height = `${t.scrollHeight}px`; }}
            style={{ flex: 1, borderTop: 'none', borderLeft: 'none', borderRight: 'none', fontWeight: 600, color: 'var(--foreground)', resize: 'none', minHeight: '34px', overflow: 'hidden', fontSize: '0.88rem', lineHeight: '1.4', paddingBottom: '2px' }}
          />
          {/* 작성자 태그 */}
          <span style={{ color: 'var(--primary)', fontWeight: 700, flexShrink: 0 }}>[</span>
          <input
            value={block.authorText || ''}
            onChange={e => setAuthorText(catId, type, idx, e.target.value)}
            className="input-field"
            style={{ width: '60px', padding: '0.2rem 0.1rem', background: 'transparent', borderTop: 'none', borderLeft: 'none', borderRight: 'none', borderBottomColor: 'var(--primary)', color: 'var(--primary)', fontWeight: 600, textAlign: 'center', fontSize: '0.85rem' }}
          />
          <span style={{ color: 'var(--primary)', fontWeight: 700, flexShrink: 0 }}>]</span>
          <button onClick={() => addBullet(catId, type, idx)} className="icon-btn add" title="항목 추가">+ 항목</button>
          <button onClick={() => removeSub(catId, type, idx)} className="icon-btn del" title="소분류 삭제">✕</button>
        </div>

        {/* 항목(-) 목록 */}
        {block.bullets.map((bul, bid) => (
          <div
            key={bul.id}
            draggable
            onDragStart={e => { e.stopPropagation(); dragBulletRef.current = { catId, type, subIdx: idx, bulletIdx: bid }; (e.currentTarget as HTMLElement).classList.add('dragging'); }}
            onDragEnd={e => { (e.currentTarget as HTMLElement).classList.remove('dragging'); setDragOverBulletId(null); }}
            onDragOver={e => { e.preventDefault(); e.stopPropagation(); setDragOverBulletId(bul.id); }}
            onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverBulletId(null); }}
            onDrop={e => {
              e.preventDefault(); e.stopPropagation();
              if (dragBulletRef.current) {
                const sameSub = dragBulletRef.current.catId === catId && 
                               dragBulletRef.current.type === type && 
                               dragBulletRef.current.subIdx === idx;
                
                if (sameSub) {
                  // 같은 소분류 내 순서 변경
                  reorderBullet(catId, type, idx, dragBulletRef.current.bulletIdx, bid);
                } else {
                  // 다른 소분류/중분류/타입으로 이동 (항목 위에 떨어뜨려도 해당 소분류 끝으로 합쳐짐)
                  moveBulletGlobal(
                    dragBulletRef.current.catId, dragBulletRef.current.type, dragBulletRef.current.subIdx, dragBulletRef.current.bulletIdx,
                    catId, type, idx
                  );
                }
              }
              dragBulletRef.current = null; 
              dragSubRef.current = null;
              setDragOverBulletId(null);
            }}
            className={`drag-block${dragOverBulletId === bul.id && dragBulletRef.current?.bulletIdx !== bid ? ' drag-over' : ''}`}
            style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', paddingLeft: '2.2rem', marginTop: '0.3rem' }}
          >
            <span className="drag-handle" style={{ fontSize: '0.75rem' }} title="드래그하여 순서 변경/합치기">⠿</span>
            <span style={{ fontWeight: 600, color: 'var(--text-muted)', flexShrink: 0 }}>-</span>
            <textarea
              value={bul.text}
              onChange={e => setBulletText(catId, type, idx, bid, e.target.value)}
              className="input-field"
              rows={1}
              onInput={e => { const t = e.target as HTMLTextAreaElement; t.style.height = 'auto'; t.style.height = `${t.scrollHeight}px`; }}
              style={{ flex: 1, borderTop: 'none', borderLeft: 'none', borderRight: 'none', borderBottom: '1px dashed var(--border)', fontSize: '0.88rem', color: 'var(--foreground)', resize: 'none', minHeight: '30px', overflow: 'hidden', padding: '0.25rem 0.5rem' }}
            />
            <button onClick={() => removeBullet(catId, type, idx, bid)} className="icon-btn del" title="항목 삭제">✕</button>
          </div>
        ))}
      </div>
    ));
  };

  if (!aggregatedMap) return null;

  return (
    <div className="glass-panel" style={{ padding: '2rem', marginTop: '2rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <h2 style={{ fontSize: '1.5rem', margin: 0 }}>주간보고 취합본</h2>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button onClick={() => handleCopy('all')} className="btn" style={{ fontSize: '0.8rem', padding: '0.3rem 0.8rem', background: 'var(--primary)', color: 'white' }}>전체(금주+차주) 복사</button>
            <button onClick={() => handleCopy('current')} className="btn" style={{ fontSize: '0.8rem', padding: '0.3rem 0.8rem', background: 'var(--primary)', color: 'white', opacity: 0.9 }}>금주 내용만 복사</button>
            <button onClick={() => handleCopy('next')} className="btn" style={{ fontSize: '0.8rem', padding: '0.3rem 0.8rem', background: 'var(--primary)', color: 'white', opacity: 0.9 }}>차주 내용만 복사</button>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <label>연도: <input type="number" value={year} onChange={e => setYear(parseInt(e.target.value, 10))} className="input-field" style={{ width: '80px', marginLeft: '0.5rem', padding: '0.3rem' }} /></label>
          <label>주차: <input type="number" value={weekNum} onChange={e => setWeekNum(parseInt(e.target.value, 10))} className="input-field" style={{ width: '80px', marginLeft: '0.5rem', padding: '0.3rem' }} /></label>
          <button onClick={fetchData} className="btn btn-primary" style={{ padding: '0.4rem 1rem' }}>조회</button>
        </div>
      </div>
      
      <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem', justifyContent: 'flex-end' }}>
        <button onClick={handleReset} className="btn" style={{ fontSize: '0.9rem', color: 'var(--primary)', borderColor: 'var(--primary)' }}>⟲ 개별사용자 원본 재조회</button>
        <button onClick={undo} disabled={!canUndo} className="btn" style={{ fontSize: '0.9rem' }}>↶ 실행취소</button>
        <button onClick={redo} disabled={!canRedo} className="btn" style={{ fontSize: '0.9rem' }}>↷ 다시실행</button>
        <button className="btn btn-primary" onClick={handleSave} disabled={saving} style={{ padding: '0.4rem 2rem', fontSize: '1rem' }}>
          {saving ? '저장중...' : '순서/수정내용 저장'}
        </button>
      </div>

      {loading ? <p>데이터를 불러오는 중입니다...</p> : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ minWidth: '1000px' }}>
            <thead>
              <tr>
                <th style={{ width: '10%' }}>분류</th>
                <th style={{ width: '15%' }}></th>
                <th style={{ width: '37.5%' }}>{weekNum}주차 금주 진행사항</th>
                <th style={{ width: '37.5%' }}>{nextWeekLabel} 차주 진행사항</th>
              </tr>
            </thead>
            <tbody>
              {FIXED_MAJORS.map((major: string) => {
                const majorCats = categories.filter((c: Category) => c.major === major);
                if (majorCats.length === 0) return null;

                return majorCats.map((cat: Category, idx: number) => {
                  const data = aggregatedMap[cat.id] || { current: [], next: [] };
                  const showMajorRowSpan = idx === 0;

                  return (
                    <tr key={cat.id}>
                      {showMajorRowSpan && (
                        <td rowSpan={majorCats.length} style={{ fontWeight: 'bold', textAlign: 'center', verticalAlign: 'middle' }}>
                          <div style={{ marginBottom: '0.5rem' }}>{major}</div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', alignItems: 'center' }}>
                            <button onClick={() => handleCopy('all', major)} className="btn" style={{ fontSize: '0.75rem', padding: '0.2rem 0.4rem', background: 'var(--border)', width: '90%' }}>부분(전체) 복사</button>
                            <button onClick={() => handleCopy('current', major)} className="btn" style={{ fontSize: '0.75rem', padding: '0.2rem 0.4rem', background: 'var(--border)', width: '90%' }}>금주 복사</button>
                            <button onClick={() => handleCopy('next', major)} className="btn" style={{ fontSize: '0.75rem', padding: '0.2rem 0.4rem', background: 'var(--border)', width: '90%' }}>차주 복사</button>
                          </div>
                        </td>
                      )}
                      <td style={{ fontWeight: 500 }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span>({idx + 1}) {cat.middle}</span>
                            <button onClick={() => deleteCategory(cat.id)} className="icon-btn del" title="중분류 삭제">✕</button>
                          </div>
                          <div style={{ display: 'flex', gap: '0.2rem' }}>
                            <button onClick={() => moveCategory(major, idx, -1)} className="btn" style={{ padding: '0.1rem 0.3rem', fontSize: '0.7rem' }}>위로</button>
                            <button onClick={() => moveCategory(major, idx, 1)} className="btn" style={{ padding: '0.1rem 0.3rem', fontSize: '0.7rem' }}>아래로</button>
                          </div>
                        </div>
                      </td>
                      <td style={{ verticalAlign: 'top' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                          {renderBlocks(cat.id, 'current', data.current)}
                          <button onClick={() => addSub(cat.id, 'current')} className="btn" style={{ fontSize: '0.75rem', marginTop: '0.5rem', background: 'var(--btn-bg)', color: 'var(--foreground)', opacity: 0.6 }}>+ 소분류 추가</button>
                        </div>
                      </td>
                      <td style={{ verticalAlign: 'top' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                          {renderBlocks(cat.id, 'next', data.next)}
                          <button onClick={() => addSub(cat.id, 'next')} className="btn" style={{ fontSize: '0.75rem', marginTop: '0.5rem', background: 'var(--btn-bg)', color: 'var(--foreground)', opacity: 0.6 }}>+ 소분류 추가</button>
                        </div>
                      </td>
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

function getWeekNumber(d: Date) {
  d = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay()||7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(),0,1));
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1)/7);
}
