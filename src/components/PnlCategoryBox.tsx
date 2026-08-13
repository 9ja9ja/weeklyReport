'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import { PNL_METRICS, formatPnlAmount, pnlDelta, PnlCategoryInput } from '@/lib/pnlParser';

interface Props {
  category: PnlCategoryInput;
  editable: boolean;
  onChange: (next: PnlCategoryInput) => void;
  onDelete: () => void;
}

/** 앞에서 n번째 숫자 바로 뒤 위치 — 콤마 자리가 밀려도 커서를 같은 숫자 옆에 둔다 */
function caretAfterDigits(text: string, count: number): number {
  if (count <= 0) return text.startsWith('-') ? 1 : 0;
  let seen = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] >= '0' && text[i] <= '9' && ++seen === count) return i + 1;
  }
  return text.length;
}

function AmountInput({ value, onCommit }: { value: number; onCommit: (n: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  /** 되돌려 놓을 커서 위치 — 재포맷으로 값이 통째로 대입되면 브라우저가 끝으로 보낸다 */
  const caret = useRef<number | null>(null);

  const display = draft ?? formatPnlAmount(value);

  // 금액 가운데를 고칠 때 커서가 맨 뒤로 튀어 숫자가 전부 뒤에 붙던 것을 막는다
  useLayoutEffect(() => {
    const pos = caret.current;
    if (pos === null || !ref.current) return;
    caret.current = null;
    ref.current.setSelectionRange(pos, pos);
  });

  return (
    <input
      ref={ref}
      type="text"
      inputMode="numeric"
      value={display}
      onChange={e => {
        const raw = e.target.value;
        // 커서 앞에 숫자가 몇 개였는지로 위치를 기억한다 (콤마는 세지 않는다)
        const sel = e.target.selectionStart ?? raw.length;
        const digitsBefore = raw.slice(0, sel).replace(/\D/g, '').length;
        const isNeg = raw.trim().startsWith('-');
        const digits = raw.replace(/\D/g, '');
        const cleaned = digits === '' ? (isNeg ? '-' : '') : (isNeg ? `-${digits}` : digits);
        if (cleaned === '' || cleaned === '-') {
          caret.current = cleaned.length;
          setDraft(cleaned);
          onCommit(0);
          return;
        }
        const n = Number(cleaned);
        const next = n.toLocaleString('ko-KR');
        caret.current = caretAfterDigits(next, digitsBefore);
        setDraft(next);
        onCommit(n);
      }}
      onBlur={() => setDraft(null)}
      className="pnl-num-input"
    />
  );
}

export default function PnlCategoryBox({ category, editable, onChange, onDelete }: Props) {
  const set = <K extends keyof PnlCategoryInput>(key: K, value: PnlCategoryInput[K]) => {
    onChange({ ...category, [key]: value });
  };

  return (
    <div className="pnl-box">
      <div className="pnl-box-header">
        {editable ? (
          <input
            value={category.name}
            onChange={e => set('name', e.target.value)}
            placeholder="카테고리명 (예: Pharos)"
            className="pnl-name-input"
          />
        ) : (
          <span className="pnl-name-label">■{category.name}</span>
        )}
        {editable && (
          <button type="button" onClick={onDelete} className="pnl-delete-btn" title="카테고리 삭제">삭제</button>
        )}
      </div>

      <table className="pnl-table">
        <thead>
          <tr>
            <th>구분</th>
            <th>
              {editable ? (
                <input value={category.v1Label} onChange={e => set('v1Label', e.target.value)} placeholder="v1 라벨" className="pnl-label-input" />
              ) : category.v1Label}
            </th>
            <th>
              {editable ? (
                <input value={category.v2Label} onChange={e => set('v2Label', e.target.value)} placeholder="v2 라벨" className="pnl-label-input" />
              ) : category.v2Label}
            </th>
            <th>증감</th>
          </tr>
        </thead>
        <tbody>
          {PNL_METRICS.map(({ key, label }) => {
            const v1 = category[`${key}V1`] as number;
            const v2 = category[`${key}V2`] as number;
            const delta = pnlDelta(v1, v2);
            return (
              <tr key={key}>
                <td className="pnl-metric-label">{label}</td>
                <td className={`pnl-amount${v1 < 0 ? ' neg' : ''}`}>
                  {editable ? (
                    <AmountInput value={v1} onCommit={n => set(`${key}V1` as keyof PnlCategoryInput, n as never)} />
                  ) : formatPnlAmount(v1)}
                </td>
                <td className={`pnl-amount${v2 < 0 ? ' neg' : ''}`}>
                  {editable ? (
                    <AmountInput value={v2} onCommit={n => set(`${key}V2` as keyof PnlCategoryInput, n as never)} />
                  ) : formatPnlAmount(v2)}
                </td>
                <td className={`pnl-delta pnl-delta-${delta.color}`}>{delta.text}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {editable ? (
        <input
          value={category.note}
          onChange={e => set('note', e.target.value)}
          placeholder="※ 각주 (선택)"
          className="pnl-note-input"
        />
      ) : (
        category.note && <p className="pnl-note">{category.note}</p>
      )}
    </div>
  );
}
