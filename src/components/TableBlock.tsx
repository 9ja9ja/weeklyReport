'use client';

import { useState, useLayoutEffect, useRef } from 'react';
import PeerField from './PeerField';
import type { DocPeer } from './useSharedDoc';
import type { BlockPresence } from './usePresence';
import { PART } from './usePresence';
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

const NO_PEERS: DocPeer[] = [];

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
  value, onChange, style, peers = NO_PEERS, ...rest
}: {
  value: string;
  onChange: (v: string) => void;
  style?: React.CSSProperties;
  /** 지금 이 칸을 쓰고 있는 다른 사람들 */
  peers?: DocPeer[];
} & Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange' | 'style'>) {
  const ref = useRef<HTMLTextAreaElement>(null);
  // 한글 조합 중에는 바깥에서 온 값으로 되쓰지 않는다 — 조합이 깨져 글자가 튄다.
  const composing = useRef(false);
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? value;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [shown]);

  return (
    <PeerField peers={peers}>
      <textarea
        ref={ref}
        rows={1}
        value={shown}
        onCompositionStart={() => { composing.current = true; }}
        onCompositionEnd={e => {
          composing.current = false;
          setDraft(null);
          onChange((e.target as HTMLTextAreaElement).value);
        }}
        onChange={e => {
          const v = e.target.value;
          if (composing.current) { setDraft(v); return; }
          setDraft(null);
          onChange(v);
        }}
        style={{ ...inputBase, ...style }}
        {...rest}
      />
    </PeerField>
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

/**
 * 표 편집 연산.
 *
 * 공동 편집에서는 표를 통째로 교체하면 안 된다 — 같은 순간 남이 고친 칸까지 되돌려버린다.
 * 그래서 동작마다 세분된 연산을 받는다. 주지 않으면(개인 작성) onChange 로 통째 교체한다.
 */
export interface TableOps {
  setCaption(v: string): void;
  setHeader(c: number, v: string): void;
  setCell(r: number, c: number, v: string): void;
  /** at 을 주면 그 행 위에, 없으면 맨 아래 */
  addRow(at?: number): void;
  removeRow(r: number): void;
  addColumn(): void;
  removeColumn(c: number): void;
  merge(r1: number, c1: number, r2: number, c2: number): void;
  unmerge(r: number, c: number): void;
  /** 표 붙여넣기 — 내용을 통째로 갈아엎는다 */
  replaceAll(headers: string[], rows: string[][]): void;
}

interface EditorProps {
  block: TableBlock;
  onChange: (next: TableBlock) => void;
  onRemove: () => void;
  /** 취합본에서 작성자 표기를 편집할 때 */
  onAuthorChange?: (v: string) => void;
  /** 공동 편집일 때만 준다. 있으면 onChange 대신 이쪽으로 나간다 */
  ops?: TableOps;
  /** 공동 편집일 때만 준다 — 누가 어느 칸에 있는지 표시한다 */
  presence?: BlockPresence;
}

/** 병합할 범위 — 시작칸과 끝칸 */
interface CellRange { r1: number; c1: number; r2: number; c2: number }

const inRange = (sel: CellRange | null, r: number, c: number) =>
  !!sel && r >= Math.min(sel.r1, sel.r2) && r <= Math.max(sel.r1, sel.r2)
        && c >= Math.min(sel.c1, sel.c2) && c <= Math.max(sel.c1, sel.c2);

export function TableBlockEditor({ block, onChange, onRemove, onAuthorChange, ops, presence }: EditorProps) {
  /** 공동 편집이 아니면 아무것도 표시하지 않는다 */
  const peersAt = (part: string) => presence?.peers(part) ?? NO_PEERS;
  const focusAt = (part: string) => presence?.focusProps(part);
  /** 연산이 주어지면 그쪽으로, 아니면 기존처럼 통째 교체 */
  const op: TableOps = ops ?? {
    setCaption: v => onChange({ ...block, caption: v }),
    setHeader: (c, v) => onChange(setHeader(block, c, v)),
    setCell: (r, c, v) => onChange(setCell(block, r, c, v)),
    addRow: at => onChange(addRow(block, at)),
    removeRow: r => onChange(removeRow(block, r)),
    addColumn: () => onChange(addColumn(block)),
    removeColumn: c => onChange(removeColumn(block, c)),
    merge: (r1, c1, r2, c2) => onChange(mergeCells(block, r1, c1, r2, c2)),
    unmerge: (r, c) => onChange(unmergeCells(block, r, c)),
    replaceAll: (headers, rows) => onChange({ ...block, headers, rows, merges: undefined })
  };
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
    // 공동 편집 중에는 남이 쓰던 표를 통째로 갈아엎는 동작이라 한 번 묻는다
    if (ops && (block.rows.some(r => r.some(v => v.trim())) || block.headers.some(h => h.trim()))) {
      if (!confirm('표 내용을 붙여넣은 것으로 모두 바꿉니다. 다른 팀원이 작성한 내용도 함께 사라집니다. 계속할까요?')) {
        return true;
      }
    }
    op.replaceAll(parsed.headers, parsed.rows);
    return true;
  };

  /**
   * 표 붙여넣기.
   *
   * 셀 안에 여러 줄 텍스트를 붙여넣는 것까지 "표"로 오인해 통째로 갈아엎던 문제가 있었다.
   * 셀·제목 입력칸 안에서의 붙여넣기는 그 칸의 일이므로 건드리지 않고,
   * 표 바깥 영역에 붙여넣었을 때만 표 교체로 본다.
   */
  const handlePaste = (e: React.ClipboardEvent) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT')) return;
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
        <PeerField peers={peersAt(PART.caption)} style={{ flex: 1, minWidth: 0 }}>
          <input
            value={block.caption}
            onChange={e => op.setCaption(e.target.value)}
            {...focusAt(PART.caption)}
            placeholder="표 제목 (예: 문의 대응)"
            className="input-field"
            style={{
              width: '100%',
              fontSize: '0.82rem',
              fontWeight: 600,
              padding: '0.2rem 0.3rem',
              border: 'none',
              borderBottom: '1px solid var(--border)',
              background: 'transparent'
            }}
          />
        </PeerField>
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

      <div className="table-scroll" style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead>
            <tr>
              {block.headers.map((h, c) => (
                <th key={c} style={{ ...cellBase, background: 'var(--btn-bg)', position: 'relative' }}>
                  <CellInput
                    value={h}
                    onChange={v => op.setHeader(c, v)}
                    peers={peersAt(PART.header(c))}
                    {...focusAt(PART.header(c))}
                    placeholder={`열${c + 1}`}
                    style={{ fontWeight: 700 }}
                  />
                  {block.headers.length > 1 && (
                    <button
                      onClick={() => op.removeColumn(c)}
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
                        onChange={nv => op.setCell(r, c, nv)}
                        peers={peersAt(PART.cell(r, c))}
                        onFocus={() => {
                          setSel(prev => (inRange(prev, r, c) ? prev : { r1: r, c1: c, r2: r, c2: c }));
                          focusAt(PART.cell(r, c))?.onFocus();
                        }}
                        onBlur={() => focusAt(PART.cell(r, c))?.onBlur()}
                        style={cellStyle(v)}
                      />
                    </td>
                  );
                })}
                <td style={{ border: 'none', textAlign: 'center', whiteSpace: 'nowrap' }}>
                  <button
                    onClick={() => op.addRow(r)}
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
                      onClick={() => op.removeRow(r)}
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
        <button onClick={() => op.addRow(0)} className="btn" style={{ fontSize: '0.7rem', padding: '0.15rem 0.5rem' }}>+ 행(위)</button>
        <button onClick={() => op.addRow()} className="btn" style={{ fontSize: '0.7rem', padding: '0.15rem 0.5rem' }}>+ 행(아래)</button>
        <button onClick={() => op.addColumn()} className="btn" style={{ fontSize: '0.7rem', padding: '0.15rem 0.5rem' }}>+ 열</button>
        <button
          onClick={() => sel && op.merge(sel.r1, sel.c1, sel.r2, sel.c2)}
          disabled={!selSpansMany}
          className="btn"
          title="셀을 누르고 Shift+클릭으로 범위를 잡은 뒤 누르세요"
          style={{ fontSize: '0.7rem', padding: '0.15rem 0.5rem', opacity: selSpansMany ? 1 : 0.45 }}
        >
          셀 병합
        </button>
        <button
          onClick={() => sel && op.unmerge(sel.r1, sel.c1)}
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
