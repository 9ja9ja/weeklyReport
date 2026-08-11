'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useUser } from '@/lib/UserContext';
import { getIsoWeek, getWeekRange, formatDateShort } from '@/lib/weekUtils';
import WeekCalendar from '@/components/WeekCalendar';
import { type ContentBlock, isTableBlock } from '@/lib/reportBlocks';
import { TableBlockView } from '@/components/TableBlock';

interface WeekStatus { year: number; weekNum: number; hasReport: boolean; updatedAt: string | null; isLocked?: boolean; }
interface Category { id: number; major: string; middle: string; }

type CateData = { current: ContentBlock[]; next: ContentBlock[] };

interface TeamMemberStatus { id: number; name: string; role: string; position?: string; isPrimary?: boolean; hasReport: boolean; lastUpdated: string | null; }

export default function DashboardPage() {
  const { userId, userName, teamId, teamName, isHydrating, isMasterOrAbove } = useUser();
  const router = useRouter();
  const [weekStatuses, setWeekStatuses] = useState<WeekStatus[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [majors, setMajors] = useState<string[]>([]);
  const [teamStatus, setTeamStatus] = useState<TeamMemberStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalData, setModalData] = useState<{ year: number; weekNum: number; data: Record<number, CateData> } | null>(null);
  const [modalLoading, setModalLoading] = useState(false);

  const now = new Date();
  // 주차가 속한 해 — 연말·연초에 달력 연도를 붙이면 없는 주차를 조회한다
  const { year: currentYear, weekNum: currentWeek } = getIsoWeek(now);

  useEffect(() => {
    if (isHydrating) return; // 세션 복원 전에는 판단하지 않는다
    if (!userId || !teamId) { router.push('/'); return; }
    fetchAll();
  }, [userId, teamId, isHydrating]);

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

      // 관리자는 이번주 팀원 작성현황도 함께
      if (isMasterOrAbove) {
        const tsRes = await fetch(`/api/users?teamId=${teamId}&withStatus=true&year=${currentYear}&weekNum=${currentWeek}`);
        const ts = await tsRes.json();
        setTeamStatus(Array.isArray(ts) ? ts : []);
      }
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

  /** 표 블록은 TableBlockView 로, 그 외는 ①②③ + 불릿으로 (write/summary 와 동일 규칙, 번호는 표를 건너뛴다) */
  const renderBlocks = (blocks: ContentBlock[]) => {
    if (!blocks?.length) return <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>없음</span>;
    let seq = -1;
    return blocks.map(b => {
      if (isTableBlock(b)) return <TableBlockView key={b.id} block={b} />;
      seq += 1;
      const mark = seq < 10 ? `①②③④⑤⑥⑦⑧⑨⑩`[seq] : `(${seq + 1})`;
      return (
        <div key={b.id} style={{ marginBottom: '0.3rem' }}>
          <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>{mark} {b.subText}</div>
          {(b.bullets ?? []).map(x => (
            <div key={x.id} style={{ paddingLeft: '1.5rem', fontSize: '0.82rem', color: 'var(--text-muted)' }}>- {x.text}</div>
          ))}
        </div>
      );
    });
  };

  const formatDT = (s: string | null) => { if (!s) return '-'; const d = new Date(s); return `${d.getMonth()+1}/${d.getDate()} ${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`; };

  if (!userId) return null;
  if (loading) return <div className="glass-panel" style={{ padding: '3rem', maxWidth: '900px', margin: '2rem auto', textAlign: 'center' }}>로딩중...</div>;

  const doneCount = teamStatus.filter(m => m.hasReport).length;

  return (
    <div className="dashboard-layout" style={{ maxWidth: isMasterOrAbove ? '1240px' : '900px', margin: '2rem auto', display: 'flex', gap: '1.5rem', alignItems: 'flex-start' }}>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      <div className="glass-panel" style={{ padding: '2rem', textAlign: 'center' }}>
        <h2 style={{ marginBottom: '0.3rem' }}>{userName}님, 안녕하세요</h2>
        <p style={{ color: 'var(--text-muted)', margin: 0 }}>{teamName} | {currentYear}년 {currentWeek}주차</p>
      </div>

      <div className="glass-panel" style={{ padding: '2rem' }}>
        <WeekCalendar />
      </div>

      <div className="glass-panel" style={{ padding: '2rem' }}>
        <h3 style={{ fontSize: '1.1rem', marginBottom: '1rem', borderBottom: '2px solid var(--border)', paddingBottom: '0.5rem' }}>주간보고 현황</h3>
        <div className="dashboard-status-header" style={{ display: 'flex', padding: '0.5rem 1rem', fontWeight: 700, fontSize: '0.85rem', color: 'var(--text-muted)', borderBottom: '1px solid var(--border)' }}>
          <div style={{ width: '84px' }}>주차</div><div className="status-period" style={{ flex: 1 }}>기간</div><div style={{ width: '80px', textAlign: 'center' }}>상태</div><div style={{ width: '120px', textAlign: 'center' }}>최종작성일시</div><div style={{ width: '120px', textAlign: 'center' }}></div>
        </div>
        {weekStatuses.map(ws => {
          const { monday, friday } = getWeekRange(ws.year, ws.weekNum);
          const isCurrent = ws.year === currentYear && ws.weekNum === currentWeek;
          return (
            <div key={`${ws.year}-${ws.weekNum}`} className="dashboard-status-row"
              style={{ display: 'flex', alignItems: 'center', padding: '0.7rem 1rem', borderBottom: '1px solid var(--border)', background: isCurrent ? 'var(--primary-alpha-subtle)' : 'transparent' }}>
              {/* 이번주 표시(★)가 아래로 밀려 두 줄이 되지 않게 줄바꿈을 막고 칸을 넓혔다 */}
              <div style={{ width: '84px', whiteSpace: 'nowrap', fontWeight: isCurrent ? 700 : 500, color: isCurrent ? 'var(--primary)' : 'var(--foreground)' }}>{ws.weekNum}주차{isCurrent && ' ★'}</div>
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
      </div>

      {/* 관리자: 팀원 이번주 작성현황 (우측) */}
      {isMasterOrAbove && (
        <aside className="dashboard-team-status glass-panel" style={{ width: '300px', flexShrink: 0, padding: '1.5rem', position: 'sticky', top: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '0.2rem' }}>
            <h3 style={{ fontSize: '1.05rem', margin: 0 }}>팀원 작성현황</h3>
            <span style={{ fontSize: '0.8rem', color: 'var(--primary)', fontWeight: 700 }}>{doneCount}/{teamStatus.length}</span>
          </div>
          <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: '0 0 0.8rem' }}>{teamName} · {currentWeek}주차</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            {teamStatus.map(m => (
              <div key={m.id} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '0.45rem 0.6rem', borderRadius: '6px',
                background: m.hasReport ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.06)'
              }}>
                <span style={{ fontSize: '0.85rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.3rem', minWidth: 0 }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name}</span>
                  {m.isPrimary === false && <span style={{ fontSize: '0.58rem', color: 'var(--text-muted)', border: '1px solid var(--border)', borderRadius: '3px', padding: '0 0.2rem', flexShrink: 0 }}>겸직</span>}
                </span>
                <span style={{ fontSize: '0.78rem', fontWeight: 700, whiteSpace: 'nowrap', color: m.hasReport ? '#16a34a' : '#dc2626' }}>
                  {m.hasReport ? '완료' : '미작성'}
                  {m.hasReport && m.lastUpdated && (
                    <span style={{ fontWeight: 400, color: 'var(--text-muted)', marginLeft: '0.3rem', fontSize: '0.7rem' }}>{formatDT(m.lastUpdated)}</span>
                  )}
                </span>
              </div>
            ))}
            {teamStatus.length === 0 && <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>팀원이 없습니다.</p>}
          </div>
        </aside>
      )}

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
                              {renderBlocks(d.current)}
                            </div>
                            <div>
                              <div style={{ fontWeight: 600, fontSize: '0.8rem', color: 'var(--text-muted)', borderBottom: '1px solid var(--border)', paddingBottom: '0.2rem', marginBottom: '0.3rem' }}>차주</div>
                              {renderBlocks(d.next)}
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
