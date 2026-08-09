/**
 * 주간보고 본문 블록 타입
 *
 * ReportItem.currentContents / nextContents 는 ContentBlock[] 을 JSON 문자열로 담는다.
 * 기존 데이터는 전부 SubBlock 이고 type 필드가 없을 수 있어, 표 여부는 type === 'table' 로만 판정한다.
 */

export type Bullet = { id: string; text: string };

/** 문서의 ①②③ 항목 + 그 아래 - 불릿 */
export type SubBlock = {
  id: string;
  type?: 'sub';
  subText: string;
  authorText?: string;
  bullets: Bullet[];
};

/** 문서의 통계표 (문의 대응 추이표, 운영 실적표, 진행 경과표 등) */
export type TableBlock = {
  id: string;
  type: 'table';
  /** 표 위에 붙는 제목. 문서의 "■ Pharos 고도화 진행 경과" 같은 줄 */
  caption: string;
  headers: string[];
  rows: string[][];
  authorText?: string;
};

export type ContentBlock = SubBlock | TableBlock;

export const isTableBlock = (b: ContentBlock): b is TableBlock =>
  (b as TableBlock)?.type === 'table';

export const generateId = () => Math.random().toString(36).substring(2, 10);

export function createSubBlock(): SubBlock {
  return { id: generateId(), type: 'sub', subText: '', bullets: [] };
}

/**
 * 빈 표. 구글 독스/엑셀에서 붙여넣으면 행·열 수가 자동으로 맞춰지므로
 * 기본값은 작게 두고 시작한다.
 */
export function createTableBlock(cols = 3, rows = 3): TableBlock {
  return {
    id: generateId(),
    type: 'table',
    caption: '',
    headers: Array.from({ length: cols }, () => ''),
    rows: Array.from({ length: rows }, () => Array.from({ length: cols }, () => ''))
  };
}

// ── 표 편집 연산 (전부 불변) ──────────────────────────────────

export function setCell(t: TableBlock, r: number, c: number, v: string): TableBlock {
  const rows = t.rows.map((row, i) => (i === r ? row.map((cell, j) => (j === c ? v : cell)) : row));
  return { ...t, rows };
}

export function setHeader(t: TableBlock, c: number, v: string): TableBlock {
  return { ...t, headers: t.headers.map((h, i) => (i === c ? v : h)) };
}

export function addRow(t: TableBlock): TableBlock {
  return { ...t, rows: [...t.rows, t.headers.map(() => '')] };
}

export function removeRow(t: TableBlock, r: number): TableBlock {
  if (t.rows.length <= 1) return t;
  return { ...t, rows: t.rows.filter((_, i) => i !== r) };
}

export function addColumn(t: TableBlock): TableBlock {
  return { ...t, headers: [...t.headers, ''], rows: t.rows.map(row => [...row, '']) };
}

export function removeColumn(t: TableBlock, c: number): TableBlock {
  if (t.headers.length <= 1) return t;
  return {
    ...t,
    headers: t.headers.filter((_, i) => i !== c),
    rows: t.rows.map(row => row.filter((_, i) => i !== c))
  };
}

// ── 붙여넣기 파싱 ─────────────────────────────────────────────

/**
 * 클립보드의 표를 파싱한다.
 * 구글 독스/시트·엑셀·워드에서 복사하면 text/html 에 <table> 이,
 * text/plain 에 탭 구분 텍스트가 들어온다. HTML 을 먼저 시도한다.
 * 첫 줄을 헤더로 쓴다.
 */
export function parseClipboardTable(
  html: string | null | undefined,
  text: string | null | undefined
): { headers: string[]; rows: string[][] } | null {
  const grid = parseHtmlTable(html) ?? parseTsv(text);
  if (!grid || grid.length === 0) return null;

  // 셀이 하나뿐이면 표가 아니다 (일반 텍스트 붙여넣기)
  if (grid.length === 1 && grid[0].length <= 1) return null;

  const width = Math.max(...grid.map(r => r.length));
  const padded = grid.map(r => [...r, ...Array(width - r.length).fill('')]);
  return { headers: padded[0], rows: padded.slice(1) };
}

