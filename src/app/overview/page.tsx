'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useUser } from '@/lib/UserContext';
import { getWeekNumber, getWeekRange, formatDateShort } from '@/lib/weekUtils';
import { type ContentBlock, isTableBlock, tableToHtml, tableToText } from '@/lib/reportBlocks';
import { TableBlockView } from '@/components/TableBlock';

interface OvCategory { id: number; middle: string; current: ContentBlock[]; next: ContentBlock[] }
interface OvMajor { id: number; name: string; categories: OvCategory[] }
interface OvPart { id: number; name: string; majors: OvMajor[] }
interface OvTeam {
  id: number;
  name: string;
  division: string;
  isLocked: boolean;
  lockedAt: string | null;
  hasSummary: boolean;
  hasContent: boolean;
  parts: OvPart[];
}

const circled = (i: number) => (i < 10 ? `⑴⑵⑶⑷⑸⑹⑺⑻⑼⑽`[i] : `(${i + 1})`);
const marked = (i: number) => (i < 10 ? `①②③④⑤⑥⑦⑧⑨⑩`[i] : `(${i + 1})`);

export default function OverviewPage() {
  const { userId, canViewOverview, isHydrating } = useUser();
  const router = useRouter();

  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [weekNum, setWeekNum] = useState(getWeekNumber(now));
  const [teams, setTeams] = useState<OvTeam[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [onlyFilled, setOnlyFilled] = useState(true);
  const [includeAuthor, setIncludeAuthor] = useState(true);
  /** null 이면 전체 보기, 값이 있으면 그 팀만 */
  const [selectedTeamId, setSelectedTeamId] = useState<number | null>(null);
  const [driveReady, setDriveReady] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [pdfExporting, setPdfExporting] = useState(false);

  const fetchData = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/overview?year=${year}&weekNum=${weekNum}`);
      const data = await res.json();
      if (!res.ok) { setError(data.error || '조회 실패'); setTeams([]); return; }
      setTeams(data.teams ?? []);
    } catch {
      setError('서버 오류');
    } finally {
      setLoading(false);
    }
  }, [userId, year, weekNum]);

  useEffect(() => {
    if (isHydrating) return;
    if (!userId || !canViewOverview) { router.push('/'); return; }
    fetchData();
  }, [isHydrating, userId, canViewOverview, router, fetchData]);

  useEffect(() => {
    fetch('/api/overview/export')
      .then(r => r.json())
      .then(d => setDriveReady(!!d.configured))
      .catch(() => setDriveReady(false));
  }, []);

  const handleDriveExport = async () => {
    const target = selectedTeamId ? teams.find(t => t.id === selectedTeamId)?.name : '전체';
    const folder = `${year}.${String(getWeekRange(year, weekNum).monday.getMonth() + 1).padStart(2, '0')}`;
    if (!confirm(`${year}년 ${weekNum}주차 ${target} 취합본을 구글 드라이브에 내보냅니다.\n\n저장 위치: 주간보고 / ${folder}`)) return;
    setExporting(true);
    try {
      const res = await fetch('/api/overview/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year, weekNum, teamId: selectedTeamId, onlyFilled, includeAuthor })
      });
      const d = await res.json();
      if (!res.ok) { alert(d.error || '내보내기 실패'); return; }
      if (confirm(`내보내기 완료\n\n위치: 주간보고 / ${d.folderPath}\n파일: ${d.fileName}\n\n지금 열어볼까요?`)) {
        window.open(d.webViewLink, '_blank', 'noopener');
      }
    } catch {
      alert('서버 오류');
    } finally {
      setExporting(false);
    }
  };

  const handlePdfExport = async () => {
    setPdfExporting(true);
    try {
      const res = await fetch('/api/overview/pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year, weekNum, teamId: selectedTeamId, onlyFilled, includeAuthor })
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        alert(d.error || 'PDF 생성 실패');
        return;
      }
      const blob = await res.blob();
      const suffix = selectedTeamId ? `_${teams.find(t => t.id === selectedTeamId)?.name ?? ''}` : '';
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `상세본_서비스본부_주간_보고_${year}년_${weekNum}주차${suffix}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(a.href);
    } catch {
      alert('서버 오류');
    } finally {
      setPdfExporting(false);
    }
  };

  const range = getWeekRange(year, weekNum);
  const lockedCount = teams.filter(t => t.isLocked).length;
  const writtenCount = teams.filter(t => t.hasContent).length;

  // ── 복사 ──────────────────────────────────────────────
  const buildCopy = () => {
    const tdStyle = 'border:0.5pt solid #7f7f7f;padding:3pt;vertical-align:top;font-size:9pt;';
    const rows: string[] = [];
    let text = '';

    teams.forEach(team => {
      if (selectedTeamId != null && team.id !== selectedTeamId) return;
      if (onlyFilled && !team.hasContent) return;
      team.parts.forEach(part => {
        part.majors.forEach(major => {
          const cats = major.categories.filter(c =>
            onlyFilled ? c.current.length > 0 || c.next.length > 0 : true
          );
          if (cats.length === 0) return;

          const section = (blocks: ContentBlock[]) => {
            let t = '', h = '';
            let seq = -1;
            blocks.forEach(b => {
              if (isTableBlock(b)) { t += tableToText(b); h += tableToHtml(b); return; }
              seq += 1;
              const auth = includeAuthor && b.authorText ? ` [${b.authorText}]` : '';
              t += `     ${marked(seq)} ${b.subText || ''}${auth}\n`;
              h += `<div>&nbsp;&nbsp;&nbsp;&nbsp;${marked(seq)} ${b.subText || ''}${auth}</div>`;
              b.bullets.forEach(bu => {
                t += `          - ${bu.text || ''}\n`;
                h += `<div>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;- ${bu.text || ''}</div>`;
              });
            });
            if (blocks.length === 0) { t += `     ① 내용없음\n`; h += `<div>&nbsp;&nbsp;&nbsp;&nbsp;① 내용없음</div>`; }
            return { t, h };
          };

          let curT = '', curH = '', nxtT = '', nxtH = '';
          cats.forEach((c, i) => {
            const a = section(c.current);
            const b = section(c.next);
            curT += `${circled(i)} ${c.middle}\n${a.t}`;
            curH += `<div>${circled(i)} ${c.middle}</div>${a.h}`;
            nxtT += `${circled(i)} ${c.middle}\n${b.t}`;
            nxtH += `<div>${circled(i)} ${c.middle}</div>${b.h}`;
          });

          text += `${team.division}\t${part.name}\t${major.name}\t${curT.trim()}\t${nxtT.trim()}\n`;
          rows.push(
            `<tr><td style="${tdStyle}">${team.division}</td>` +
            `<td style="${tdStyle}">${part.name}</td>` +
            `<td style="${tdStyle}">${major.name}</td>` +
            `<td style="${tdStyle}">${curH}</td>` +
            `<td style="${tdStyle}">${nxtH}</td></tr>`
          );
        });
      });
    });

    const html =
      `<table style="border-collapse:collapse;width:100%;border:0.5pt solid #7f7f7f;">` +
      `<tr>` +
      ['구분', '분류1', '분류2', `${weekNum}주 금주`, `${weekNum + 1}주 차주`]
        .map(h => `<td style="${tdStyle}background:#f2f2f2;font-weight:bold;text-align:center;">${h}</td>`)
        .join('') +
      `</tr>${rows.join('')}</table>`;

    return { text: text.trim(), html };
  };

  const handleCopy = () => {
    const { text, html } = buildCopy();
    if (!text) { alert('복사할 내용이 없습니다.'); return; }
    if (navigator.clipboard && window.isSecureContext && window.ClipboardItem) {
      navigator.clipboard
        .write([new ClipboardItem({
          'text/plain': new Blob([text], { type: 'text/plain' }),
          'text/html': new Blob([html], { type: 'text/html' })
        })])
        .then(() => alert('전체 취합본이 복사되었습니다.'))
        .catch(() => alert('복사 실패'));
    } else {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.left = '-9999px';
      document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
      alert('전체 취합본이 복사되었습니다.');
    }
  };

  // ── 렌더 ──────────────────────────────────────────────
  const renderBlocks = (blocks: ContentBlock[]) => {
    if (blocks.length === 0) return <span style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>내용 없음</span>;
    let seq = -1;
    return blocks.map(b => {
      if (isTableBlock(b)) return <TableBlockView key={b.id} block={b} />;
      seq += 1;
      const s = seq;
      return (
        <div key={b.id} style={{ marginBottom: '0.35rem' }}>
          <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>
            {marked(s)} {b.subText}
            {includeAuthor && b.authorText && (
              <span style={{ color: 'var(--primary)', fontWeight: 700, marginLeft: '0.3rem' }}>[{b.authorText}]</span>
            )}
          </div>
          {b.bullets.map(x => (
            <div key={x.id} style={{ paddingLeft: '1.6rem', fontSize: '0.82rem', color: 'var(--text-muted)' }}>- {x.text}</div>
          ))}
        </div>
      );
    });
  };

  if (isHydrating) return null;
  if (!canViewOverview) return null;

  const selectedTeam = teams.find(t => t.id === selectedTeamId) ?? null;
  const visibleTeams = teams
    .filter(t => selectedTeamId == null || t.id === selectedTeamId)
    .filter(t => (onlyFilled ? t.hasContent : true));

  return (
    <div style={{ marginTop: '2rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* 헤더 */}
      <div className="glass-panel" style={{ padding: '1.5rem 2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '1.5rem' }}>서비스본부 전체 취합본</h2>
          <p style={{ margin: '0.3rem 0 0', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
            {year}년 {weekNum}주차 ({formatDateShort(range.monday)} ~ {formatDateShort(range.friday)})
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.8rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={{ fontSize: '0.85rem' }}>연도 <input type="number" value={year} onChange={e => setYear(parseInt(e.target.value, 10))} className="input-field" style={{ width: '80px', marginLeft: '0.3rem', padding: '0.3rem' }} /></label>
          <label style={{ fontSize: '0.85rem' }}>주차 <input type="number" value={weekNum} onChange={e => setWeekNum(parseInt(e.target.value, 10))} className="input-field" style={{ width: '70px', marginLeft: '0.3rem', padding: '0.3rem' }} /></label>
          <button onClick={fetchData} className="btn btn-primary" style={{ padding: '0.4rem 1.2rem' }}>조회</button>
        </div>
      </div>

      {error && (
        <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: '8px', padding: '1rem 1.5rem', color: '#dc2626', fontWeight: 600 }}>
          {error}
        </div>
      )}

      {/* 옵션 + 내보내기 (우측 정렬) */}
      <div style={{ display: 'flex', gap: '0.8rem', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
        <label style={{ fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.3rem', cursor: 'pointer' }}>
          <input type="checkbox" checked={onlyFilled} onChange={() => setOnlyFilled(v => !v)} style={{ cursor: 'pointer', accentColor: 'var(--primary)' }} />
          작성된 항목만 보기
        </label>
        <label style={{ fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.3rem', cursor: 'pointer' }}>
          <input type="checkbox" checked={includeAuthor} onChange={() => setIncludeAuthor(v => !v)} style={{ cursor: 'pointer', accentColor: 'var(--primary)' }} />
          작성자 포함
        </label>
        <button onClick={handleCopy} className="btn btn-primary" style={{ padding: '0.4rem 1.3rem' }}>
          {selectedTeam ? `${selectedTeam.name} 복사` : '전체 복사'}
        </button>
        {driveReady && (
          <>
            <button
              onClick={handlePdfExport}
              disabled={pdfExporting}
              title="현재 보고 있는 내용을 원본 양식 PDF 로 내려받습니다"
              className="btn"
              style={{ padding: '0.4rem 1.1rem', color: '#dc2626', borderColor: '#dc2626', fontWeight: 600 }}
            >
              {pdfExporting ? 'PDF 생성 중...' : 'PDF 내보내기'}
            </button>
            <button
              onClick={handleDriveExport}
              disabled={exporting}
              title="구글 드라이브 주간보고 폴더에 연/월 폴더를 만들어 저장합니다"
              className="btn"
              style={{ padding: '0.4rem 1.1rem', color: '#0f9d58', borderColor: '#0f9d58', fontWeight: 600 }}
            >
              {exporting ? '내보내는 중...' : '드라이브로 내보내기'}
            </button>
          </>
        )}
      </div>

      {/* 본문: 좌측 팀 필터 + 우측 취합본 */}
      <div className="overview-body" style={{ display: 'flex', gap: '1.2rem', alignItems: 'flex-start' }}>
        {/* 좌측 팀별 현황/필터 */}
        <aside
          className="glass-panel overview-sidebar"
          style={{ padding: '1rem', width: '210px', flexShrink: 0, position: 'sticky', top: '1rem', alignSelf: 'flex-start' }}
        >
          <div style={{ fontWeight: 700, fontSize: '0.92rem', marginBottom: '0.2rem' }}>팀별 취합 현황</div>
          <div style={{ fontSize: '0.76rem', color: 'var(--primary)', fontWeight: 600, marginBottom: '0.7rem' }}>
            잠금 {lockedCount}/{teams.length} · 작성 {writtenCount}/{teams.length}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
            {/* 전체 보기 */}
            {(() => {
              const on = selectedTeamId == null;
              return (
                <button
                  onClick={() => setSelectedTeamId(null)}
                  style={{
                    textAlign: 'left', cursor: 'pointer', width: '100%',
                    border: on ? '2px solid var(--primary)' : '1px solid var(--border)',
                    background: on ? 'var(--primary)' : 'var(--surface-dim)',
                    color: on ? 'white' : 'var(--foreground)',
                    borderRadius: '6px', padding: '0.45rem 0.6rem'
                  }}
                >
                  <div style={{ fontSize: '0.6rem', fontWeight: 700, opacity: 0.75 }}>서비스본부</div>
                  <div style={{ fontWeight: 700, fontSize: '0.86rem', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <span>전체</span>
                    <span style={{ fontSize: '0.7rem', fontWeight: 600, opacity: 0.85 }}>{teams.length}팀</span>
                  </div>
                </button>
              );
            })()}

            {teams.map(t => {
              const state = t.isLocked ? 'locked' : t.hasContent ? 'writing' : 'empty';
              const color = state === 'locked' ? '#16a34a' : state === 'writing' ? '#d97706' : '#94a3b8';
              const bg = state === 'locked' ? 'rgba(34,197,94,0.10)' : state === 'writing' ? 'rgba(217,119,6,0.10)' : 'var(--surface-dim)';
              const label = state === 'locked' ? '잠금' : state === 'writing' ? '작성중' : '미작성';
              const on = selectedTeamId === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setSelectedTeamId(on ? null : t.id)}
                  title={on ? '클릭하면 전체 보기로 돌아갑니다' : `${t.name} 내용만 보기`}
                  style={{
                    textAlign: 'left', cursor: 'pointer', width: '100%',
                    border: on ? '2px solid var(--primary)' : `1px solid ${color}33`,
                    background: bg, color: 'var(--foreground)', borderRadius: '6px',
                    padding: '0.45rem 0.6rem',
                    boxShadow: on ? '0 0 0 2px color-mix(in srgb, var(--primary) 22%, transparent)' : 'none'
                  }}
                >
                  <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', fontWeight: 700 }}>{t.division}</div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '0.3rem' }}>
                    <span style={{ fontWeight: 700, fontSize: '0.84rem' }}>{t.name}</span>
                    <span style={{ color, fontWeight: 700, fontSize: '0.68rem', whiteSpace: 'nowrap' }}>
                      {state === 'locked' ? '\u{1F512}' : state === 'writing' ? '✎' : '○'} {label}
                    </span>
                  </div>
                </button>
              );
            })}
            {teams.length === 0 && !loading && <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>팀이 없습니다.</p>}
          </div>
        </aside>

        {/* 우측 취합본 */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
          {selectedTeam && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.88rem' }}>
              <span style={{ fontWeight: 700, color: 'var(--primary)' }}>{selectedTeam.name}</span>
              <span style={{ color: 'var(--text-muted)' }}>만 보는 중</span>
              <button onClick={() => setSelectedTeamId(null)} className="btn" style={{ fontSize: '0.72rem', padding: '0.1rem 0.5rem' }}>전체 보기</button>
            </div>
          )}
          {loading ? (
            <p style={{ textAlign: 'center', color: 'var(--text-muted)' }}>불러오는 중입니다...</p>
          ) : (
            <div className="glass-panel" style={{ padding: '1.2rem', overflowX: 'auto' }}>
          {/* table-layout:fixed → 헤더에 준 열 너비를 그대로 적용해 금주=차주 동일폭 유지 */}
          <table className="summary-table" style={{ minWidth: '1100px', width: '100%', tableLayout: 'fixed' }}>
            <thead>
              <tr>
                <th style={{ width: '6%' }}>구분</th>
                <th style={{ width: '8%' }}>팀</th>
                <th style={{ width: '7%' }}>파트</th>
                <th style={{ width: '8%' }}>분류</th>
                <th style={{ width: '10%' }}>중분류</th>
                <th style={{ width: '30.5%' }}>{weekNum}주차 금주</th>
                <th style={{ width: '30.5%' }}>{weekNum + 1}주차 차주</th>
              </tr>
            </thead>
            <tbody>
              {visibleTeams.map(team => {
                const rows: React.ReactNode[] = [];
                const teamCatCount = team.parts.reduce(
                  (n, p) => n + p.majors.reduce((m, mj) => m + mj.categories.filter(c => !onlyFilled || c.current.length > 0 || c.next.length > 0).length, 0),
                  0
                );
                if (teamCatCount === 0) return null;
                let firstOfTeam = true;

                // 파트가 하나뿐인 팀은 파트가 사실상 팀 자체를 가리킨다.
                // 이런 팀은 파트 칸을 따로 두지 않고 팀 → 대분류 → 중분류 3단으로 보여준다.
                const shownParts = team.parts.filter(
                  p => p.majors.some(mj => mj.categories.some(c => !onlyFilled || c.current.length > 0 || c.next.length > 0))
                );
                const singlePart = shownParts.length === 1;
                const soloPartName = singlePart ? shownParts[0].name : '';
                // 파트명이 팀명이나 대분류명과 겹치면 굳이 다시 적지 않는다
                const soloMajorNames = singlePart
                  ? shownParts[0].majors
                      .filter(mj => mj.categories.some(c => !onlyFilled || c.current.length > 0 || c.next.length > 0))
                      .map(mj => mj.name)
                  : [];
                const showSoloPartLabel =
                  singlePart && soloPartName !== team.name && !soloMajorNames.includes(soloPartName);
                // 파트·대분류가 하나뿐이고 이름이 팀명과 같으면(PMO 등) 팀 칸에 흡수
                const teamAbsorbsMajor =
                  singlePart && soloMajorNames.length === 1 && soloMajorNames[0] === team.name;
                // 구분(본부)명까지 팀명과 같으면 한 칸으로
                const divisionEqTeam = team.division === team.name;

                team.parts.forEach(part => {
                  const partCatCount = part.majors.reduce(
                    (m, mj) => m + mj.categories.filter(c => !onlyFilled || c.current.length > 0 || c.next.length > 0).length,
                    0
                  );
                  if (partCatCount === 0) return;
                  let firstOfPart = true;

                  // 문서에 분류2가 없던 행은 대분류를 파트명으로 채워둔 상태다.
                  // 같은 값이 두 칸에 반복되지 않도록 파트/분류 셀을 하나로 합친다.
                  const shownMajors = part.majors.filter(
                    m => m.categories.filter(c => !onlyFilled || c.current.length > 0 || c.next.length > 0).length > 0
                  );
                  const mergePartMajor = shownMajors.length === 1 && shownMajors[0].name === part.name;

                  part.majors.forEach(major => {
                    const cats = major.categories.filter(c => !onlyFilled || c.current.length > 0 || c.next.length > 0);
                    if (cats.length === 0) return;

                    cats.forEach((cat, ci) => {
                      rows.push(
                        <tr key={`${team.id}-${part.id}-${major.id}-${cat.id}`}>
                          {firstOfTeam && (
                            divisionEqTeam && teamAbsorbsMajor ? (
                              // 구분=팀=파트=분류 (PMO 등) → 한 칸으로
                              <td rowSpan={teamCatCount} colSpan={4} style={{ fontWeight: 700, textAlign: 'center', verticalAlign: 'middle', background: 'var(--surface-dim)', fontSize: '0.85rem' }}>
                                {team.name}
                                <div style={{ marginTop: '0.3rem', fontSize: '0.68rem', fontWeight: 600, color: team.isLocked ? '#16a34a' : '#d97706' }}>
                                  {team.isLocked ? '잠금' : '작성중'}
                                </div>
                              </td>
                            ) : (
                              <>
                                <td rowSpan={teamCatCount} style={{ fontWeight: 700, textAlign: 'center', verticalAlign: 'middle', background: 'var(--surface-dim)', fontSize: '0.85rem' }}>{team.division}</td>
                                <td rowSpan={teamCatCount} colSpan={teamAbsorbsMajor ? 3 : 1} style={{ fontWeight: 700, textAlign: 'center', verticalAlign: 'middle', fontSize: '0.85rem' }}>
                                  {team.name}
                                  {showSoloPartLabel && (
                                    <div style={{ marginTop: '0.15rem', fontSize: '0.68rem', fontWeight: 500, color: 'var(--text-muted)' }}>
                                      {soloPartName}
                                    </div>
                                  )}
                                  <div style={{ marginTop: '0.3rem', fontSize: '0.68rem', fontWeight: 600, color: team.isLocked ? '#16a34a' : '#d97706' }}>
                                    {team.isLocked ? '잠금' : '작성중'}
                                  </div>
                                </td>
                              </>
                            )
                          )}
                          {/* 파트가 여러 개인 팀만 파트 칸을 그린다 */}
                          {!singlePart && firstOfPart && (
                            <td
                              rowSpan={partCatCount}
                              colSpan={mergePartMajor ? 2 : 1}
                              style={{ fontWeight: 600, textAlign: 'center', verticalAlign: 'middle', fontSize: '0.85rem' }}
                            >
                              {part.name}
                            </td>
                          )}
                          {(singlePart || !mergePartMajor) && ci === 0 && !teamAbsorbsMajor && (
                            <td
                              rowSpan={cats.length}
                              colSpan={singlePart ? 2 : 1}
                              style={{ fontWeight: 600, textAlign: 'center', verticalAlign: 'middle', fontSize: '0.85rem' }}
                            >
                              {major.name}
                            </td>
                          )}
                          <td style={{ fontSize: '0.85rem' }}>{circled(ci)} {cat.middle}</td>
                          <td style={{ verticalAlign: 'top', padding: '0.6rem' }}>{renderBlocks(cat.current)}</td>
                          <td style={{ verticalAlign: 'top', padding: '0.6rem' }}>{renderBlocks(cat.next)}</td>
                        </tr>
                      );
                      firstOfTeam = false;
                      firstOfPart = false;
                    });
                  });
                });
                return rows;
              })}
            </tbody>
          </table>
          {(visibleTeams.length === 0 || visibleTeams.every(t => !t.hasContent)) && (
            <p style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem' }}>
              {selectedTeam ? `${selectedTeam.name}의 ` : ''}{weekNum}주차에 작성된 내용이 없습니다.
            </p>
          )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
