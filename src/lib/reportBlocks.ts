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

/**
 * 병합된 셀 한 덩어리. (r, c) 가 좌상단 기준칸이고 그 오른쪽·아래가 덮인다.
 * 덮인 칸의 값은 지우지 않고 그대로 둔다 — 병합을 풀면 원래 내용이 돌아와야 한다.
 */
export type CellMerge = { r: number; c: number; rowSpan: number; colSpan: number };

/** 문서의 통계표 (문의 대응 추이표, 운영 실적표, 진행 경과표 등) */
export type TableBlock = {
  id: string;
  type: 'table';
  /** 표 위에 붙는 제목. 문서의 "■ Pharos 고도화 진행 경과" 같은 줄 */
  caption: string;
  headers: string[];
  rows: string[][];
  authorText?: string;
  /** 없으면 병합 없음. 기존 데이터에는 이 필드가 없다 */
  merges?: CellMerge[];
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

/**
 * 행 삽입. `at` 을 주면 그 위치에 끼워 넣는다.
 *
 * 매출 정산표처럼 최신 건이 위로 쌓이는 표는 맨 아래에만 추가할 수 있으면
 * 매번 값을 아래에서 위로 옮겨 적어야 한다.
 */
export function addRow(t: TableBlock, at?: number): TableBlock {
  const blank = t.headers.map(() => '');
  const idx = at === undefined ? t.rows.length : Math.max(0, Math.min(at, t.rows.length));
  const rows = [...t.rows.slice(0, idx), blank, ...t.rows.slice(idx)];
  return { ...t, rows, merges: shiftMerges(t.merges, 'row', 'insert', idx) };
}

export function removeRow(t: TableBlock, r: number): TableBlock {
  if (t.rows.length <= 1) return t;
  return {
    ...t,
    rows: t.rows.filter((_, i) => i !== r),
    merges: shiftMerges(t.merges, 'row', 'remove', r)
  };
}

export function addColumn(t: TableBlock, at?: number): TableBlock {
  const idx = at === undefined ? t.headers.length : Math.max(0, Math.min(at, t.headers.length));
  return {
    ...t,
    headers: [...t.headers.slice(0, idx), '', ...t.headers.slice(idx)],
    rows: t.rows.map(row => [...row.slice(0, idx), '', ...row.slice(idx)]),
    merges: shiftMerges(t.merges, 'col', 'insert', idx)
  };
}

export function removeColumn(t: TableBlock, c: number): TableBlock {
  if (t.headers.length <= 1) return t;
  return {
    ...t,
    headers: t.headers.filter((_, i) => i !== c),
    rows: t.rows.map(row => row.filter((_, i) => i !== c)),
    merges: shiftMerges(t.merges, 'col', 'remove', c)
  };
}

// ── 셀 병합 ──────────────────────────────────────────────────

/**
 * 행·열이 늘거나 줄 때 병합 좌표를 따라 옮긴다.
 * 이걸 빠뜨리면 행 하나만 추가해도 병합이 엉뚱한 칸을 덮어 표가 깨진다.
 */
function shiftMerges(
  merges: CellMerge[] | undefined,
  axis: 'row' | 'col',
  op: 'insert' | 'remove',
  at: number
): CellMerge[] | undefined {
  if (!merges?.length) return merges;
  const pos = (m: CellMerge) => (axis === 'row' ? m.r : m.c);
  const span = (m: CellMerge) => (axis === 'row' ? m.rowSpan : m.colSpan);
  const withPos = (m: CellMerge, p: number, s: number): CellMerge =>
    axis === 'row' ? { ...m, r: p, rowSpan: s } : { ...m, c: p, colSpan: s };

  const out: CellMerge[] = [];
  for (const m of merges) {
    const p = pos(m);
    const s = span(m);
    if (op === 'insert') {
      if (at <= p) out.push(withPos(m, p + 1, s));            // 병합 위에 삽입 → 통째로 밀린다
      else if (at < p + s) out.push(withPos(m, p, s + 1));    // 병합 안에 삽입 → 범위가 넓어진다
      else out.push(m);
    } else {
      if (at < p) out.push(withPos(m, p - 1, s));
      else if (at < p + s) {
        // 병합 안의 줄이 사라졌다. 1칸만 남으면 병합이 아니다.
        if (s - 1 >= 2) out.push(withPos(m, p, s - 1));
      } else out.push(m);
    }
  }
  return normalizeMerges(out);
}

/** 1칸짜리(=병합 아님)와 표 밖으로 나간 것을 걸러낸다 */
function normalizeMerges(merges: CellMerge[]): CellMerge[] | undefined {
  const kept = merges.filter(m => m.rowSpan >= 1 && m.colSpan >= 1 && m.rowSpan * m.colSpan > 1);
  return kept.length ? kept : undefined;
}

/** (r,c) 를 덮고 있는 병합 (기준칸 자신 포함). 없으면 null */
export function mergeAt(t: TableBlock, r: number, c: number): CellMerge | null {
  for (const m of t.merges ?? []) {
    if (r >= m.r && r < m.r + m.rowSpan && c >= m.c && c < m.c + m.colSpan) return m;
  }
  return null;
}

/** (r,c) 가 다른 칸에 덮여 화면에 그려지지 않는 칸인지 */
export function isCovered(t: TableBlock, r: number, c: number): boolean {
  const m = mergeAt(t, r, c);
  return !!m && !(m.r === r && m.c === c);
}

/** 화면에 그릴 때 쓸 span. 병합이 없으면 1x1 */
export function spanAt(t: TableBlock, r: number, c: number): { rowSpan: number; colSpan: number } {
  const m = mergeAt(t, r, c);
  return m && m.r === r && m.c === c
    ? { rowSpan: m.rowSpan, colSpan: m.colSpan }
    : { rowSpan: 1, colSpan: 1 };
}

/**
 * 사각 범위를 하나로 합친다.
 *
 * 범위가 기존 병합과 겹치면 그 병합까지 포함하도록 넓힌다 — 반쪽만 겹친 채로 두면
 * 같은 칸을 두 병합이 덮어 렌더가 어긋난다.
 * 덮이는 칸의 값은 지우지 않는다. 병합을 풀면 그대로 돌아온다.
 */
export function mergeCells(t: TableBlock, r1: number, c1: number, r2: number, c2: number): TableBlock {
  let top = Math.min(r1, r2), bottom = Math.max(r1, r2);
  let left = Math.min(c1, c2), right = Math.max(c1, c2);
  if (top < 0 || left < 0 || bottom >= t.rows.length || right >= t.headers.length) return t;

  // 겹치는 기존 병합을 모두 삼킬 때까지 범위를 넓힌다
  const others = t.merges ?? [];
  for (let changed = true; changed; ) {
    changed = false;
    for (const m of others) {
      const overlap = m.r <= bottom && m.r + m.rowSpan - 1 >= top && m.c <= right && m.c + m.colSpan - 1 >= left;
      if (!overlap) continue;
      const nt = Math.min(top, m.r), nb = Math.max(bottom, m.r + m.rowSpan - 1);
      const nl = Math.min(left, m.c), nr = Math.max(right, m.c + m.colSpan - 1);
      if (nt !== top || nb !== bottom || nl !== left || nr !== right) {
        top = nt; bottom = nb; left = nl; right = nr;
        changed = true;
      }
    }
  }

  const rowSpan = bottom - top + 1;
  const colSpan = right - left + 1;
  if (rowSpan * colSpan <= 1) return t;

  const rest = others.filter(m =>
    !(m.r >= top && m.r + m.rowSpan - 1 <= bottom && m.c >= left && m.c + m.colSpan - 1 <= right)
  );
  return { ...t, merges: normalizeMerges([...rest, { r: top, c: left, rowSpan, colSpan }]) };
}

/** (r,c) 를 덮는 병합을 푼다 */
export function unmergeCells(t: TableBlock, r: number, c: number): TableBlock {
  const m = mergeAt(t, r, c);
  if (!m) return t;
  return { ...t, merges: normalizeMerges((t.merges ?? []).filter(x => x !== m)) };
}

// ── 붙여넣기 파싱 ─────────────────────────────────────────────

/** 붙여넣기가 일어난 자리 — 표의 칸 안인지, 제목·작성자 칸인지, 그 밖의 표 영역인지 */
export type PasteSpot = 'cell' | 'field' | 'outside';

/** 클립보드에 진짜 표가 실려 있는지 — 구글 독스·시트·엑셀·워드는 text/html 에 <table> 을 함께 준다 */
export function hasHtmlTable(html: string | null | undefined): boolean {
  return !!html && /<table[\s>]/i.test(html);
}

/**
 * 편집 중인 표를 드래그해서 복사한 클립보드인지.
 *
 * 우리 편집기의 칸은 textarea 다. 브라우저는 복사할 때 **입력칸에 친 값을 실어주지 않아**
 * (빈 <textarea> 만 남고 text/plain 은 열 구분 없는 줄 나열이 된다) 표로 되살릴 수 없다.
 * 그대로 두면 칸 하나에 전체 텍스트가 쏟아지므로, 이 신호를 보고 막아야 한다.
 * 표에 textarea 를 실어 보내는 건 우리 화면뿐이라 오탐이 없다.
 */
export function isEditingTableCopy(html: string | null | undefined): boolean {
  return hasHtmlTable(html) && /<textarea[\s>]/i.test(html!);
}

/**
 * 붙여넣기를 "표 교체"로 볼지 판단해, 표로 볼 때만 파싱할 원본을 돌려준다. (null = 표로 보지 않음)
 *
 * 표를 넣는 실제 동작은 "셀을 클릭하고 Ctrl+V" 라 커서가 셀 입력칸 안에 있다. 입력칸이라는
 * 이유로 전부 흘려보내면 표 전체 텍스트가 한 칸에 쏟아지고, 반대로 전부 표로 받으면 한 칸에
 * 여러 줄 메모를 붙여넣는 것까지 표를 갈아엎는다. 그래서 칸 안에서는 **진짜 표(<table>)일 때만**
 * 표로 받는다. 표 제목·작성자 칸은 표와 무관하므로 언제나 그 칸의 일로 둔다.
 */
export function clipboardForTablePaste(
  html: string | null | undefined,
  text: string | null | undefined,
  spot: PasteSpot
): { html: string | null; text: string | null } | null {
  if (spot === 'field') return null;
  if (spot === 'outside') return { html: html ?? null, text: text ?? null };
  return hasHtmlTable(html) ? { html: html ?? null, text: null } : null;
}

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
  lines.push(`${indent}${t.headers.map(oneLine).join('\t')}`);
  t.rows.forEach((row, r) =>
    // 덮인 칸은 빈칸으로 — 값을 반복하면 붙여넣기 했을 때 같은 값이 여러 번 들어간다
    lines.push(`${indent}${row.map((v, c) => (isCovered(t, r, c) ? '' : oneLine(v))).join('\t')}`)
  );
  return lines.join('\n') + '\n';
}