function parseHtmlTable(html: string | null | undefined): string[][] | null {
  if (!html || typeof window === 'undefined' || !html.includes('<t')) return null;
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const table = doc.querySelector('table');
    if (!table) return null;

    const grid: string[][] = [];
    table.querySelectorAll('tr').forEach(tr => {
      const cells: string[] = [];
      tr.querySelectorAll('th, td').forEach(td => {
        const value = (td.textContent ?? '').replace(/\s+/g, ' ').trim();
        const span = parseInt(td.getAttribute('colspan') || '1', 10);
        cells.push(value);
        for (let i = 1; i < span; i++) cells.push('');
      });
      if (cells.some(c => c !== '')) grid.push(cells);
    });
    return grid.length > 0 ? grid : null;
  } catch {
    return null;
  }
}

function parseTsv(text: string | null | undefined): string[][] | null {
  if (!text) return null;
  const lines = text.replace(/\r\n?/g, '\n').split('\n').filter(l => l.trim() !== '');
  if (lines.length === 0) return null;
  // 탭이 없으면 2칸 이상 공백을 구분자로 본다
  const useTab = lines.some(l => l.includes('\t'));
  return lines.map(l => (useTab ? l.split('\t') : l.split(/\s{2,}/)).map(c => c.trim()));
}

// ── 복사용 직렬화 ─────────────────────────────────────────────

const LEADING_SIGN_RE = /^([△▲▽▼+\-−±])\s*/;
const TRAILING_UNIT_RE = /[^\d.,]+$/;
/**
 * 회계 관례의 괄호 음수 — (1,234) / (1,234)원 / (12.5)% 처럼 짧은 단위가 붙어도 인식.
 * 단위는 공백 없는 4자 이내로 제한한다. 넓게 잡으면 "(2024)년 목표" 같은 일반 문장이
 * 음수로 오인돼 우측 정렬 + 콤마 삽입으로 원문이 손상된다.
 */
const PAREN_NUMBER_RE = /^\(\s*([\d,]+(?:\.\d+)?)\s*\)\s*([^\d.,\s]{0,4})$/;
/** 값이 없음을 뜻하는 자리표시자 — 숫자 열에서 자릿수를 맞춰야 하므로 가운데 정렬한다 */
const PLACEHOLDER_RE = /^[-−–—]{1,2}$/;

/** 앞의 기호/화살표(△▲▽▼±)와 뒤의 단위(%, 건, MM 등)를 떼어낸 숫자 핵심부만 반환 */
function numericCore(raw: string): string {
  const noLead = raw.trim().replace(LEADING_SIGN_RE, '');
  return noLead.replace(TRAILING_UNIT_RE, '');
}

/** 괄호 음수 표기면 { core, unit } 반환, 아니면 null */
function parenNumber(raw: string): { core: string; unit: string } | null {
  const m = raw.trim().match(PAREN_NUMBER_RE);
  return m ? { core: m[1], unit: m[2] ?? '' } : null;
}

/** 값 없음 자리표시자(-, --, — 등)인지 */
export function isPlaceholderCell(raw: string): boolean {
  return PLACEHOLDER_RE.test(raw.trim());
}

/** 셀이 숫자 표기(증감 기호·단위·괄호 음수 포함)인지 판정 — 아니면 일반 텍스트로 취급 */
export function isNumericCell(raw: string): boolean {
  if (isPlaceholderCell(raw)) return false; // 자리표시자는 숫자가 아니라 별도 정렬 규칙을 따른다
  if (parenNumber(raw)) return true;
  const core = numericCore(raw);
  return core !== '' && /^[\d,]+(\.\d+)?$/.test(core);
}

/**
 * 숫자 셀의 색상 — 손익보고와 같은 관례:
 * 증가(△▲ 또는 +) 빨강, 감소(▽▼ 또는 -/−) 파랑, 동일(±) 무채색
 */
