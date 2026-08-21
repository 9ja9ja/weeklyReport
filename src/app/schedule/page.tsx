'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useUser } from '@/lib/UserContext';
import { getWeekNumber, getWeekRange, getPrevWeek, getDefaultWeek, formatDateShort } from '@/lib/weekUtils';
import dynamic from 'next/dynamic';

const BriefEditor = dynamic(() => import('@/components/BriefEditor'), { ssr: false });

interface ScheduleData {
  id: number;
  year: number;
  weekNum: number;
  title: string;
  content: string;
  isLocked: boolean;
  lockedBy: number | null;
  lockedAt: string | null;
}

export default function SchedulePage() {
  const { userId, isMasterOrAbove, canViewOverview, isHydrating } = useUser();
  const router = useRouter();

  const now = new Date();
  // 월·화는 지난주, 수~일은 이번주로 연다
  const defaultWeek = getDefaultWeek(now);
  const [year, setYear] = useState(defaultWeek.year);
  const [weekNum, setWeekNum] = useState(defaultWeek.weekNum);
  const [schedule, setSchedule] = useState<ScheduleData | null>(null);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const contentRef = useRef(content);
  contentRef.current = content;

  useEffect(() => {
    if (!isHydrating && (!userId || !canViewOverview)) router.replace('/');
  }, [isHydrating, userId, canViewOverview, router]);

  const range = getWeekRange(year, weekNum);

  const load = useCallback(async () => {
    setLoading(true);
    setMsg('');
    try {
      const res = await fetch(`/api/schedules?year=${year}&weekNum=${weekNum}`);
      const data = await res.json();
      if (data.schedule) {
        setSchedule(data.schedule);
        setTitle(data.schedule.title);
        setContent(data.schedule.content);
      } else {
        setSchedule(null);
        setTitle('');
        setContent('');
      }
    } catch { setMsg('데이터를 불러오지 못했습니다.'); }
    finally { setLoading(false); }
  }, [year, weekNum]);

  useEffect(() => { if (userId) load(); }, [userId, load]);

  const save = async () => {
    setSaving(true);
    setMsg('');
    try {
      const res = await fetch('/api/schedules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year, weekNum, title, content: contentRef.current })
      });
      const data = await res.json();
      if (!res.ok) { setMsg(data.error || '저장에 실패했습니다.'); return; }
      setSchedule(data.schedule);
      setMsg('저장되었습니다.');
      setTimeout(() => setMsg(''), 2000);
    } catch { setMsg('저장에 실패했습니다.'); }
    finally { setSaving(false); }
  };

  const toggleLock = async () => {
    const next = !schedule?.isLocked;
    if (next && !confirm('이 일정보고를 잠금 처리하시겠습니까? 잠금 중에는 수정할 수 없습니다.')) return;
    try {
      const res = await fetch('/api/schedules', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year, weekNum, isLocked: next })
      });
      const data = await res.json();
      if (res.ok) {
        setSchedule(data.schedule);
        setMsg(next ? '잠금 처리되었습니다.' : '잠금이 해제되었습니다.');
        setTimeout(() => setMsg(''), 2000);
      }
    } catch {}
  };

  const copyFromPrev = async () => {
    const prev = getPrevWeek(year, weekNum);
    if (!confirm(`${prev.year}년 ${prev.weekNum}주차 내용을 복사하시겠습니까?`)) return;
    try {
      const res = await fetch(`/api/schedules?year=${prev.year}&weekNum=${prev.weekNum}`);
      const data = await res.json();
      if (data.schedule && data.schedule.content) {
        setTitle(data.schedule.title);
        setContent(data.schedule.content);
        setMsg('전주차 내용을 복사했습니다. 저장 버튼을 눌러 저장해주세요.');
        setTimeout(() => setMsg(''), 3000);
      } else {
        setMsg('전주차 데이터가 없습니다.');
        setTimeout(() => setMsg(''), 2000);
      }
    } catch { setMsg('복사에 실패했습니다.'); }
  };

  const exportPdf = () => {
    const editorEl = document.querySelector('.brief-editor-content .tiptap') as HTMLElement;
    if (!editorEl) return;
    const printWin = window.open('', '_blank');
    if (!printWin) return;
    printWin.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8">
      <title>${title || '일정보고'} - ${year}년 ${weekNum}주차</title>
      <style>
        @page { size: A4; margin: 20mm 15mm; }
        body { font-family: 'Malgun Gothic','맑은 고딕','Apple SD Gothic Neo',sans-serif;
          font-size: 10.5pt; line-height: 1.65; color: #222; margin: 0; padding: 0; }
        h1 { font-size: 16pt; font-weight: 800; margin: 16px 0 6px; }
        h2 { font-size: 13pt; font-weight: 700; margin: 12px 0 5px; }
        h3 { font-size: 11pt; font-weight: 700; margin: 10px 0 4px; }
        p { margin: 2px 0; }
        ul, ol { padding-left: 24px; margin: 2px 0; }
        table { border-collapse: collapse; width: 100%; margin: 6px 0; }
        td, th { border: 1px solid #333; padding: 3px 6px; font-size: 9.5pt;
          vertical-align: top; line-height: 1.5; }
        th { background: #f0f0f0; font-weight: 700; }
        .print-header { text-align: center; margin-bottom: 16px; padding-bottom: 10px;
          border-bottom: 2px solid #333; }
        .print-header h1 { font-size: 14pt; margin: 0 0 4px; }
        .print-header p { font-size: 9pt; color: #666; margin: 0; }
      </style></head><body>
      <div class="print-header">
        <h1>${title || '일정보고'}</h1>
        <p>${year}년 ${weekNum}주차 (${formatDateShort(range.monday)}~${formatDateShort(range.friday)})</p>
      </div>
      ${editorEl.innerHTML}
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

  const isLocked = schedule?.isLocked ?? false;
  const editable = isMasterOrAbove && !isLocked;

  if (isHydrating || !userId) return null;

  return (
    <div className="container brief-page">
      <div className="glass-panel" style={{ padding: '1.5rem' }}>
        <div className="brief-header">
          <h2>일정보고</h2>
          <div className="brief-week-nav">
            <button onClick={() => changeWeek(-1)} className="btn btn-sm">◀ 이전</button>
            <span className="brief-week-label">{year}년 {weekNum}주차</span>
            <button onClick={() => changeWeek(1)} className="btn btn-sm">다음 ▶</button>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              ({formatDateShort(range.monday)}~{formatDateShort(range.friday)})
            </span>
          </div>
          <div className="brief-actions">
            {isMasterOrAbove && !schedule?.content && !content && (
              <button onClick={copyFromPrev} className="btn btn-sm">전주차 복사</button>
            )}
            {isMasterOrAbove && schedule?.content && !isLocked && (
              <button onClick={copyFromPrev} className="btn btn-sm">전주차 복사</button>
            )}
            <button onClick={exportPdf} className="btn btn-sm">PDF 내보내기</button>
            {isMasterOrAbove && (
              <>
                <button onClick={save} disabled={saving || isLocked} className="btn btn-primary btn-sm">
                  {saving ? '저장 중...' : '저장'}
                </button>
                <button onClick={toggleLock} className={`btn btn-sm ${isLocked ? 'btn-danger' : ''}`}>
                  {isLocked ? '잠금 해제' : '잠금'}
                </button>
              </>
            )}
          </div>
        </div>
        {msg && (
          <div className={`brief-msg ${msg.includes('실패') || msg.includes('없습니다') || msg.includes('못했') ? 'error' : 'success'}`}>
            {msg}
          </div>
        )}

        {loading ? (
          <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>로딩 중...</div>
        ) : !schedule?.content && !content && !isMasterOrAbove ? (
          <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>등록된 일정보고가 없습니다.</div>
        ) : (
          <>
            <div className="brief-title-row">
              {editable ? (
                <input
                  type="text"
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  placeholder="문서 제목 (예: 비즈니스플랫폼본부 일정 보고)"
                  className="brief-title-input"
                />
              ) : (
                <h3 style={{ margin: 0 }}>{title}</h3>
              )}
              {isLocked && <span className="brief-lock-badge">잠금됨</span>}
            </div>
            <BriefEditor
              content={content}
              onChange={html => { contentRef.current = html; setContent(html); }}
              editable={editable}
            />
          </>
        )}
      </div>
    </div>
  );
}