/** 탭 구분 텍스트에서는 셀 안 줄바꿈이 행 구분과 섞이므로 공백으로 눕힌다 */
function oneLine(v: string): string {
  return v.replace(/\s*\n\s*/g, ' ');
}

/** 셀 안 줄바꿈을 HTML 로 — 표에서 줄을 나눠 쓰는 경우가 많다 */
function cellHtml(v: string): string {
  return escapeHtml(v).replace(/\n/g, '<br>');
}

/** 병합된 칸의 colspan/rowspan 속성 문자열 (병합 없으면 빈 문자열) */
function spanAttrs(t: TableBlock, r: number, c: number): string {
  const { rowSpan, colSpan } = spanAt(t, r, c);
  return `${colSpan > 1 ? ` colspan="${colSpan}"` : ''}${rowSpan > 1 ? ` rowspan="${rowSpan}"` : ''}`;
}

export function tableToHtml(t: TableBlock): string {
  const cell = 'border:0.5pt solid #7f7f7f;padding:1pt 4pt;font-size:9pt;vertical-align:middle;';
  const th = `${cell}background:#f2f2f2;font-weight:bold;text-align:center;`;
  const head = t.headers.map(h => `<td style="${th}">${cellHtml(h)}</td>`).join('');
  const body = t.rows
    .map((row, r) => {
      const tds = row
        .map((v, c) => {
          if (isCovered(t, r, c)) return '';   // 다른 칸이 덮고 있다
          const attrs = spanAttrs(t, r, c);
          if (!v.trim()) return `<td style="${cell}text-align:left;"${attrs}>${cellHtml(v)}</td>`;
          // 값 없음(-)은 숫자 열의 자릿수를 흐트러뜨리지 않도록 가운데 정렬
          if (isPlaceholderCell(v)) return `<td style="${cell}text-align:center;"${attrs}>${cellHtml(v)}</td>`;
          if (!isNumericCell(v)) return `<td style="${cell}text-align:left;"${attrs}>${cellHtml(v)}</td>`;
          const color = numericCellColor(v);
          const style = `${cell}text-align:right;${color ? `color:${color};font-weight:bold;` : ''}`;
          return `<td style="${style}"${attrs}>${cellHtml(formatNumericCell(v))}</td>`;
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
