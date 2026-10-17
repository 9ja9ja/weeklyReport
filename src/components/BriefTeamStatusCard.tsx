'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export interface BriefTeamAttachment {
  id: number;
  fileName: string;
  size: number;
  uploadedAt: string;
  uploadedByName: string | null;
}

export interface BriefTeamStatusRow {
  teamId: number;
  teamName: string;
  checked: boolean;
  checkedAt: string | null;
  checkedByName: string | null;
  attachments: BriefTeamAttachment[];
  /** 이 사용자가 이 팀의 작성완료를 바꿀 수 있는가 (해당 팀 관리자·최고관리자) */
  canEdit: boolean;
  /** 이 사용자가 이 팀 첨부를 올리고 지울 수 있는가 (해당 팀 소속·최고관리자, 임원 제외) */
  canUpload: boolean;
}

export interface BriefTeamStatusData {
  teams: BriefTeamStatusRow[];
  total: number;
  checkedCount: number;
  attachmentCount: number;
  /** 보고메일이 이미 발송돼 첨부를 바꿀 수 없다 */
  attachmentsLocked: boolean;
}

/** 서로의 체크를 메신저 없이 확인하는 화면이라, 다른 사람이 누른 것이 곧 보이도록 자주 다시 읽는다 */
const REFRESH_MS = 15000;

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

