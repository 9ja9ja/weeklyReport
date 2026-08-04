'use client';

import { useState } from 'react';
import { PNL_METRICS, formatPnlAmount, pnlDelta, PnlCategoryInput } from '@/lib/pnlParser';

interface Props {
  category: PnlCategoryInput;
  editable: boolean;
  onChange: (next: PnlCategoryInput) => void;
  onDelete: () => void;
}

function AmountInput({ value, onCommit }: { value: number; onCommit: (n: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);

  const display = draft ?? formatPnlAmount(value);

  return (
    <input
      type="text"
      inputMode="numeric"
      value={display}
      onChange={e => {
        const raw = e.target.value;
        const isNeg = raw.trim().startsWith('-');
        const digits = raw.replace(/\D/g, '');
        const cleaned = digits === '' ? (isNeg ? '-' : '') : (isNeg ? `-${digits}` : digits);
        if (cleaned === '' || cleaned === '-') {
          setDraft(cleaned);
          onCommit(0);
          return;
        }
        const n = Number(cleaned);
        setDraft(n.toLocaleString('ko-KR'));
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
