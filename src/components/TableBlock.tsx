'use client';

import { useState } from 'react';
import {
  TableBlock,
  setCell,
  setHeader,
  addRow,
  removeRow,
  addColumn,
  removeColumn,
  parseClipboardTable
} from '@/lib/reportBlocks';

const cellBase: React.CSSProperties = {
  border: '1px solid var(--border)',
  padding: 0,
  minWidth: '60px'
};

const inputBase: React.CSSProperties = {
  width: '100%',
  border: 'none',
  background: 'transparent',
  padding: '0.25rem 0.4rem',
  fontSize: '0.82rem',
  textAlign: 'center',
  color: 'inherit',
  fontFamily: 'inherit'
};

/** 증감 표기(-2 / +4)를 문서와 같은 색으로 */
function deltaStyle(v: string): React.CSSProperties {
  const s = v.trim();
  if (/^[-−]\d/.test(s)) return { color: '#2563eb', fontWeight: 600 };
  if (/^\+\d/.test(s)) return { color: '#dc2626', fontWeight: 600 };
  return {};
}

interface EditorProps {
  block: TableBlock;
  onChange: (next: TableBlock) => void;
  onRemove: () => void;
  /** 취합본에서 작성자 표기를 편집할 때 */
  onAuthorChange?: (v: string) => void;
}

