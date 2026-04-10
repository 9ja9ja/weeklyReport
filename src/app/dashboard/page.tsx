'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useUser } from '@/lib/UserContext';
import { getWeekNumber, getWeekRange, formatDateShort } from '@/lib/weekUtils';

interface WeekStatus { year: number; weekNum: number; hasReport: boolean; updatedAt: string | null; isLocked?: boolean; }
interface Category { id: number; major: string; middle: string; }

type Bullet = { id: string; text: string };
type SubBlock = { id: string; subText: string; bullets: Bullet[] };
type CateData = { current: SubBlock[]; next: SubBlock[] };

export default function DashboardPage() {
  const { userId, userName, teamId, teamName } = useUser();
  const router = useRouter();
  const [weekStatuses, setWeekStatuses] = useState<WeekStatus[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [majors, setMajors] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalData, setModalData] = useState<{ year: number; weekNum: number; data: Record<number, CateData> } | null>(null);
  const [modalLoading, setModalLoading] = useState(false);

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();
  const currentWeek = getWeekNumber(now);
  const today = now.getDate();

  useEffect(() => {
    if (!userId || !teamId) { router.push('/'); return; }
    fetchAll();
  }, [userId, teamId]);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') setModalData(null); };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, []);

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [statusRes, catRes, majRes] = await Promise.all([
        fetch(`/api/reports/status?userId=${userId}&year=${currentYear}&weekNum=${currentWeek}&count=5`),
        fetch(`/api/categories?teamId=${teamId}`),
        fetch(`/api/majors?teamId=${teamId}`)
      ]);
      const sd = await statusRes.json();
      setWeekStatuses(Array.isArray(sd) ? sd : []);

      const cd = await catRes.json(); setCategories(Array.isArray(cd) ? cd : []);
      const md = await majRes.json(); setMajors(Array.isArray(md) ? md.map((m: any) => m.name) : []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  const openWeekModal = async (year: number, weekNum: number) => {
    setModalLoading(true);
    try {
      const res = await fetch(`/api/reports?userId=${userId}&year=${year}&weekNum=${weekNum}`);
      const report = await res.json();
      const dataMap: Record<number, CateData> = {};
      if (report?.items) {
        report.items.forEach((item: any) => {
          const safeParse = (v: any) => { try { return typeof v === 'string' ? JSON.parse(v) : (v ?? []); } catch { return []; } };
          dataMap[item.categoryId] = { current: safeParse(item.currentContents), next: safeParse(item.nextContents) };
        });
      }
      setModalData({ year, weekNum, data: dataMap });
    } catch { alert('조회 실패'); }
    finally { setModalLoading(false); }
  };

  const renderCalendar = (year: number, month: number) => {
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const weeks: (number | null)[][] = [];
    let week: (number | null)[] = Array(firstDay).fill(null);
    for (let d = 1; d <= daysInMonth; d++) { week.push(d); if (week.length === 7) { weeks.push(week); week = []; } }
    if (week.length > 0) { while (week.length < 7) week.push(null); weeks.push(week); }

    const isCurrentWeekDay = (day: number | null) => { if (!day) return false; const d = new Date(year, month, day); return getWeekNumber(d) === currentWeek && d.getFullYear() === currentYear; };
    const isToday = (day: number | null) => day !== null && year === now.getFullYear() && month === now.getMonth() && day === today;

    return (
      <div style={{ flex: 1, minWidth: '280px' }}>
        <div style={{ textAlign: 'center', fontWeight: 700, marginBottom: '0.5rem', fontSize: '1.05rem' }}>{year}년 {month + 1}월</div>
        <table style={{ width: '100%', fontSize: '0.85rem', borderCollapse: 'collapse' }}>
          <thead><tr>{['일','월','화','수','목','금','토'].map(d => <th key={d} style={{ padding: '0.4rem', textAlign: 'center', color: d === '일' ? '#ef4444' : d === '토' ? '#3b82f6' : 'var(--foreground)', fontWeight: 600, borderBottom: '1px solid var(--border)' }}>{d}</th>)}</tr></thead>
          <tbody>{weeks.map((w, wi) => (<tr key={wi}>{w.map((day, di) => (<td key={di} style={{ padding: '0.4rem', textAlign: 'center', background: isCurrentWeekDay(day) ? 'var(--primary-alpha-focus)' : 'transparent', fontWeight: isToday(day) ? 800 : 400, color: isToday(day) ? 'var(--primary)' : di === 0 ? '#ef4444' : di === 6 ? '#3b82f6' : 'var(--foreground)' }}>{day || ''}</td>))}</tr>))}</tbody>
        </table>
      </div>
    );
  };

  const formatDT = (s: string | null) => { if (!s) return '-'; const d = new Date(s); return `${d.getMonth()+1}/${d.getDate()} ${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`; };

  if (!userId) return null;
  if (loading) return <div className="glass-panel" style={{ padding: '3rem', maxWidth: '900px', margin: '2rem auto', textAlign: 'center' }}>로딩중...</div>;

  const nextMonth = currentMonth === 11 ? 0 : currentMonth + 1;
  const nextMonthYear = currentMonth === 11 ? currentYear + 1 : currentYear;

  return (
    <div style={{ maxWidth: '900px', margin: '2rem auto', display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      <div className="glass-panel" style={{ padding: '2rem', textAlign: 'center' }}>
        <h2 style={{ marginBottom: '0.3rem' }}>{userName}님, 안녕하세요</h2>
        <p style={{ color: 'var(--text-muted)', margin: 0 }}>{teamName} | {currentYear}년 {currentWeek}주차</p>
      </div>

      <div className="glass-panel" style={{ padding: '2rem' }}>
        <div className="dashboard-calendar-wrap" style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>
          {renderCalendar(currentYear, currentMonth)}
          {renderCalendar(nextMonthYear, nextMonth)}
        </div>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textAlign: 'center', marginTop: '0.8rem', marginBottom: 0 }}>* 음영 = 이번주</p>
      </div>

      <div className="glass-panel" style={{ padding: '2rem' }}>
        <h3 style={{ fontSize: '1.1rem', marginBottom: '1rem', borderBottom: '2px solid var(--border)', paddingBottom: '0.5rem' }}>주간보고 현황</h3>
        <div className="dashboard-status-header" style={{ display: 'flex', padding: '0.5rem 1rem', fontWeight: 700, fontSize: '0.85rem', color: 'var(--text-muted)', borderBottom: '1px solid var(--border)' }}>
          <div style={{ width: '60px' }}>주차</div><div className="status-period" style={{ flex: 1 }}>기간</div><div style={{ width: '80px', textAlign: 'center' }}>상태</div><div style={{ width: '120px', textAlign: 'center' }}>최종작성일시</div><div style={{ width: '120px', textAlign: 'center' }}></div>
        </div>
        {weekStatuses.map(ws => {
          const { monday, friday } = getWeekRange(ws.year, ws.weekNum);
          const isCurrent = ws.year === currentYear && ws.weekNum === currentWeek;
          return (
            <div key={`${ws.year}-${ws.weekNum}`} className="dashboard-status-row"
              style={{ display: 'flex', alignItems: 'center', padding: '0.7rem 1rem', borderBottom: '1px solid var(--border)', background: isCurrent ? 'var(--primary-alpha-subtle)' : 'transparent' }}>
              <div style={{ width: '60px', fontWeight: isCurrent ? 700 : 500, color: isCurrent ? 'var(--primary)' : 'var(--foreground)' }}>{ws.weekNum}주차{isCurrent && ' ★'}</div>
              <div className="status-period" style={{ flex: 1, fontSize: '0.9rem', color: 'var(--text-muted)' }}>{formatDateShort(monday)} ~ {formatDateShort(friday)}</div>
              <div style={{ width: '80px', textAlign: 'center' }}>
                {ws.isLocked
                  ? <span style={{ color: 'var(--primary)', fontWeight: 700 }}>취합완료</span>
                  : ws.hasReport
                    ? <span style={{ color: '#22c55e', fontWeight: 700 }}>작성완료</span>
                    : <span style={{ color: '#ef4444', fontWeight: 600 }}>미작성</span>}
              </div>
              <div style={{ width: '120px', textAlign: 'center', fontSize: '0.85rem', color: 'var(--text-muted)' }}>{formatDT(ws.updatedAt)}</div>
              <div className="status-actions" style={{ width: '120px', textAlign: 'center', display: 'flex', gap: '0.3rem', justifyContent: 'center' }}>
                {ws.hasReport && (
                  <button onClick={() => openWeekModal(ws.year, ws.weekNum)} className="btn" style={{ fontSize: '0.75rem', padding: '0.2rem 0.6rem' }}>보기</button>
                )}
                {!ws.isLocked && (
                  <button onClick={() => router.push(`/write?userId=${userId}&name=${encodeURIComponent(userName)}&year=${ws.year}&weekNum=${ws.weekNum}`)} className="btn btn-primary" style={{ fontSize: '0.75rem', padding: '0.2rem 0.6rem' }}>
                    {ws.hasReport ? '수정' : '작성'}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* 모달 */}
      {(modalData || modalLoading) && (
        <div className="modal-overlay" onClick={() => setModalData(null)}>
          <div className="modal-content" style={{ maxWidth: '1000px' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3 style={{ margin: 0 }}>{modalData ? `${modalData.year}년 ${modalData.weekNum}주차` : '로딩중...'}</h3>
              <button className="icon-btn" onClick={() => setModalData(null)}>✕</button>
            </div>
            <div className="modal-body" style={{ maxHeight: '70vh', overflowY: 'auto' }}>
              {modalLoading ? <p style={{ textAlign: 'center' }}>로딩중...</p> : modalData && majors.map(major => {
                const mCats = categories.filter(c => c.major === major);
                const hasData = mCats.some(c => modalData.data[c.id]?.current?.length || modalData.data[c.id]?.next?.length);
                if (!hasData) return null;
                return (
                  <div key={major} style={{ marginBottom: '1.5rem' }}>
                    <div style={{ background: 'var(--primary)', color: 'white', padding: '0.4rem 1rem', borderRadius: '6px 6px 0 0', fontWeight: 700 }}>{major}</div>
                    {mCats.map(cat => {
                      const d = modalData.data[cat.id];
                      if (!d || (!d.current?.length && !d.next?.length)) return null;
                      return (
                        <div key={cat.id} style={{ border: '1px solid var(--border)', borderTop: 'none', padding: '0.8rem 1rem' }}>
                          <div style={{ fontWeight: 700, color: 'var(--primary)', marginBottom: '0.5rem' }}>{cat.middle}</div>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                            <div>
                              <div style={{ fontWeight: 600, fontSize: '0.8rem', color: 'var(--text-muted)', borderBottom: '1px solid var(--border)', paddingBottom: '0.2rem', marginBottom: '0.3rem' }}>금주</div>
                              {(d.current || []).map((s, i) => (<div key={s.id} style={{ marginBottom: '0.3rem' }}><div style={{ fontWeight: 600, fontSize: '0.85rem' }}>{i < 10 ? `①②③④⑤⑥⑦⑧⑨⑩`[i] : `(${i+1})`} {s.subText}</div>{s.bullets.map(b => <div key={b.id} style={{ paddingLeft: '1.5rem', fontSize: '0.82rem', color: 'var(--text-muted)' }}>- {b.text}</div>)}</div>))}
                              {!d.current?.length && <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>없음</span>}
                            </div>
                            <div>
                              <div style={{ fontWeight: 600, fontSize: '0.8rem', color: 'var(--text-muted)', borderBottom: '1px solid var(--border)', paddingBottom: '0.2rem', marginBottom: '0.3rem' }}>차주</div>
                              {(d.next || []).map((s, i) => (<div key={s.id} style={{ marginBottom: '0.3rem' }}><div style={{ fontWeight: 600, fontSize: '0.85rem' }}>{i < 10 ? `①②③④⑤⑥⑦⑧⑨⑩`[i] : `(${i+1})`} {s.subText}</div>{s.bullets.map(b => <div key={b.id} style={{ paddingLeft: '1.5rem', fontSize: '0.82rem', color: 'var(--text-muted)' }}>- {b.text}</div>)}</div>))}
                              {!d.next?.length && <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>없음</span>}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
            <div className="modal-footer"><button className="btn" onClick={() => setModalData(null)}>닫기</button></div>
          </div>
        </div>
      )}
    </div>
  );
}
