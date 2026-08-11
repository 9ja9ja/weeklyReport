'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useUser } from '@/lib/UserContext';
import { getWeekNumber, getWeekRange, getPrevWeek, getDefaultWeek, formatDateShort } from '@/lib/weekUtils';
import { parseExcelPnlText, emptyPnlCategory, PnlCategoryInput, formatPnlAmount, pnlDelta, PNL_METRICS } from '@/lib/pnlParser';
import PnlCategoryBox from '@/components/PnlCategoryBox';

interface PnlReportData {
  id: number;
  year: number;
  weekNum: number;
  isLocked: boolean;
  lockedBy: number | null;
  lockedAt: string | null;
  categories: (PnlCategoryInput & { id: number })[];
}

export default function PnlReportPage() {
  const { userId, isMasterOrAbove, canViewOverview, isHydrating } = useUser();
  const router = useRouter();

  const now = new Date();
  // 월·화는 지난주, 수~일은 이번주로 연다
  const defaultWeek = getDefaultWeek(now);
  const [year, setYear] = useState(defaultWeek.year);
  const [weekNum, setWeekNum] = useState(defaultWeek.weekNum);
  const [report, setReport] = useState<PnlReportData | null>(null);
  const [categories, setCategories] = useState<PnlCategoryInput[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [pasteText, setPasteText] = useState('');
  const categoriesRef = useRef(categories);
  categoriesRef.current = categories;

  useEffect(() => {
    if (!isHydrating && (!userId || !canViewOverview)) router.replace('/');
  }, [isHydrating, userId, canViewOverview, router]);

  const range = getWeekRange(year, weekNum);

  const load = useCallback(async () => {
    setLoading(true);
    setMsg('');
    try {
      const res = await fetch(`/api/pnl?year=${year}&weekNum=${weekNum}`);
      const data = await res.json();
      if (data.report) {
        setReport(data.report);
        setCategories(data.report.categories);
      } else {
        setReport(null);
        setCategories([]);
      }
    } catch { setMsg('데이터를 불러오지 못했습니다.'); }
    finally { setLoading(false); }
  }, [year, weekNum]);

  useEffect(() => { if (userId) load(); }, [userId, load]);

  const isLocked = report?.isLocked ?? false;

  const showMsg = (text: string, ms = 2000) => {
    setMsg(text);
    setTimeout(() => setMsg(''), ms);
  };

  const save = async () => {
    setSaving(true);
    setMsg('');
    try {
      const res = await fetch('/api/pnl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year, weekNum, categories: categoriesRef.current })
      });
      const data = await res.json();
      if (!res.ok) { showMsg(data.error || '저장에 실패했습니다.'); return; }
      setReport(data.report);
      setCategories(data.report.categories);
      showMsg('저장되었습니다.');
    } catch { showMsg('저장에 실패했습니다.'); }
    finally { setSaving(false); }
  };

  const toggleLock = async () => {
    const next = !isLocked;
    if (next && !confirm('이 손익보고를 잠금 처리하시겠습니까? 잠금 중에는 수정할 수 없습니다.')) return;
    try {
      const res = await fetch('/api/pnl', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year, weekNum, isLocked: next })
      });
      const data = await res.json();
      if (res.ok) {
        setReport(data.report);
        setCategories(data.report.categories);
        showMsg(next ? '잠금 처리되었습니다.' : '잠금이 해제되었습니다.');
      }
    } catch {}
  };

  const copyFromPrev = async () => {
    const prev = getPrevWeek(year, weekNum);
    if (!confirm(`${prev.year}년 ${prev.weekNum}주차 내용을 복사하시겠습니까?`)) return;
    try {
      const res = await fetch(`/api/pnl?year=${prev.year}&weekNum=${prev.weekNum}`);
      const data = await res.json();
      if (data.report?.categories?.length) {
        setCategories(data.report.categories);
        showMsg('전주차 내용을 복사했습니다. 저장 버튼을 눌러 저장해주세요.', 3000);
      } else {
        showMsg('전주차 데이터가 없습니다.');
      }
    } catch { showMsg('복사에 실패했습니다.'); }
  };

  const handlePaste = (text: string) => {
    if (!text.trim()) return;
    const parsed = parseExcelPnlText(text);
    if (!parsed.length) {
      showMsg('인식할 수 있는 카테고리를 찾지 못했습니다. 엑셀 원본 범위를 그대로 복사했는지 확인해주세요.', 3000);
      return;
    }
    setCategories(prev => [...prev, ...parsed]);
    setPasteText('');
    showMsg(`${parsed.length}개 카테고리를 인식했습니다. 저장 버튼을 눌러 저장해주세요.`, 3000);
  };

  const updateCategory = (idx: number, next: PnlCategoryInput) => {
    setCategories(prev => prev.map((c, i) => i === idx ? next : c));
  };
  const deleteCategory = (idx: number) => {
    if (!confirm('이 카테고리를 삭제하시겠습니까?')) return;
    setCategories(prev => prev.filter((_, i) => i !== idx));
  };
  const addCategory = () => setCategories(prev => [...prev, emptyPnlCategory()]);
  const clearAll = () => {
    if (!categories.length) return;
    if (!confirm('모든 카테고리를 지우시겠습니까? (저장 전까지는 되돌릴 수 있습니다)')) return;
    setCategories([]);
  };

  const exportPdf = () => {
    if (!categoriesRef.current.length) { showMsg('내보낼 카테고리가 없습니다.'); return; }
    const printWin = window.open('', '_blank');
    if (!printWin) return;

    const boxesHtml = categoriesRef.current.map(cat => {
      const rows = PNL_METRICS.map(({ key, label }) => {
        const v1 = cat[`${key}V1` as keyof PnlCategoryInput] as number;
        const v2 = cat[`${key}V2` as keyof PnlCategoryInput] as number;
        const delta = pnlDelta(v1, v2);
        return `<tr>
          <td class="pnl-metric-label">${label}</td>
          <td class="pnl-amount${v1 < 0 ? ' neg' : ''}">${formatPnlAmount(v1)}</td>
          <td class="pnl-amount${v2 < 0 ? ' neg' : ''}">${formatPnlAmount(v2)}</td>
          <td class="pnl-delta-${delta.color}">${delta.text}</td>
        </tr>`;
      }).join('');
      return `<div class="pnl-box">
        <div class="pnl-box-header">■${cat.name}</div>
        <table class="pnl-table">
          <thead><tr><th>구분</th><th>${cat.v1Label}</th><th>${cat.v2Label}</th><th>증감</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        ${cat.note ? `<p class="pnl-note">${cat.note}</p>` : ''}
      </div>`;
    }).join('');

    printWin.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8">
      <title>손익보고 - ${year}년 ${weekNum}주차</title>
      <style>
        @page { size: A4 landscape; margin: 15mm; }
        body { font-family: 'Malgun Gothic','맑은 고딕','Apple SD Gothic Neo',sans-serif;
          font-size: 10pt; color: #222; margin: 0; }
        .print-header { text-align: center; margin-bottom: 14px; padding-bottom: 8px; border-bottom: 2px solid #333; }
        .print-header h1 { font-size: 14pt; margin: 0 0 4px; }
        .print-header p { font-size: 9pt; color: #666; margin: 0; }
        .pnl-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px 20px; }
        .pnl-box { border: 1px solid #333; border-radius: 4px; padding: 10px; break-inside: avoid; }
        .pnl-box-header { font-weight: 700; margin-bottom: 6px; }
        table.pnl-table { border-collapse: collapse; width: 100%; }
        .pnl-table th, .pnl-table td { border: 1px solid #333; padding: 3px 6px; font-size: 9pt; text-align: center; }
        .pnl-table th { background: #f0f0f0; }
        .pnl-metric-label { text-align: left !important; font-weight: 600; }
        .pnl-amount { text-align: right !important; }
        .pnl-amount.neg { color: #2563eb; }
        .pnl-delta-red { color: #dc2626; }
        .pnl-delta-blue { color: #2563eb; }
        .pnl-delta-neutral { color: #666; }
        .pnl-note { font-size: 8.5pt; color: #555; margin: 6px 0 0; }
      </style></head><body>
      <div class="print-header">
        <h1>손익보고</h1>
        <p>${year}년 ${weekNum}주차 (${formatDateShort(range.monday)}~${formatDateShort(range.friday)})</p>
      </div>
      <div class="pnl-grid">${boxesHtml}</div>
    </body></html>`);
    printWin.document.close();
    setTimeout(() => { printWin.print(); }, 300);
  };

  const changeWeek = (dir: number) => {
    if (dir > 0) {
      const maxWeek = getWeekNumber(new Date(year, 11, 28));
      if (weekNum < maxWeek) setWeekNum(weekNum + 1);
      else { setYear(year + 1); setWeekNum(1); }
    } else {
      const prev = getPrevWeek(year, weekNum);
      setYear(prev.year);
      setWeekNum(prev.weekNum);
    }
  };

  if (isHydrating || !userId) return null;

  return (
    <div className="container brief-page">
      <div className="glass-panel" style={{ padding: '1.5rem' }}>
        <div className="brief-header">
          <h2>손익보고</h2>
          <div className="brief-week-nav">
            <button onClick={() => changeWeek(-1)} className="btn btn-sm">◀ 이전</button>
            <span className="brief-week-label">{year}년 {weekNum}주차</span>
            <button onClick={() => changeWeek(1)} className="btn btn-sm">다음 ▶</button>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              ({formatDateShort(range.monday)}~{formatDateShort(range.friday)})
            </span>
          </div>
          {isMasterOrAbove && (
            <div className="brief-actions">
              {!isLocked && <button onClick={copyFromPrev} className="btn btn-sm">전주차 복사</button>}
              <button onClick={exportPdf} className="btn btn-sm">PDF 내보내기</button>
              <button onClick={save} disabled={saving || isLocked} className="btn btn-primary btn-sm">
                {saving ? '저장 중...' : '저장'}
              </button>
              <button onClick={toggleLock} className={`btn btn-sm ${isLocked ? 'btn-danger' : ''}`}>
                {isLocked ? '잠금 해제' : '잠금'}
              </button>
            </div>
          )}
        </div>
        {msg && (
          <div className={`brief-msg ${msg.includes('실패') || msg.includes('없습니다') || msg.includes('못했') ? 'error' : 'success'}`}>
            {msg}
          </div>
        )}

        {loading ? (
          <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>로딩 중...</div>
        ) : (
          <>
            {isMasterOrAbove && !isLocked && (
              <div className="pnl-paste-zone">
                <textarea
                  value={pasteText}
                  onChange={e => setPasteText(e.target.value)}
                  onPaste={e => {
                    const text = e.clipboardData.getData('text/plain');
                    if (text) { e.preventDefault(); handlePaste(text); }
                  }}
                  placeholder="엑셀에서 손익표 범위를 복사(Ctrl+C)한 뒤 여기에 붙여넣으세요 (Ctrl+V) — 카테고리를 자동으로 인식합니다."
                  className="pnl-paste-textarea"
                  rows={2}
                />
                <div className="pnl-paste-actions">
                  <button onClick={addCategory} className="btn btn-sm">+ 카테고리 직접 추가</button>
                  <button onClick={clearAll} className="btn btn-sm">전체 지우기</button>
                </div>
              </div>
            )}

            {!categories.length ? (
              <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
                {isMasterOrAbove ? '엑셀 내용을 붙여넣거나 카테고리를 추가해주세요.' : '등록된 손익보고가 없습니다.'}
              </div>
            ) : (
              <div className="pnl-grid">
                {categories.map((cat, i) => (
                  <PnlCategoryBox
                    key={i}
                    category={cat}
                    editable={isMasterOrAbove && !isLocked}
                    onChange={next => updateCategory(i, next)}
                    onDelete={() => deleteCategory(i)}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
