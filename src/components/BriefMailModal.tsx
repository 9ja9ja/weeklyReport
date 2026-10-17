'use client';

import { useCallback, useEffect, useState } from 'react';
import { formatSize, type BriefTeamStatusData } from '@/components/BriefTeamStatusCard';

interface Recipient { email: string; name: string }

interface Preview {
  from: string;
  subject: string;
  html: string;
  totalSize: number;
  pendingTeams: string[];
  locked: boolean;
  smtpConfigured: boolean;
  lastSent: { status: string; sentAt: string; sentByName: string | null; count: number } | null;
}

interface FileOption { id: number; fileName: string; size: number; teamName: string }

const EMAIL = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;

/** "홍길동 <a@b.c>" 또는 "a@b.c" 한 줄을 이름·이메일로 나눈다 */
function parseRecipient(text: string): Recipient | null {
  const m = /^(.*?)\s*<([^<>]+)>$/.exec(text.trim());
  const email = (m ? m[2] : text).trim().toLowerCase();
  if (!EMAIL.test(email)) return null;
  return { email, name: m ? m[1].trim() : '' };
}

function mdhm(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 받는 사람/참조 한 줄 — 칩 목록 + 추가 입력 */
function RecipientField({
  label, list, onChange
}: { label: string; list: Recipient[]; onChange: (next: Recipient[]) => void }) {
  const [text, setText] = useState('');
  const [bad, setBad] = useState(false);

  const add = () => {
    if (!text.trim()) return;
    const r = parseRecipient(text);
    if (!r) { setBad(true); return; }
    if (!list.some(x => x.email === r.email)) onChange([...list, r]);
    setText('');
    setBad(false);
  };

  return (
    <>
      <div className="mail-lab">{label} ({list.length}명)</div>
      <div className="mail-tags">
        {list.map(r => (
          <span key={r.email} className="mail-tag" title={r.email}>
            {r.name ? `${r.name} · ${r.email}` : r.email}
            <button type="button" onClick={() => onChange(list.filter(x => x.email !== r.email))} aria-label="삭제">✕</button>
          </span>
        ))}
        <span className="mail-add">
          <input
            value={text}
            placeholder="이름 <이메일> 또는 이메일"
            style={bad ? { borderColor: '#ef4444' } : undefined}
            onChange={e => { setText(e.target.value); setBad(false); }}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
          />
          <button type="button" className="btn btn-sm" onClick={add}>추가</button>
        </span>
      </div>
    </>
  );
}

/**
 * 보고메일 보내기 팝업 — 받는 사람·참조 편집, 첨부 선택, 미리보기, 발송.
 * 수신자 목록은 발송할 때 서버에 저장돼 다음 주에도 그대로 불러온다.
 */
export default function BriefMailModal({
  year, weekNum, onClose, onSent
}: { year: number; weekNum: number; onClose: () => void; onSent: (message: string) => void }) {
  const [to, setTo] = useState<Recipient[]>([]);
  const [cc, setCc] = useState<Recipient[]>([]);
  const [files, setFiles] = useState<FileOption[]>([]);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  // 수신자 목록과 올려 둔 첨부를 한 번 불러온다
  useEffect(() => {
    (async () => {
      try {
        const [rRes, sRes] = await Promise.all([
          fetch('/api/briefs/mail/recipients'),
          fetch(`/api/briefs/team-status?year=${year}&weekNum=${weekNum}`)
        ]);
        if (rRes.ok) {
          const r = await rRes.json();
          setTo(r.to); setCc(r.cc);
        }
        if (sRes.ok) {
          const s: BriefTeamStatusData = await sRes.json();
          const list = s.teams.flatMap(t => t.attachments.map(a => ({ id: a.id, fileName: a.fileName, size: a.size, teamName: t.teamName })));
          setFiles(list);
          setPicked(new Set(list.map(f => f.id)));
        }
      } catch { setError('정보를 불러오지 못했습니다.'); }
      finally { setLoaded(true); }
    })();
  }, [year, weekNum]);

  // 선택한 첨부가 바뀌면 미리보기를 다시 만든다
  const pickedKey = [...picked].sort((a, b) => a - b).join(',');
  const loadPreview = useCallback(async () => {
    try {
      const res = await fetch('/api/briefs/mail/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year, weekNum, attachmentIds: pickedKey ? pickedKey.split(',').map(Number) : [] })
      });
      if (res.ok) setPreview(await res.json());
    } catch { /* 미리보기만 비고 발송 흐름은 그대로 둔다 */ }
  }, [year, weekNum, pickedKey]);
  useEffect(() => { if (loaded) loadPreview(); }, [loaded, loadPreview]);

  const send = async (confirmResend = false) => {
    setSending(true);
    setError('');
    try {
      // 고친 수신자 목록을 먼저 저장한다 — 발송이 실패해도 입력한 목록은 남는다
      const saved = await fetch('/api/briefs/mail/recipients', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to, cc })
      });
      if (!saved.ok) { setError((await saved.json().catch(() => ({}))).error || '수신자 목록을 저장하지 못했습니다.'); return; }

      const res = await fetch('/api/briefs/mail/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          year, weekNum, confirmResend,
          to: to.map(r => r.email), cc: cc.map(r => r.email),
          attachmentIds: [...picked]
        })
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 409 && body.code === 'already_sent') {
        if (confirm(`${body.error}\n\n같은 내용이 수신자에게 한 번 더 갑니다.`)) { setSending(false); return send(true); }
        return;
      }
      if (!res.ok) { setError(body.error || '발송에 실패했습니다.'); return; }
      onSent(body.status === 'dryrun'
        ? '테스트 모드(SMTP 미설정)라 실제로 발송하지 않고 이력만 남겼습니다.'
        : `보고메일을 발송했습니다. (받는 ${to.length} · 참조 ${cc.length})`);
      onClose();
    } catch { setError('발송에 실패했습니다.'); }
    finally { setSending(false); }
  };

  const toggleFile = (id: number) =>
    setPicked(prev => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const canSend = !!preview?.locked && to.length > 0 && !sending;

  return (
    <div className="mail-modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget && !sending) onClose(); }}>
      <div className="mail-modal" role="dialog" aria-label="보고메일 보내기">
        <div className="mail-modal-head">
          <h3>보고메일 보내기 · {year}년 {weekNum}주차</h3>
          <button type="button" className="mail-x" onClick={onClose} disabled={sending} aria-label="닫기">✕</button>
        </div>

        <div className="mail-lab">보낸 사람</div>
        <div className="mail-tags"><span className="mail-tag">{preview?.from ?? 'Finger <no-reply@finger.co.kr>'}</span></div>

        <RecipientField label="받는 사람" list={to} onChange={setTo} />
        <RecipientField label="참조" list={cc} onChange={setCc} />
        <div className="mail-foot-note" style={{ marginTop: '0.3rem' }}>목록은 발송할 때 저장되어 다음 주에도 그대로 불러옵니다.</div>

        <div className="mail-lab">제목</div>
        <div className="mail-subject">{preview?.subject ?? ' '}</div>

        <div className="mail-lab">첨부파일 (함께 보낼 파일 선택)</div>
        {files.length === 0 && <div className="mail-foot-note">요약본에 올려 둔 첨부파일이 없습니다.</div>}
        {files.map(f => (
          <label key={f.id} className="mail-file">
            <input type="checkbox" checked={picked.has(f.id)} onChange={() => toggleFile(f.id)} />
            <b>{f.fileName}</b>
            <span className="mail-file-team">{f.teamName}</span>
            <span className="mail-file-size">{formatSize(f.size)}</span>
          </label>
        ))}
        {files.length > 0 && (
          <div className="mail-foot-note">{picked.size}개 선택 · {formatSize(preview?.totalSize ?? 0)}</div>
        )}

        <div className="mail-lab">메일 미리보기</div>
        {/* sandbox 를 비워 스크립트·폼·링크 이동을 모두 막는다 — 미리보기는 보기 전용이다 */}
        <iframe className="mail-preview" sandbox="" srcDoc={preview?.html ?? ''} title="메일 미리보기" />

        {preview && !preview.locked && (
          <div className="mail-warn">요약본이 아직 최종 잠금되지 않았습니다. 잠금한 뒤에 보낼 수 있습니다.</div>
        )}
        {preview && preview.pendingTeams.length > 0 && (
          <div className="mail-warn">작성완료 체크가 안 된 팀이 있습니다: {preview.pendingTeams.join(', ')}. 그래도 보낼 수 있습니다.</div>
        )}
        {preview && !preview.smtpConfigured && (
          <div className="mail-info">테스트 모드: 메일 서버(SMTP)가 설정되지 않아 발송하지 않고 이력만 남깁니다.</div>
        )}
        {error && <div className="mail-err">{error}</div>}

        <div className="mail-modal-foot">
          <span className="mail-foot-note">
            {preview?.lastSent
              ? `지난 ${preview.lastSent.status === 'dryrun' ? '테스트 ' : ''}발송: ${mdhm(preview.lastSent.sentAt)}${preview.lastSent.sentByName ? ` · ${preview.lastSent.sentByName}` : ''} · ${preview.lastSent.count}명`
              : ' '}
          </span>
          <span style={{ display: 'flex', gap: '0.4rem' }}>
            <button type="button" className="btn btn-sm" onClick={onClose} disabled={sending}>취소</button>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => send()} disabled={!canSend}>
              {sending ? '발송 중...' : `발송 (받는 ${to.length} · 참조 ${cc.length})`}
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}