export function TableBlockEditor({ block, onChange, onRemove, onAuthorChange }: EditorProps) {
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');

  /** 구글 독스/시트·엑셀에서 복사한 표를 통째로 받아 넣는다 */
  const applyClipboard = (html: string | null, text: string | null) => {
    const parsed = parseClipboardTable(html, text);
    if (!parsed) return false;
    onChange({ ...block, headers: parsed.headers, rows: parsed.rows });
    return true;
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const html = e.clipboardData.getData('text/html');
    const text = e.clipboardData.getData('text/plain');
    if (applyClipboard(html, text)) e.preventDefault();
  };

  return (
    <div
      onPaste={handlePaste}
      style={{
        border: '1px solid var(--border)',
        borderLeft: '3px solid var(--primary)',
        borderRadius: '4px',
        padding: '0.5rem',
        marginBottom: '0.5rem',
        background: 'var(--surface-dim)'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', marginBottom: '0.4rem' }}>
        <span
          style={{
            fontSize: '0.62rem',
            fontWeight: 700,
            color: 'white',
            background: 'var(--primary)',
            borderRadius: '3px',
            padding: '0.1rem 0.35rem',
            flexShrink: 0
          }}
        >
          표
        </span>
        <input
          value={block.caption}
          onChange={e => onChange({ ...block, caption: e.target.value })}
          placeholder="표 제목 (예: 문의 대응)"
          className="input-field"
          style={{
            flex: 1,
            fontSize: '0.82rem',
            fontWeight: 600,
            padding: '0.2rem 0.3rem',
            border: 'none',
            borderBottom: '1px solid var(--border)',
            background: 'transparent'
          }}
        />
        {onAuthorChange && (
          <>
            <span style={{ color: 'var(--primary)', fontWeight: 700, flexShrink: 0 }}>[</span>
            <input
              value={block.authorText || ''}
              onChange={e => onAuthorChange(e.target.value)}
              className="input-field"
              style={{
                width: '58px',
                padding: '0.15rem 0.1rem',
                background: 'transparent',
                border: 'none',
                borderBottom: '1px solid var(--primary)',
                color: 'var(--primary)',
                fontWeight: 600,
                textAlign: 'center',
                fontSize: '0.8rem'
              }}
            />
            <span style={{ color: 'var(--primary)', fontWeight: 700, flexShrink: 0 }}>]</span>
          </>
        )}
        <button onClick={onRemove} className="icon-btn del" title="표 삭제" style={{ fontSize: '0.8rem' }}>
          ✕
        </button>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead>
            <tr>
              {block.headers.map((h, c) => (
                <th key={c} style={{ ...cellBase, background: 'var(--btn-bg)', position: 'relative' }}>
                  <input
                    value={h}
                    onChange={e => onChange(setHeader(block, c, e.target.value))}
                    placeholder={`열${c + 1}`}
                    style={{ ...inputBase, fontWeight: 700 }}
                  />
                  {block.headers.length > 1 && (
                    <button
                      onClick={() => onChange(removeColumn(block, c))}
                      title="열 삭제"
                      style={{
                        position: 'absolute',
                        top: '-7px',
                        right: '-4px',
                        width: '15px',
                        height: '15px',
                        lineHeight: '13px',
                        borderRadius: '50%',
                        border: '1px solid var(--border)',
                        background: 'var(--background)',
                        color: '#dc2626',
                        fontSize: '0.6rem',
                        cursor: 'pointer',
                        padding: 0
                      }}
                    >
                      ✕
                    </button>
                  )}
                </th>
              ))}
              <th style={{ border: 'none', width: '24px' }} />
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, r) => (
              <tr key={r}>
                {row.map((v, c) => (
                  <td key={c} style={cellBase}>
                    <input
                      value={v}
                      onChange={e => onChange(setCell(block, r, c, e.target.value))}
                      style={{ ...inputBase, ...deltaStyle(v) }}
                    />
                  </td>
                ))}
                <td style={{ border: 'none', textAlign: 'center' }}>
                  {block.rows.length > 1 && (
                    <button
                      onClick={() => onChange(removeRow(block, r))}
                      title="행 삭제"
                      style={{
                        border: 'none',
                        background: 'none',
                        color: '#dc2626',
                        cursor: 'pointer',
                        fontSize: '0.7rem',
                        padding: '0 0.2rem'
                      }}
                    >
                      ✕
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <button onClick={() => onChange(addRow(block))} className="btn" style={{ fontSize: '0.7rem', padding: '0.15rem 0.5rem' }}>+ 행</button>
        <button onClick={() => onChange(addColumn(block))} className="btn" style={{ fontSize: '0.7rem', padding: '0.15rem 0.5rem' }}>+ 열</button>
        <button
          onClick={() => { setPasteText(''); setPasteOpen(v => !v); }}
          className="btn"
          style={{ fontSize: '0.7rem', padding: '0.15rem 0.5rem', color: 'var(--primary)', borderColor: 'var(--primary)' }}
        >
          표 붙여넣기
        </button>
        <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
          구글 독스·엑셀에서 표를 복사해 이 영역에 Ctrl+V 하면 제목줄까지 그대로 들어옵니다.
        </span>
      </div>

      {pasteOpen && (
        <div style={{ marginTop: '0.5rem', padding: '0.6rem', border: '1px dashed var(--primary)', borderRadius: '4px' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: '0.35rem' }}>
            표를 복사해 아래에 붙여넣으세요. 첫 줄이 제목줄이 됩니다.
          </div>
          <textarea
            value={pasteText}
            onChange={e => setPasteText(e.target.value)}
            onPaste={e => {
              const html = e.clipboardData.getData('text/html');
              const text = e.clipboardData.getData('text/plain');
              if (applyClipboard(html, text)) {
                e.preventDefault();
                setPasteOpen(false);
              }
            }}
            placeholder={'구분\t오류 대응\t전주 대비\n26년30주\t2\t-4'}
            rows={3}
            className="input-field"
            style={{ width: '100%', fontSize: '0.78rem', fontFamily: 'ui-monospace, Menlo, monospace' }}
          />
          <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.4rem' }}>
            <button
              onClick={() => {
                if (applyClipboard(null, pasteText)) setPasteOpen(false);
                else alert('표 형태를 인식하지 못했습니다. 탭으로 열이 구분된 내용을 붙여넣어 주세요.');
              }}
              className="btn"
              style={{ fontSize: '0.7rem', padding: '0.15rem 0.6rem', background: 'var(--primary)', color: 'white' }}
            >
              적용
            </button>
            <button onClick={() => setPasteOpen(false)} className="btn" style={{ fontSize: '0.7rem', padding: '0.15rem 0.6rem' }}>취소</button>
          </div>
        </div>
      )}
    </div>
  );
}

/** 읽기 전용 표 (지난 주 작성본, 잠금 상태 취합본) */
export function TableBlockView({ block }: { block: TableBlock }) {
  return (
    <div style={{ marginBottom: '0.5rem' }}>
      {(block.caption.trim() || block.authorText) && (
        <div style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.2rem' }}>
          {block.caption.trim()}
          {block.authorText && (
            <span style={{ color: 'var(--primary)', fontWeight: 700, marginLeft: '0.3rem' }}>
              [{block.authorText}]
            </span>
          )}
        </div>
      )}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', fontSize: '0.8rem' }}>
          <thead>
            <tr>
              {block.headers.map((h, c) => (
                <th
                  key={c}
                  style={{
                    border: '1px solid var(--border)',
                    background: 'var(--surface-dim)',
                    padding: '0.2rem 0.5rem',
                    fontWeight: 700,
                    whiteSpace: 'nowrap'
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, r) => (
              <tr key={r}>
                {row.map((v, c) => (
                  <td
                    key={c}
                    style={{
                      border: '1px solid var(--border)',
                      padding: '0.2rem 0.5rem',
                      textAlign: 'center',
                      whiteSpace: 'nowrap',
                      ...deltaStyle(v)
                    }}
                  >
                    {v}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
