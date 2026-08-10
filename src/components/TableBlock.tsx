'use client';

import { useState, useLayoutEffect, useRef } from 'react';
import {
  TableBlock,
  setCell,
  setHeader,
  addRow,
  removeRow,
  addColumn,
  removeColumn,
  mergeCells,
  unmergeCells,
  mergeAt,
  isCovered,
  spanAt,
  parseClipboardTable,
  isNumericCell,
  isPlaceholderCell,
  numericCellColor,
  formatNumericCell
} from '@/lib/reportBlocks';

const cellBase: React.CSSProperties = {
  border: '1px solid var(--border)',
  padding: 0,
  minWidth: '60px',
  verticalAlign: 'middle'
};

const inputBase: React.CSSProperties = {
  width: '100%',
  border: 'none',
  background: 'transparent',
  padding: '0.25rem 0.4rem',
  fontSize: '0.82rem',
  textAlign: 'center',
  color: 'inherit',
  fontFamily: 'inherit',
  // 셀 안에서 줄을 나눠 쓰는 표가 많다. textarea 라 Enter 가 줄바꿈이 된다.
  resize: 'none',
  overflow: 'hidden',
  lineHeight: 1.4,
  display: 'block'
};

/**
 * 내용에 맞춰 높이가 늘어나는 셀 입력칸.
 *
 * 한 줄짜리 input 이면 긴 텍스트가 잘려 보이고 줄바꿈도 못 넣는다.
 * scrollHeight 로 매번 높이를 다시 잡아야 지우거나 붙여넣어도 정확히 맞는다.
 */
function CellInput({
  value, onChange, style, ...rest
}: {
  value: string;
  onChange: (v: string) => void;
  style?: React.CSSProperties;
} & Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange' | 'style'>) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  return (
    <textarea
      ref={ref}
      rows={1}
      value={value}
      onChange={e => onChange(e.target.value)}
      style={{ ...inputBase, ...style }}
      {...rest}
    />
  );
}

/** 숫자 셀(증감 기호·괄호 음수 포함)은 우측 정렬 + 색상, 값 없음(-)은 가운데, 텍스트는 좌측 */
function cellStyle(v: string): React.CSSProperties {
  if (!v.trim()) return {};
  if (isPlaceholderCell(v)) return { textAlign: 'center', color: 'var(--text-muted)' };
  if (!isNumericCell(v)) return { textAlign: 'left' };
  const color = numericCellColor(v);
  return { textAlign: 'right', fontVariantNumeric: 'tabular-nums', ...(color ? { color, fontWeight: 700 } : {}) };
}

interface EditorProps {
  block: TableBlock;
  onChange: (next: TableBlock) => void;
  onRemove: () => void;
  /** 취합본에서 작성자 표기를 편집할 때 */
  onAuthorChange?: (v: string) => void;
}

/** 병합할 범위 — 시작칸과 끝칸 */
interface CellRange { r1: number; c1: number; r2: number; c2: number }

const inRange = (sel: CellRange | null, r: number, c: number) =>
  !!sel && r >= Math.min(sel.r1, sel.r2) && r <= Math.max(sel.r1, sel.r2)
        && c >= Math.min(sel.c1, sel.c2) && c <= Math.max(sel.c1, sel.c2);

