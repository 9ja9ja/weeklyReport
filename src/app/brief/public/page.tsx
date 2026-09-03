'use client';

import { useCallback, useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { getWeekNumber, getWeekRange, getPrevWeek, getDefaultWeek, formatDateShort } from '@/lib/weekUtils';
import dynamic from 'next/dynamic';

const BriefEditor = dynamic(() => import('@/components/BriefEditor'), { ssr: false });

interface BriefData {
  title: string;
  content: string;
  isLocked: boolean;
}

/** 사내 포털에서 로그인 없이 여는 요약본 읽기 전용 페이지 (?key= 로 인증) */
function PublicBriefContent() {
  const searchParams = useSearchParams();
  const key = searchParams.get('key') || '';

  const now = new Date();
  const defaultWeek = getDefaultWeek(now);
  const [year, setYear] = useState(defaultWeek.year);
  const [weekNum, setWeekNum] = useState(defaultWeek.weekNum);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [isLocked, setIsLocked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/briefs/public?year=${year}&weekNum=${weekNum}&key=${encodeURIComponent(key)}`);
      if (res.status === 403) { setDenied(true); return; }
      const data: { brief: BriefData | null } = await res.json();
      setTitle(data.brief?.title || '');
      setContent(data.brief?.content || '');
      setIsLocked(data.brief?.isLocked ?? false);
    } catch {
      setDenied(true);
    } finally {
      setLoading(false);
    }
  }, [year, weekNum, key]);

  useEffect(() => { load(); }, [load]);

  const range = getWeekRange(year, weekNum);

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

  if (denied) {
    return (
      <div className="container brief-page">
        <div className="glass-panel" style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--text-muted)' }}>
          접근 권한이 없습니다.
        </div>
      </div>
    );
  }

  return (
    <div className="container brief-page">
      <div className="glass-panel" style={{ padding: '1.5rem' }}>
        <div className="brief-header">
          <h2>요약본</h2>
          <div className="brief-week-nav">
            <button onClick={() => changeWeek(-1)} className="btn btn-sm">◀ 이전</button>
            <span className="brief-week-label">{year}년 {weekNum}주차</span>
            <button onClick={() => changeWeek(1)} className="btn btn-sm">다음 ▶</button>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              ({formatDateShort(range.monday)}~{formatDateShort(range.friday)})
            </span>
          </div>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>로딩 중...</div>
        ) : !content ? (
          <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>등록된 요약본이 없습니다.</div>
        ) : (
          <>
            <div className="brief-title-row">
              <h3 style={{ margin: 0 }}>{title}</h3>
              <span className={`brief-public-badge ${isLocked ? 'is-final' : 'is-draft'}`}>
                {isLocked ? '확정' : '작성 중'}
              </span>
            </div>
            {!isLocked && (
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: '0.4rem 0 0.6rem' }}>
                아직 확정되지 않은 요약본으로, 내용이 변경될 수 있습니다.
              </div>
            )}
            <BriefEditor content={content} onChange={() => {}} editable={false} />
          </>
        )}
      </div>
    </div>
  );
}

export default function PublicBriefPage() {
  return (
    <>
      <meta name="referrer" content="no-referrer" />
      <Suspense fallback={<div>Loading...</div>}>
        <PublicBriefContent />
      </Suspense>
    </>
  );
}
