'use client';

import { getIsoWeek } from '@/lib/weekUtils';

/** 이번주가 음영으로 표시되는 2개월 달력 (홈·대시보드 공용) */
export default function WeekCalendar({ months = 2, vertical = false }: { months?: number; vertical?: boolean }) {
  const now = new Date();
  const currentMonth = now.getMonth();
  // 이번주 음영 판정 — 연말·연초에는 주차의 해가 달력 연도와 다르다
  const { year: currentYear, weekNum: currentWeek } = getIsoWeek(now);
  const today = now.getDate();

  const renderMonth = (year: number, month: number) => {
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const weeks: (number | null)[][] = [];
    let week: (number | null)[] = Array(firstDay).fill(null);
    for (let d = 1; d <= daysInMonth; d++) {
      week.push(d);
      if (week.length === 7) { weeks.push(week); week = []; }
    }
    if (week.length > 0) { while (week.length < 7) week.push(null); weeks.push(week); }

    const isCurrentWeekDay = (day: number | null) => {
      if (!day) return false;
      const d = new Date(year, month, day);
      const iso = getIsoWeek(d);
      return iso.weekNum === currentWeek && iso.year === currentYear;
    };
    const isToday = (day: number | null) =>
      day !== null && year === now.getFullYear() && month === now.getMonth() && day === today;

    return (
      <div key={`${year}-${month}`} style={{ flex: 1, minWidth: vertical ? 0 : '260px' }}>
        <div style={{ textAlign: 'center', fontWeight: 700, marginBottom: '0.5rem', fontSize: '1.05rem' }}>
          {year}년 {month + 1}월
        </div>
        <table style={{ width: '100%', fontSize: '0.85rem', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {['일', '월', '화', '수', '목', '금', '토'].map(d => (
                <th key={d} style={{
                  padding: '0.4rem', textAlign: 'center', fontWeight: 600,
                  borderBottom: '1px solid var(--border)',
                  color: d === '일' ? '#ef4444' : d === '토' ? '#3b82f6' : 'var(--foreground)'
                }}>{d}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {weeks.map((w, wi) => (
              <tr key={wi}>
                {w.map((day, di) => (
                  <td key={di} style={{
                    padding: '0.4rem', textAlign: 'center',
                    background: isCurrentWeekDay(day) ? 'var(--primary-alpha-focus)' : 'transparent',
                    fontWeight: isToday(day) ? 800 : 400,
                    color: isToday(day) ? 'var(--primary)' : di === 0 ? '#ef4444' : di === 6 ? '#3b82f6' : 'var(--foreground)'
                  }}>{day || ''}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  const list = Array.from({ length: months }, (_, i) => {
    const m = currentMonth + i;
    return { year: currentYear + Math.floor(m / 12), month: m % 12 };
  });

  return (
    <>
      <div className="dashboard-calendar-wrap" style={{
        display: 'flex',
        flexDirection: vertical ? 'column' : 'row',
        gap: vertical ? '1.4rem' : '2rem',
        flexWrap: vertical ? 'nowrap' : 'wrap'
      }}>
        {list.map(({ year, month }) => renderMonth(year, month))}
      </div>
      <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textAlign: 'center', marginTop: '0.8rem', marginBottom: 0 }}>
        * 음영 = 이번주
      </p>
    </>
  );
}
