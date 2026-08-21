'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useUser } from '@/lib/UserContext';
import { getWeekNumber, getWeekRange, getPrevWeek, getDefaultWeek, formatDateShort } from '@/lib/weekUtils';
import { useBriefRealtime, useBriefTitleText, useYText } from '@/components/useBriefRealtime';
import type { Editor } from '@tiptap/core';
import dynamic from 'next/dynamic';

const BriefEditor = dynamic(() => import('@/components/BriefEditor'), { ssr: false });

/** 마지막 저장 시각을 사람이 읽는 문구로 */
function savedLabel(at: number | null): string {
  if (!at) return '';
  const sec = Math.floor((Date.now() - at) / 1000);
  if (sec < 10) return '방금 저장됨';
  if (sec < 60) return `${sec}초 전 저장됨`;
  return `${Math.floor(sec / 60)}분 전 저장됨`;
}

interface BriefData {
  id: number;
  year: number;
  weekNum: number;
  title: string;
  content: string;
  isLocked: boolean;
  lockedBy: number | null;
  lockedAt: string | null;
}

export default function BriefPage() {
  const { userId, userName, isMasterOrAbove, canViewOverview, isHydrating } = useUser();
  const router = useRouter();

  const now = new Date();
  // 월·화는 지난주, 수~일은 이번주로 연다
  const defaultWeek = getDefaultWeek(now);
  const [year, setYear] = useState(defaultWeek.year);
  const [weekNum, setWeekNum] = useState(defaultWeek.weekNum);
  const [brief, setBrief] = useState<BriefData | null>(null);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [, setDirty] = useState(false);
  const contentRef = useRef(content);
  contentRef.current = content;
  const [editor, setEditor] = useState<Editor | null>(null);

  // 실시간 공동 편집. 연결되지 않으면 mode='legacy' 로 떨어져 아래 기존 흐름이 그대로 돈다.
  const rt = useBriefRealtime(year, weekNum, userId, userName);
  const live = rt.mode === 'realtime';
  const titleText = useBriefTitleText(rt.doc);
  const yTitle = useYText(titleText);
  const [, tick] = useState(0);

  // '방금 저장됨' 문구가 시간이 지나도 안 바뀌면 오래된 정보로 오해하게 된다
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => tick(n => n + 1), 15000);
    return () => clearInterval(t);
  }, [live]);

  useEffect(() => {
    if (!isHydrating && (!userId || !canViewOverview)) router.replace('/');
  }, [isHydrating, userId, canViewOverview, router]);

  const range = getWeekRange(year, weekNum);

  // 공동 편집 중에는 서버(룸)가 알려주는 상태가 우선이다 — 남이 잠그면 즉시 반영돼야 한다
  const lockedNow = live ? rt.locked : (brief?.isLocked ?? false);

  const load = useCallback(async () => {
    setLoading(true);
    setMsg('');
    try {
      const res = await fetch(`/api/briefs?year=${year}&weekNum=${weekNum}`);
      const data = await res.json();
      if (data.brief) {
        setBrief(data.brief);
        setTitle(data.brief.title);
        setContent(data.brief.content);
      } else {
        setBrief(null);
        setTitle('');
        setContent('');
      }
      setDirty(false);
    } catch { setMsg('데이터를 불러오지 못했습니다.'); }
    finally { setLoading(false); }
  }, [year, weekNum]);

  useEffect(() => { if (userId) load(); }, [userId, load]);

  const save = async () => {
    setSaving(true);
    setMsg('');
    // 공동 편집은 이미 자동 저장되고 있다. [저장]은 디바운스를 기다리지 않고 즉시 반영시킨다.
    if (live) {
      const err = await rt.flush();
      setMsg(err || '저장되었습니다.');
      if (!err) { setDirty(false); setTimeout(() => setMsg(''), 2000); }
      setSaving(false);
      return;
    }
    try {
      const res = await fetch('/api/briefs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year, weekNum, title, content: contentRef.current })
      });
      const data = await res.json();
      if (!res.ok) { setMsg(data.error || '저장에 실패했습니다.'); return; }
      setBrief(data.brief);
      setDirty(false);
      setMsg('저장되었습니다.');
      setTimeout(() => setMsg(''), 2000);
    } catch { setMsg('저장에 실패했습니다.'); }
    finally { setSaving(false); }
  };

  const toggleLock = async () => {
    // brief 는 주차 로드 시점 값이라 남이 방금 잠근 것을 모른다.
    // 화면에 보이는 상태(lockedNow)를 기준으로 해야 라벨과 실제 동작이 어긋나지 않는다.
    const next = !lockedNow;
    if (next && !confirm('이 요약본을 잠금 처리하시겠습니까? 잠금 중에는 수정할 수 없습니다.')) return;
    try {
      const res = await fetch('/api/briefs', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year, weekNum, isLocked: next })
      });
      const data = await res.json();
      if (res.ok) {
        setBrief(data.brief);
        setMsg(data.warning ?? (next ? '잠금 처리되었습니다.' : '잠금이 해제되었습니다.'));
        if (!data.warning) setTimeout(() => setMsg(''), 2000);
      }
    } catch {}
  };

  const copyFromPrev = async () => {
    // 동기화 전에 문서를 갈아엎으면 뒤늦게 도착한 서버 본문과 합쳐져 내용이 두 벌이 된다.
    // 제목도 meta.title 이 아직 없어 입력창에만 보이고 문서에는 안 들어간다.
    if (!editable) return;
    const prev = getPrevWeek(year, weekNum);
    if (!confirm(`${prev.year}년 ${prev.weekNum}주차 내용을 복사하시겠습니까?`)) return;
    try {
      const res = await fetch(`/api/briefs?year=${prev.year}&weekNum=${prev.weekNum}`);
      const data = await res.json();
      if (data.brief && data.brief.content) {
        if (live) {
          // 공동 편집 중에는 문서 자체를 바꿔야 다른 사람 화면에도 반영된다.
          // preserveWhitespace 가 없으면 공백으로 만든 계단식 들여쓰기가 파싱에서 접힌다
          // (개인 작성 경로는 BriefEditor 안에서 같은 옵션으로 넣고 있다)
          editor?.commands.setContent(data.brief.content, { parseOptions: { preserveWhitespace: 'full' } });
          yTitle.push(data.brief.title ?? '');
          setMsg('전주차 내용을 복사했습니다.');
          setTimeout(() => setMsg(''), 3000);
          return;
        }
        setTitle(data.brief.title);
        setContent(data.brief.content);
        setDirty(true);
        setMsg('전주차 내용을 복사했습니다. 저장 버튼을 눌러 저장해주세요.');
        setTimeout(() => setMsg(''), 3000);
      } else {
        setMsg('전주차 데이터가 없습니다.');
        setTimeout(() => setMsg(''), 2000);
      }
    } catch { setMsg('복사에 실패했습니다.'); }
  };

  const exportPdf = () => {
    const pdfTitle = live ? yTitle.value : title;
    const editorEl = document.querySelector('.brief-editor-content .tiptap') as HTMLElement;
    if (!editorEl) return;

    // 원격 커서는 에디터 DOM 안의 위젯이라 그대로 인쇄하면 남의 이름이 본문에 섞인다
    const printable = editorEl.cloneNode(true) as HTMLElement;
    printable.querySelectorAll(
      '.collaboration-carets__caret, .collaboration-carets__label, .ProseMirror-yjs-cursor'
    ).forEach(el => el.remove());

    // 제목은 다른 마스터가 공동 편집으로 바꿀 수 있는 값이다.
    // document.write 에 그대로 넣으면 같은 오리진 창에서 실행된다.
    const esc = (v: string) => v.replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
    const safeTitle = esc(pdfTitle || '요약본');
    const printWin = window.open('', '_blank');
    if (!printWin) return;
    printWin.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8">
      <title>${safeTitle} - ${year}년 ${weekNum}주차</title>
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
        <h1>${safeTitle}</h1>
        <p>${year}년 ${weekNum}주차 (${formatDateShort(range.monday)}~${formatDateShort(range.friday)})</p>
      </div>
      ${printable.innerHTML}
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

  const isLocked = lockedNow;
  // 서버 문서를 다 받기 전에는 편집을 막는다 — 빈 문서에 입력하면 뒤늦게 도착한 본문과 뒤섞인다
  const editable = rt.mode === 'loading'
    ? false                                              // 실시간 여부가 정해지기 전에는 편집 금지
    : live
      ? (!rt.readOnly && rt.synced)                      // 서버 문서를 받고 쓰기 권한이 있을 때만
      : (isMasterOrAbove && !isLocked);
  const shownTitle = live ? yTitle.value : title;

  // 잠금·연결 끊김으로 제목 입력칸이 사라지면 compositionend 가 오지 않아 조합 플래그가 굳는다.
  // 굳으면 그 뒤 원격 제목이 반영되지 않고, 다음 입력이 엉뚱한 위치에 끼어든다.
  const endTitleComposing = yTitle.endComposing;
  useEffect(() => { if (!editable) endTitleComposing(); }, [editable, endTitleComposing]);

  if (isHydrating || !userId) return null;

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
          <div className="brief-actions">
            {editable && (
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

        {live && (
          <div className="brief-live-bar">
            <span className={`brief-live-dot${rt.connected && rt.synced ? ' on' : ''}`} />
            <span className="brief-live-label">
              {!rt.connected ? '연결 중...' : !rt.synced ? '문서 받는 중...' : '공동 편집 중'}
            </span>
            <div className="brief-peers">
              {rt.peers.map(p => (
                <span key={p.uid} className="brief-peer" style={{ borderColor: p.color, color: p.color }}>
                  {p.name || '익명'}
                </span>
              ))}
            </div>
            <span className="brief-live-saved">{rt.notice || savedLabel(rt.savedAt)}</span>
          </div>
        )}

        {loading ? (
          <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>로딩 중...</div>
        ) : !live && !brief?.content && !content && !isMasterOrAbove ? (
          <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>등록된 요약본이 없습니다.</div>
        ) : (
          <>
            <div className="brief-title-row">
              {editable ? (
                <input
                  type="text"
                  value={shownTitle}
                  onChange={e => {
                    if (live) yTitle.push(e.target.value);
                    else { setTitle(e.target.value); setDirty(true); }
                  }}
                  {...(live ? yTitle.compositionProps : {})}
                  placeholder="문서 제목 (예: 비즈니스플랫폼본부 주간보고)"
                  className="brief-title-input"
                />
              ) : (
                <h3 style={{ margin: 0 }}>{shownTitle}</h3>
              )}
              {isLocked && (
                <span className="brief-lock-badge">잠금됨</span>
              )}
            </div>
            <BriefEditor
              content={content}
              onChange={html => { contentRef.current = html; if (!live) { setContent(html); setDirty(true); } }}
              editable={editable}
              ydoc={rt.doc}
              provider={rt.provider}
              user={rt.localUser}
              onReady={setEditor}
            />
          </>
        )}
      </div>
    </div>
  );
}
