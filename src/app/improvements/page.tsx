'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useUser } from '@/lib/UserContext';
import {
  IMPROVEMENT_CATEGORIES, IMPROVEMENT_STATUS,
  requestKey, statusMeta, type ImprovementStatus
} from '@/lib/improvement';

interface Person { id: number; name: string }
interface Item {
  id: number; seq: number; title: string; category: string; status: string;
  createdAt: string; doneAt: string | null;
  author: Person; assignee: Person | null;
  _count: { comments: number };
}
interface Comment {
  id: number; body: string; type: string; createdAt: string; author: Person;
}
interface Detail extends Omit<Item, '_count'> {
  content: string; createdBy: number; comments: Comment[];
}

const fmt = (s: string) => {
  const d = new Date(s);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
};

function StatusBadge({ status }: { status: string }) {
  const m = statusMeta(status);
  return (
    <span style={{
      background: m.color, color: 'white', fontSize: '0.72rem', fontWeight: 700,
      padding: '0.12rem 0.5rem', borderRadius: '999px', whiteSpace: 'nowrap'
    }}>{m.label}</span>
  );
}

export default function ImprovementsPage() {
  const { userId, userName, isMasterOrAbove, isHydrating } = useUser();
  const router = useRouter();

  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [mine, setMine] = useState(false);
  const [q, setQ] = useState('');
  /**
   * 실제로 서버에 나가는 검색어.
   *
   * q 를 그대로 조회에 쓰면 한글 조합 중 자모('ㅈ','저','정')마다 요청이 나가
   * 목록이 계속 깜빡이고 미완성 글자로 검색된다. 조합이 끝난 뒤 잠깐 쉬면 반영한다.
   */
  const [qApplied, setQApplied] = useState('');
  const [composingQ, setComposingQ] = useState(false);

  const [writing, setWriting] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newContent, setNewContent] = useState('');
  const [newCategory, setNewCategory] = useState<string>('기타');

  const [openId, setOpenId] = useState<number | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [commentBody, setCommentBody] = useState('');
  const [people, setPeople] = useState<Person[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isHydrating && !userId) router.replace('/');
  }, [isHydrating, userId, router]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams();
      if (filterStatus) p.set('status', filterStatus);
      if (filterCategory) p.set('category', filterCategory);
      if (mine) p.set('mine', 'true');
      if (qApplied.trim()) p.set('q', qApplied.trim());
      const res = await fetch(`/api/improvements?${p}`);
      const d = await res.json();
      setItems(Array.isArray(d.items) ? d.items : []);
    } catch { setItems([]); }
    finally { setLoading(false); }
  }, [filterStatus, filterCategory, mine, qApplied]);

  useEffect(() => { if (userId) load(); }, [userId, load]);

  useEffect(() => {
    if (composingQ) return;                       // 조합 중에는 예약조차 하지 않는다
    const t = setTimeout(() => setQApplied(q), 300);
    return () => clearTimeout(t);
  }, [q, composingQ]);

  // 담당자 지정용 명단 — 관리자만 필요하다
  useEffect(() => {
    if (!isMasterOrAbove) return;
    fetch('/api/users').then(r => r.json()).then(d => {
      if (Array.isArray(d)) setPeople(d.map((u: Person) => ({ id: u.id, name: u.name })));
    }).catch(() => {});
  }, [isMasterOrAbove]);

  /** 상세만 다시 읽는다 — 쓰고 있던 댓글은 건드리지 않는다 */
  const fetchDetail = async (id: number) => {
    const res = await fetch(`/api/improvements/${id}/comments`);
    const d = await res.json();
    if (res.ok) setDetail(d.item);
  };

  /** 다른 요청을 새로 열 때만 쓴다 (댓글 입력칸을 비운다) */
  const openDetail = async (id: number) => {
    setOpenId(id);
    setDetail(null);
    setCommentBody('');
    await fetchDetail(id);
  };

  const submitNew = async () => {
    if (!newTitle.trim()) { alert('제목을 입력해주세요.'); return; }
    setBusy(true);
    try {
      const res = await fetch('/api/improvements', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: newTitle, content: newContent, category: newCategory })
      });
      if (!res.ok) { alert((await res.json()).error ?? '등록에 실패했습니다.'); return; }
      setNewTitle(''); setNewContent(''); setNewCategory('기타'); setWriting(false);
      load();
    } finally { setBusy(false); }
  };

  const patch = async (body: Record<string, unknown>) => {
    setBusy(true);
    try {
      const res = await fetch('/api/improvements', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (!res.ok) { alert((await res.json()).error ?? '변경에 실패했습니다.'); return false; }
      load();
      // 상태·담당만 바꾼 것이다 — 쓰고 있던 댓글을 지우면 안 된다
      if (openId) await fetchDetail(openId);
      return true;
    } finally { setBusy(false); }
  };

  const addComment = async () => {
    if (!openId || !commentBody.trim()) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/improvements/${openId}/comments`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: commentBody })
      });
      if (!res.ok) { alert((await res.json()).error ?? '등록에 실패했습니다.'); return; }
      setCommentBody('');
      await fetchDetail(openId);
      load();
    } finally { setBusy(false); }
  };

  const removeItem = async (id: number) => {
    if (!confirm('이 요청을 삭제하시겠습니까?')) return;
    const res = await fetch(`/api/improvements?id=${id}`, { method: 'DELETE' });
    if (!res.ok) { alert((await res.json()).error ?? '삭제에 실패했습니다.'); return; }
    setOpenId(null); setDetail(null);
    load();
  };

  if (isHydrating || !userId) return null;

  const counts = IMPROVEMENT_STATUS.map(s => ({
    ...s, n: items.filter(i => i.status === s.value).length
  }));

  return (
    <div className="container">
      <div className="glass-panel" style={{ padding: '1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
          <h2 style={{ margin: 0 }}>개선요청</h2>
          <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
            불편한 점이나 바꿨으면 하는 것을 남겨주세요. 진행 상태가 여기에 표시됩니다.
          </span>
          <button
            onClick={() => setWriting(v => !v)}
            className="btn btn-primary btn-sm"
            style={{ marginLeft: 'auto' }}
          >{writing ? '취소' : '+ 요청 등록'}</button>
        </div>

        {writing && (
          <div className="inner-box" style={{ marginBottom: '1rem', padding: '1rem' }}>
            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
              <select value={newCategory} onChange={e => setNewCategory(e.target.value)} className="input-field" style={{ width: '130px', padding: '0.4rem' }}>
                {IMPROVEMENT_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <input
                value={newTitle}
                onChange={e => setNewTitle(e.target.value)}
                placeholder="한 줄로 요약해주세요"
                className="input-field"
                style={{ flex: 1, padding: '0.4rem 0.6rem', minWidth: '220px' }}
              />
            </div>
            <textarea
              value={newContent}
              onChange={e => setNewContent(e.target.value)}
              placeholder={'어떤 상황에서 무엇이 불편한지, 어떻게 되면 좋을지 적어주세요.\n예) 매출 정산표에서 행이 아래로만 추가돼 최신 건을 매번 옮겨 적어야 합니다.'}
              rows={5}
              className="input-field"
              style={{ width: '100%', fontSize: '0.9rem' }}
            />
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
              <button onClick={submitNew} disabled={busy} className="btn btn-primary btn-sm">등록</button>
              <button onClick={() => setWriting(false)} className="btn btn-sm">취소</button>
            </div>
          </div>
        )}

        {/* 필터 */}
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap', paddingBottom: '0.9rem', marginBottom: '0.9rem', borderBottom: '1px solid var(--border)' }}>
          <button
            onClick={() => setFilterStatus('')}
            className="btn btn-sm"
            style={{ background: filterStatus === '' ? 'var(--primary)' : 'var(--btn-bg)', color: filterStatus === '' ? 'white' : 'var(--foreground)' }}
          >전체 {items.length}</button>
          {counts.map(s => (
            <button
              key={s.value}
              onClick={() => setFilterStatus(filterStatus === s.value ? '' : s.value)}
              className="btn btn-sm"
              style={{ background: filterStatus === s.value ? s.color : 'var(--btn-bg)', color: filterStatus === s.value ? 'white' : 'var(--foreground)' }}
            >{s.label}</button>
          ))}
          <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)} className="input-field" style={{ width: '120px', padding: '0.3rem' }}>
            <option value="">구분 전체</option>
            {IMPROVEMENT_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.85rem', cursor: 'pointer' }}>
            <input type="checkbox" checked={mine} onChange={e => setMine(e.target.checked)} /> 내가 등록한 것
          </label>
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            onCompositionStart={() => setComposingQ(true)}
            onCompositionEnd={e => { setComposingQ(false); setQ(e.currentTarget.value); }}
            placeholder="검색"
            className="input-field"
            style={{ width: '160px', padding: '0.3rem 0.5rem', marginLeft: 'auto' }}
          />
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '2.5rem', color: 'var(--text-muted)' }}>불러오는 중...</div>
        ) : items.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '2.5rem', color: 'var(--text-muted)' }}>등록된 개선요청이 없습니다.</div>
        ) : (
          <table style={{ marginTop: 0 }}>
            <thead>
              <tr>
                <th style={{ width: '80px', textAlign: 'center' }}>번호</th>
                <th style={{ width: '90px', textAlign: 'center' }}>구분</th>
                <th>제목</th>
                <th style={{ width: '90px', textAlign: 'center' }}>상태</th>
                <th style={{ width: '90px', textAlign: 'center' }}>요청자</th>
                <th style={{ width: '90px', textAlign: 'center' }}>담당</th>
                <th style={{ width: '100px', textAlign: 'center' }}>등록일</th>
              </tr>
            </thead>
            <tbody>
              {items.map(it => (
                <tr
                  key={it.id}
                  onClick={() => openDetail(it.id)}
                  className="user-row"
                  style={{ cursor: 'pointer' }}
                >
                  <td style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>{requestKey(it.seq)}</td>
                  <td style={{ textAlign: 'center', fontSize: '0.85rem' }}>{it.category}</td>
                  <td style={{ fontWeight: 600 }}>
                    {it.title}
                    {it._count.comments > 0 && (
                      <span style={{ color: 'var(--primary)', fontSize: '0.8rem', marginLeft: '0.4rem' }}>[{it._count.comments}]</span>
                    )}
                  </td>
                  <td style={{ textAlign: 'center' }}><StatusBadge status={it.status} /></td>
                  <td style={{ textAlign: 'center', fontSize: '0.85rem' }}>{it.author?.name}</td>
                  <td style={{ textAlign: 'center', fontSize: '0.85rem', color: it.assignee ? 'var(--foreground)' : 'var(--text-muted)' }}>
                    {it.assignee?.name ?? '-'}
                  </td>
                  <td style={{ textAlign: 'center', fontSize: '0.82rem', color: 'var(--text-muted)' }}>{fmt(it.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* 상세 */}
      {openId !== null && (
        <div className="modal-overlay" onClick={() => { setOpenId(null); setDetail(null); }}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '760px' }}>
            <div className="modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{detail ? requestKey(detail.seq) : ''}</span>
                {detail && <StatusBadge status={detail.status} />}
                <h3 style={{ margin: 0, fontSize: '1.05rem' }}>{detail?.title ?? '불러오는 중...'}</h3>
              </div>
              <button onClick={() => { setOpenId(null); setDetail(null); }} className="icon-btn del">✕</button>
            </div>

            <div className="modal-body">
              {!detail ? (
                <div style={{ color: 'var(--text-muted)' }}>불러오는 중...</div>
              ) : (
                <>
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '0.8rem' }}>
                    {detail.category} · {detail.author?.name} · {fmt(detail.createdAt)}
                    {detail.assignee && ` · 담당 ${detail.assignee.name}`}
                  </div>

                  <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', marginBottom: '1.2rem', fontSize: '0.92rem', lineHeight: 1.7 }}>
                    {detail.content || <span style={{ color: 'var(--text-muted)' }}>내용 없음</span>}
                  </div>

                  {isMasterOrAbove && (
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap', padding: '0.7rem', background: 'var(--inner-bg)', borderRadius: '6px', marginBottom: '1rem' }}>
                      <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>상태</span>
                      <select
                        value={detail.status}
                        onChange={e => patch({ id: detail.id, status: e.target.value as ImprovementStatus })}
                        disabled={busy}
                        className="input-field"
                        style={{ width: '120px', padding: '0.3rem' }}
                      >
                        {IMPROVEMENT_STATUS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                      </select>
                      <span style={{ fontSize: '0.85rem', fontWeight: 600, marginLeft: '0.5rem' }}>담당</span>
                      <select
                        value={detail.assignee?.id ?? ''}
                        onChange={e => patch({ id: detail.id, assigneeId: e.target.value ? parseInt(e.target.value, 10) : null })}
                        disabled={busy}
                        className="input-field"
                        style={{ width: '140px', padding: '0.3rem' }}
                      >
                        <option value="">지정 안 함</option>
                        {people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                    </div>
                  )}

                  <div style={{ borderTop: '1px solid var(--border)', paddingTop: '0.8rem' }}>
                    <div style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: '0.6rem' }}>
                      댓글 {detail.comments.filter(c => c.type === 'comment').length}
                    </div>
                    {detail.comments.length === 0 && (
                      <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>아직 댓글이 없습니다.</div>
                    )}
                    {detail.comments.map(c => (
                      <div key={c.id} style={{ marginBottom: '0.7rem', fontSize: '0.88rem' }}>
                        {c.type === 'comment' ? (
                          <>
                            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'baseline' }}>
                              <span style={{ fontWeight: 700 }}>{c.author?.name}</span>
                              <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>{fmt(c.createdAt)}</span>
                            </div>
                            <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{c.body}</div>
                          </>
                        ) : (
                          <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                            {c.author?.name}님이 {c.body} · {fmt(c.createdAt)}
                          </div>
                        )}
                      </div>
                    ))}

                    <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.8rem' }}>
                      <textarea
                        value={commentBody}
                        onChange={e => setCommentBody(e.target.value)}
                        placeholder={`${userName}님, 댓글을 남겨주세요`}
                        rows={2}
                        className="input-field"
                        style={{ flex: 1, fontSize: '0.88rem' }}
                      />
                      <button onClick={addComment} disabled={busy || !commentBody.trim()} className="btn btn-primary btn-sm">등록</button>
                    </div>
                  </div>
                </>
              )}
            </div>

            {detail && (detail.createdBy === userId || isMasterOrAbove) && (
              <div className="modal-footer">
                <button onClick={() => removeItem(detail.id)} className="btn btn-sm btn-danger">삭제</button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