function shortTime(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * 요약본 우측 "팀별 작성 현황" 카드.
 * 각 팀 관리자가 "우리 팀 내용을 요약본에 다 썼다"고 직접 체크하고,
 * 팀 줄을 펼쳐 이번 주 보고메일에 함께 나갈 첨부파일을 미리 올려 둔다.
 * refreshKey 가 바뀌면 즉시 다시 불러온다.
 */
export default function BriefTeamStatusCard({
  year, weekNum, refreshKey
}: { year: number; weekNum: number; refreshKey: number }) {
  const [data, setData] = useState<BriefTeamStatusData | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [dragTeam, setDragTeam] = useState<number | null>(null);
  const fileInputs = useRef<Record<number, HTMLInputElement | null>>({});

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/briefs/team-status?year=${year}&weekNum=${weekNum}`);
      if (!res.ok) throw new Error();
      setData(await res.json());
      setFailed(false);
    } catch { setFailed(true); }
  }, [year, weekNum]);

  useEffect(() => { load(); }, [load, refreshKey]);

  useEffect(() => {
    const t = setInterval(load, REFRESH_MS);
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    return () => { clearInterval(t); window.removeEventListener('focus', onFocus); };
  }, [load]);

  /** 서버 호출 한 번을 감싸 — 진행 중 중복 클릭을 막고, 실패 문구를 보여주고, 끝나면 다시 읽는다 */
  const run = async (fn: () => Promise<Response>, fallback: string) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const res = await fn();
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error || fallback);
      }
    } catch { setError(fallback); }
    finally { setBusy(false); await load(); }
  };

  const toggleCheck = (row: BriefTeamStatusRow) => {
    if (!row.canEdit) return;
    run(() => fetch('/api/briefs/team-check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ year, weekNum, teamId: row.teamId, checked: !row.checked })
    }), '체크를 저장하지 못했습니다.');
  };

  const upload = async (teamId: number, files: FileList | File[]) => {
    for (const file of Array.from(files)) {
      const form = new FormData();
      form.append('year', String(year));
      form.append('weekNum', String(weekNum));
      form.append('teamId', String(teamId));
      form.append('file', file);
      await run(() => fetch('/api/briefs/attachments', { method: 'POST', body: form }), `${file.name} 업로드에 실패했습니다.`);
    }
  };

  const remove = (a: BriefTeamAttachment) => {
    if (!confirm(`'${a.fileName}' 파일을 삭제하시겠습니까?`)) return;
    run(() => fetch(`/api/briefs/attachments/${a.id}`, { method: 'DELETE' }), '삭제하지 못했습니다.');
  };

  const toggleOpen = (teamId: number) =>
    setOpen(prev => {
      const next = new Set(prev);
      if (!next.delete(teamId)) next.add(teamId);
      return next;
    });

  return (
    <aside className="glass-panel brief-status-card">
      <h3 className="brief-status-title">팀별 작성 현황</h3>
      {data && (
        <div className="brief-status-count">작성완료 {data.checkedCount}/{data.total} · 첨부 {data.attachmentCount}개</div>
      )}
      {failed && !data && <div className="brief-status-empty">현황을 불러오지 못했습니다.</div>}
      {data && (
        <div className="brief-status-list">
          <div className="brief-status-total">
            <div>
              <div className="brief-status-total-sub">비즈니스플랫폼본부</div>
              <div className="brief-status-total-name">전체</div>
            </div>
            <span>{data.total}팀</span>
          </div>
          {data.teams.map(t => {
            const expanded = open.has(t.teamId);
            const canAdd = t.canUpload && !data.attachmentsLocked;
            return (
              <div key={t.teamId} className={`brief-status-row ${t.checked ? 'is-checked' : 'is-none'}`}>
                <div className="brief-status-top">
                  <button
                    type="button"
                    className="brief-status-main"
                    onClick={() => toggleOpen(t.teamId)}
                    aria-expanded={expanded}
                    title="첨부파일 펼치기/접기"
                  >
                    <span className="brief-status-name">{t.teamName}</span>
                    <span className="brief-status-meta">
                      {t.checked
                        ? [t.checkedByName, shortTime(t.checkedAt)].filter(Boolean).join(' · ')
                        : ' '}
                    </span>
                  </button>
                  <button
                    type="button"
                    className={`brief-attach-chip${t.attachments.length ? '' : ' is-zero'}`}
                    onClick={() => toggleOpen(t.teamId)}
                    title="첨부파일 펼치기/접기"
                  >
                    첨부 {t.attachments.length}
                  </button>
                  <button
                    type="button"
                    className={`brief-status-badge-state${t.canEdit ? ' is-editable' : ''}`}
                    disabled={!t.canEdit || busy}
                    onClick={() => toggleCheck(t)}
                    title={t.canEdit
                      ? (t.checked ? '클릭하면 작성완료를 해제합니다' : '우리 팀 내용을 다 썼으면 클릭해서 작성완료로 표시')
                      : undefined}
                  >
                    {t.checked ? '✓ 작성완료' : '○ 미작성'}
                  </button>
                </div>

                {expanded && (
                  <div className="brief-attach-body">
                    {t.attachments.length === 0 && <div className="brief-attach-empty">올려 둔 첨부파일이 없습니다.</div>}
                    {t.attachments.map(a => (
                      <div key={a.id} className="brief-attach-file">
                        <a href={`/api/briefs/attachments/${a.id}`} className="brief-attach-name" title={a.fileName}>{a.fileName}</a>
                        <span className="brief-attach-size">{formatSize(a.size)}</span>
                        {canAdd && (
                          <button type="button" className="brief-attach-del" onClick={() => remove(a)} disabled={busy}>삭제</button>
                        )}
                      </div>
                    ))}
                    {canAdd && (
                      <>
                        <input
                          ref={el => { fileInputs.current[t.teamId] = el; }}
                          type="file"
                          multiple
                          hidden
                          onChange={e => { if (e.target.files?.length) upload(t.teamId, e.target.files); e.target.value = ''; }}
                        />
                        <div
                          className={`brief-attach-drop${dragTeam === t.teamId ? ' is-over' : ''}`}
                          onClick={() => fileInputs.current[t.teamId]?.click()}
                          onDragOver={e => { e.preventDefault(); setDragTeam(t.teamId); }}
                          onDragLeave={() => setDragTeam(null)}
                          onDrop={e => {
                            e.preventDefault();
                            setDragTeam(null);
                            if (e.dataTransfer.files.length) upload(t.teamId, e.dataTransfer.files);
                          }}
                        >
                          + 파일 추가 (끌어다 놓거나 클릭)
                        </div>
                      </>
                    )}
                    {!canAdd && data.attachmentsLocked && (
                      <div className="brief-attach-empty">보고메일이 발송되어 첨부를 바꿀 수 없습니다.</div>
                    )}
                    {/* 올릴 권한이 없는 팀은 영역이 아예 없어 이유를 알 수 없다 — 안내를 남긴다 */}
                    {!t.canUpload && !data.attachmentsLocked && (
                      <div className="brief-attach-empty">첨부파일은 해당 팀 소속만 올릴 수 있습니다.</div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          {error && <div className="brief-status-error">{error}</div>}
          {data.teams.some(t => t.canEdit) && (
            <div className="brief-status-hint">우리 팀 내용을 다 썼으면 팀 줄 오른쪽의 상태를 눌러 표시하세요.</div>
          )}
        </div>
      )}
    </aside>
  );
}