export function numericCellColor(raw: string): string | null {
  if (!isNumericCell(raw)) return null;
  // 괄호 표기는 회계 관례상 음수 → 감소와 같은 파랑
  if (parenNumber(raw)) return '#2563eb';
  const m = raw.trim().match(LEADING_SIGN_RE);
  const sign = m?.[1];
  if (sign === '△' || sign === '▲' || sign === '+') return '#dc2626';
  if (sign === '▽' || sign === '▼' || sign === '-' || sign === '−') return '#2563eb';
  return null;
}

/** 숫자 셀을 천단위 콤마로 재포맷 (기호·단위는 그대로 유지). 숫자가 아니면 원문 반환 */
export function formatNumericCell(raw: string): string {
  const s = raw.trim();

  // 괄호 음수는 괄호를 유지한 채 안쪽 숫자만 천단위 콤마를 넣는다 — (1234)원 → (1,234)원
  const paren = parenNumber(s);
  if (paren) {
    const formatted = withThousands(paren.core);
    return formatted === null ? raw : `(${formatted})${paren.unit}`;
  }

  const leadMatch = s.match(LEADING_SIGN_RE);
  const prefix = leadMatch ? leadMatch[0] : '';
  const rest = s.slice(prefix.length);
  const suffixMatch = rest.match(TRAILING_UNIT_RE);
  const suffix = suffixMatch ? suffixMatch[0] : '';
  const core = suffix ? rest.slice(0, rest.length - suffix.length) : rest;

  const formatted = withThousands(core);
  if (formatted === null) return raw;
  return prefix + formatted + suffix;
}

/** 숫자 핵심부에 천단위 콤마를 넣는다 (소수 자릿수 보존). 숫자 형태가 아니면 null */
function withThousands(core: string): string | null {
  if (core === '' || !/^[\d,]+(\.\d+)?$/.test(core)) return null;
  const num = Number(core.replace(/,/g, ''));
  if (!Number.isFinite(num)) return null;
  const decimals = core.includes('.') ? core.split('.')[1].length : 0;
  return num.toLocaleString('ko-KR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export function tableToText(t: TableBlock, indent = '     '): string {
  const lines: string[] = [];
  if (t.caption.trim()) lines.push(`${indent}${t.caption.trim()}`);
  lines.push(`${indent}${t.headers.join('\t')}`);
  t.rows.forEach(row => lines.push(`${indent}${row.join('\t')}`));
  return lines.join('\n') + '\n';
}

export function tableToHtml(t: TableBlock): string {
  const cell = 'border:0.5pt solid #7f7f7f;padding:1pt 4pt;font-size:9pt;';
  const th = `${cell}background:#f2f2f2;font-weight:bold;text-align:center;`;
  const head = t.headers.map(h => `<td style="${th}">${escapeHtml(h)}</td>`).join('');
  const body = t.rows
    .map(row => {
      const tds = row
        .map(v => {
          if (!v.trim()) return `<td style="${cell}text-align:left;">${escapeHtml(v)}</td>`;
          // 값 없음(-)은 숫자 열의 자릿수를 흐트러뜨리지 않도록 가운데 정렬
          if (isPlaceholderCell(v)) return `<td style="${cell}text-align:center;">${escapeHtml(v)}</td>`;
          if (!isNumericCell(v)) return `<td style="${cell}text-align:left;">${escapeHtml(v)}</td>`;
          const color = numericCellColor(v);
          const style = `${cell}text-align:right;${color ? `color:${color};font-weight:bold;` : ''}`;
          return `<td style="${style}">${escapeHtml(formatNumericCell(v))}</td>`;
        })
        .join('');
      return `<tr>${tds}</tr>`;
    })
    .join('');
  const caption = t.caption.trim()
    ? `<div style="font-size:9pt;">${escapeHtml(t.caption.trim())}</div>`
    : '';
  return `${caption}<table style="border-collapse:collapse;margin:2pt 0;"><tr>${head}</tr>${body}</table>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