export function TableBlockEditor({ block, onChange, onRemove, onAuthorChange }: EditorProps) {
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  /** 셀 병합 대상. 셀을 누르면 시작점, Shift+클릭으로 끝점을 잡는다 */
  const [sel, setSel] = useState<CellRange | null>(null);

  const selSpansMany = !!sel && (sel.r1 !== sel.r2 || sel.c1 !== sel.c2);
  const selMerge = sel ? mergeAt(block, sel.r1, sel.c1) : null;

  const pickCell = (e: React.MouseEvent, r: number, c: number) => {
    if (e.shiftKey) {
      // Shift+클릭은 범위 지정이다. 막지 않으면 브라우저가 글자 선택을 해버린다.
      e.preventDefault();
      setSel(prev => (prev ? { ...prev, r2: r, c2: c } : { r1: r, c1: c, r2: r, c2: c }));
    } else {
      setSel({ r1: r, c1: c, r2: r, c2: c });
    }
  };

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
                  <CellInput
                    value={h}
                    onChange={v => onChange(setHeader(block, c, v))}
                    placeholder={`열${c + 1}`}
                    style={{ fontWeight: 700 }}
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
                {row.map((v, c) => {
                  if (isCovered(block, r, c)) return null;   // 다른 칸이 덮고 있다
                  const { rowSpan, colSpan } = spanAt(block, r, c);
                  const picked = inRange(sel, r, c);
                  return (
                    <td
                      key={c}
                      rowSpan={rowSpan}
                      colSpan={colSpan}
                      onMouseDown={e => pickCell(e, r, c)}
                      style={{
                        ...cellBase,
                        ...(picked ? { outline: '2px solid var(--primary)', outlineOffset: '-2px' } : {}),
                        ...(rowSpan > 1 || colSpan > 1 ? { background: 'var(--primary-alpha-subtle)' } : {})
                      }}
                    >
                      <CellInput
                        value={v}
                        onChange={nv => onChange(setCell(block, r, c, nv))}
                        onFocus={() => setSel(prev => (inRange(prev, r, c) ? prev : { r1: r, c1: c, r2: r, c2: c }))}
                        style={cellStyle(v)}
                      />
                    </td>
                  );
                })}
                <td style={{ border: 'none', textAlign: 'center', whiteSpace: 'nowrap' }}>
                  <button
                    onClick={() => onChange(addRow(block, r))}
                    title="이 행 위에 추가"
                    style={{
                      border: 'none', background: 'none', color: 'var(--primary)',
                      cursor: 'pointer', fontSize: '0.7rem', padding: '0 0.15rem'
                    }}
                  >
                    ↑+
                  </button>
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
        {/* 매출 정산표처럼 최신 건이 위로 쌓이는 표가 있어 삽입 위치를 고를 수 있게 둔다 */}
        <button onClick={() => onChange(addRow(block, 0))} className="btn" style={{ fontSize: '0.7rem', padding: '0.15rem 0.5rem' }}>+ 행(위)</button>
        <button onClick={() => onChange(addRow(block))} className="btn" style={{ fontSize: '0.7rem', padding: '0.15rem 0.5rem' }}>+ 행(아래)</button>
        <button onClick={() => onChange(addColumn(block))} className="btn" style={{ fontSize: '0.7rem', padding: '0.15rem 0.5rem' }}>+ 열</button>
        <button
          onClick={() => sel && onChange(mergeCells(block, sel.r1, sel.c1, sel.r2, sel.c2))}
          disabled={!selSpansMany}
          className="btn"
          title="셀을 누르고 Shift+클릭으로 범위를 잡은 뒤 누르세요"
          style={{ fontSize: '0.7rem', padding: '0.15rem 0.5rem', opacity: selSpansMany ? 1 : 0.45 }}
        >
          셀 병합
        </button>
        <button
          onClick={() => sel && onChange(unmergeCells(block, sel.r1, sel.c1))}
          disabled={!selMerge}
          className="btn"
          style={{ fontSize: '0.7rem', padding: '0.15rem 0.5rem', opacity: selMerge ? 1 : 0.45 }}
        >
          병합 해제
        </button>
        <button
          onClick={() => { setPasteText(''); setPasteOpen(v => !v); }}
          className="btn"
          style={{ fontSize: '0.7rem', padding: '0.15rem 0.5rem', color: 'var(--primary)', borderColor: 'var(--primary)' }}
        >
          표 붙여넣기
        </button>
        <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
          셀 안에서 Enter 로 줄바꿈 · 셀 클릭 후 Shift+클릭으로 범위를 잡아 병합 ·
          구글 독스·엑셀 표를 복사해 이 영역에 Ctrl+V 하면 제목줄까지 그대로 들어옵니다.
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
                    // 셀 안 줄바꿈을 살리되 자동 줄바꿈은 막는다
                    whiteSpace: 'pre',
                    textAlign: 'center',
                    verticalAlign: 'middle'
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
                {row.map((v, c) => {
                  if (isCovered(block, r, c)) return null;
                  const { rowSpan, colSpan } = spanAt(block, r, c);
                  return (
                    <td
                      key={c}
                      rowSpan={rowSpan}
                      colSpan={colSpan}
                      style={{
                        border: '1px solid var(--border)',
                        padding: '0.2rem 0.5rem',
                        textAlign: 'center',
                        whiteSpace: 'pre',
                        verticalAlign: 'middle',
                        ...cellStyle(v)
                      }}
                    >
                      {isNumericCell(v) ? formatNumericCell(v) : v}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
