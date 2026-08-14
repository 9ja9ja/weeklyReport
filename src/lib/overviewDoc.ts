/**
 * 전체 취합본 → 기존 주간보고 문서(docx)와 동일한 양식의 HTML 생성
 *
 * 원본 구조 (6열):
 *   구분 | 분류(2열: 분류1·분류2) | N주(MM.DD. ~ MM.DD.) | N+1주(...) | 담당
 *
 * - 구분   = Team.division (Pharos / 개발 / 영업 / 마케팅 / 운영 / PMO), 구분 단위로 세로 병합
 * - 분류1  = Part, 분류2 = MajorCategory
 * - 중분류(⑴)는 별도 열이 아니라 금주/차주 셀 안에 ⑴ → ① → - 로 들어간다
 * - 담당   = 그 분류1에서 실제로 작성한 사람들 (파트 단위 세로 병합)
 */
import {
  type ContentBlock, isTableBlock, isCovered, spanAt, HEADER_ROW,
  isNumericCell, isPlaceholderCell, numericCellColor, formatNumericCell
} from './reportBlocks';
import { getNextWeek } from './weekUtils';

export interface DocCategory { id: number; middle: string; current: ContentBlock[]; next: ContentBlock[] }
export interface DocMajor { id: number; name: string; categories: DocCategory[] }
export interface DocPart { id: number; name: string; majors: DocMajor[] }
export interface DocTeam {
  id: number;
  name: string;
  division: string;
  isLocked: boolean;
  hasContent: boolean;
  parts: DocPart[];
}

const L1 = '⑴⑵⑶⑷⑸⑹⑺⑻⑼⑽⑾⑿⒀⒁⒂';
const L2 = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮';
const midMark = (i: number) => (i < L1.length ? L1[i] : `(${i + 1})`);
const subMark = (i: number) => (i < L2.length ? L2[i] : `(${i + 1})`);

const NBSP = '&nbsp;';
const indent = (n: number) => NBSP.repeat(n);

function esc(s: string): string {
  return (s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 원본 표기: 07.20. */
export function dotDate(d: Date): string {
  return `${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}.`;
}

/**
 * 표 셀의 정렬·색 — 화면(TableBlock)·클립보드(tableToHtml)와 같은 규칙을 쓴다.
 * 여기만 별도 규칙을 두면 같은 표가 Word/PDF 에서만 다르게 보인다.
 * 색은 원본 문서 관례를 지키려고 문서용 팔레트(파랑 #0070c0 / 빨강 #ff0000)로 바꿔 쓴다.
 */
function cellAlignColor(v: string): { align: 'left' | 'right' | 'center'; color: string | null } {
  if (!v.trim()) return { align: 'center', color: null };
  if (isPlaceholderCell(v)) return { align: 'center', color: null };
  if (!isNumericCell(v)) return { align: 'left', color: null };
  const c = numericCellColor(v);
  return { align: 'right', color: c === '#dc2626' ? '#ff0000' : c === '#2563eb' ? '#0070c0' : null };
}

/**
 * 원본 gridCol 비율(twips) — 구글 문서 변환기가 <colgroup> 을 무시해서
 * 모든 셀에 직접 width 를 넣어준다.
 */
const COLS = [870, 1140, 1275, 5880, 5055, 945];
const COL_TOTAL = COLS.reduce((a, b) => a + b, 0);
/** from 열부터 to 열까지(포함) 차지하는 폭 */
function W(from: number, to: number = from): string {
  let w = 0;
  for (let i = from; i <= to; i++) w += COLS[i];
  return `width:${((w / COL_TOTAL) * 100).toFixed(2)}%;`;
}

const BORDER = 'border:0.5pt solid #7f7f7f;';
const CELL = `${BORDER}padding:2pt 3pt;vertical-align:top;font-size:9pt;`;
const CELL_MID = `${BORDER}padding:2pt 3pt;vertical-align:middle;text-align:center;font-size:9pt;`;
const HEAD = `${CELL_MID}background:#f2f2f2;font-weight:bold;`;
const P = 'margin:0;font-size:9pt;line-height:1.35;';

function renderTable(t: Extract<ContentBlock, { type: 'table' }>): string {
  const c = `${BORDER}padding:1pt 4pt;font-size:8.5pt;`;
  const head = t.headers
    .map((h, ci) => {
      if (isCovered(t, HEADER_ROW, ci)) return '';   // 제목줄 가로 병합으로 덮인 칸
      const { colSpan } = spanAt(t, HEADER_ROW, ci);
      const attrs = colSpan > 1 ? ` colspan="${colSpan}"` : '';
      return `<td style="${c}text-align:center;background:#f2f2f2;font-weight:bold;"${attrs}>${esc(h).replace(/\n/g, '<br>')}</td>`;
    })
    .join('');
  const body = t.rows
    .map((row, r) => {
      const tds = row
        .map((v, ci) => {
          if (isCovered(t, r, ci)) return '';   // 병합으로 덮인 칸
          const { rowSpan, colSpan } = spanAt(t, r, ci);
          const attrs =
            `${colSpan > 1 ? ` colspan="${colSpan}"` : ''}${rowSpan > 1 ? ` rowspan="${rowSpan}"` : ''}`;
          const { align, color } = cellAlignColor(v);
          const style = `${c}text-align:${align};vertical-align:middle;${color ? `color:${color};font-weight:bold;` : ''}`;
          // 숫자는 화면과 같이 천단위 콤마를 넣어 내보낸다. 셀 안 줄바꿈은 <br> 로 살린다.
          const text = esc(isNumericCell(v) ? formatNumericCell(v) : v).replace(/\n/g, '<br>');
          return `<td style="${style}"${attrs}>${text}</td>`;
        })
        .join('');
      return `<tr>${tds}</tr>`;
    })
    .join('');
  const cap = t.caption?.trim() ? `<p style="${P}">${indent(5)}${esc(t.caption.trim())}</p>` : '';
  return `${cap}<table style="border-collapse:collapse;margin:2pt 0;width:100%;table-layout:fixed;">${`<tr>${head}</tr>`}${body}</table>`;
}

/** 한 중분류(⑴)의 본문: ① 항목 + - 불릿 + 표 */
function renderBlocks(blocks: ContentBlock[], includeAuthor: boolean): string {
  if (blocks.length === 0) {
    return `<p style="${P}">${indent(5)}${subMark(0)} 내용없음</p>`;
  }
  let seq = -1;
  return blocks
    .map(b => {
      if (isTableBlock(b)) return renderTable(b);
      seq += 1;
      const author = includeAuthor && b.authorText ? ` [${esc(b.authorText)}]` : '';
      const head = `<p style="${P}">${indent(5)}${subMark(seq)} ${esc(b.subText)}${author}</p>`;
      const bullets = b.bullets
        .map(x => `<p style="${P}">${indent(10)}- ${esc(x.text)}</p>`)
        .join('');
      return head + bullets;
    })
    .join('');
}

/** 분류2(대분류) 한 칸: ⑴ 중분류 → 내용 을 통째로 */
function renderMajorCell(
  cats: DocCategory[],
  kind: 'current' | 'next',
  includeAuthor: boolean
): string {
  const filled = cats.filter(c => c[kind].length > 0);
  if (filled.length === 0) return `<p style="${P}">별도 대응 없음</p>`;

  return filled
    .map((c, i) => {
      const title = `<p style="${P}">${midMark(i)} ${esc(c.middle)}</p>`;
      return title + renderBlocks(c[kind], includeAuthor);
    })
    .join('');
}

/** 그 파트에서 실제로 쓴 사람들 (원본의 담당 칸) */
function partAuthors(part: DocPart): string[] {
  const names = new Set<string>();
  part.majors.forEach(mj =>
    mj.categories.forEach(c =>
      [...c.current, ...c.next].forEach(b => {
        if (b.authorText) names.add(b.authorText);
      })
    )
  );
  return [...names];
}

export function buildOverviewHtml(opts: {
  teams: DocTeam[];
  year: number;
  weekNum: number;
  /** 금주 월~금 */
  range: { monday: Date; friday: Date };
  /** 차주 월~금 */
  nextRange: { monday: Date; friday: Date };
  onlyFilled?: boolean;
  includeAuthor?: boolean;
}): string {
  const { teams, year, weekNum, range, nextRange } = opts;
  const onlyFilled = opts.onlyFilled ?? true;
  const includeAuthor = opts.includeAuthor ?? true;
  const nextWeek = getNextWeek(year, weekNum).weekNum;

  const keepCat = (c: DocCategory) => !onlyFilled || c.current.length > 0 || c.next.length > 0;

  // 구분(division) 단위로 묶는다 — 원본에서 구분은 여러 팀에 걸쳐 세로 병합된다
  const divisions: { name: string; parts: { part: DocPart; majors: DocMajor[] }[] }[] = [];
  for (const team of teams) {
    if (onlyFilled && !team.hasContent) continue;
    for (const part of team.parts) {
      const majors = part.majors
        .map(mj => ({ ...mj, categories: mj.categories.filter(keepCat) }))
        .filter(mj => mj.categories.length > 0);
      if (majors.length === 0) continue;

      let div = divisions.find(d => d.name === team.division);
      if (!div) { div = { name: team.division, parts: [] }; divisions.push(div); }
      div.parts.push({ part, majors });
    }
  }

  const rows: string[] = [];
  for (const div of divisions) {
    const divRowCount = div.parts.reduce((n, p) => n + p.majors.length, 0);
    let firstOfDiv = true;

    for (const { part, majors } of div.parts) {
      const authors = partAuthors(part);
      // 분류1 = 분류2 이면 원본처럼 한 칸으로 합친다
      const merge = majors.length === 1 && majors[0].name === part.name;
      let firstOfPart = true;

      for (const major of majors) {
        const cells: string[] = [];

        if (firstOfDiv) {
          cells.push(`<td style="${CELL_MID}${W(0)}font-weight:bold;" rowspan="${divRowCount}">${esc(div.name)}</td>`);
        }
        if (firstOfPart) {
          cells.push(
            `<td style="${CELL_MID}${merge ? W(1, 2) : W(1)}" rowspan="${majors.length}"${merge ? ' colspan="2"' : ''}>${esc(part.name)}</td>`
          );
        }
        if (!merge) {
          cells.push(`<td style="${CELL_MID}${W(2)}">${esc(major.name)}</td>`);
        }
        cells.push(`<td style="${CELL}${W(3)}">${renderMajorCell(major.categories, 'current', includeAuthor)}</td>`);
        cells.push(`<td style="${CELL}${W(4)}">${renderMajorCell(major.categories, 'next', includeAuthor)}</td>`);
        if (firstOfPart) {
          const who = authors.map(n => `<p style="${P}">${esc(n)}</p>`).join('') || '&nbsp;';
          cells.push(`<td style="${CELL_MID}${W(5)}" rowspan="${majors.length}">${who}</td>`);
        }

        rows.push(`<tr>${cells.join('')}</tr>`);
        firstOfDiv = false;
        firstOfPart = false;
      }
    }
  }

  const header =
    `<td style="${HEAD}${W(0)}">구분</td>` +
    `<td style="${HEAD}${W(1, 2)}" colspan="2">분류</td>` +
    `<td style="${HEAD}${W(3)}">${weekNum}주(${dotDate(range.monday)} ~ ${dotDate(range.friday)})</td>` +
    `<td style="${HEAD}${W(4)}">${nextWeek}주(${dotDate(nextRange.monday)} ~ ${dotDate(nextRange.friday)})</td>` +
    `<td style="${HEAD}${W(5)}">담당</td>`;

  // 원본과 같은 A4 가로
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>상세본_서비스본부_주간_보고_${year}년_${weekNum}주차</title>
<style>@page { size: 29.7cm 21cm; margin: 1cm 1.5cm; }</style>
</head>
<body style="font-family:'맑은 고딕','Malgun Gothic',sans-serif;">
<p style="font-size:16pt;font-weight:bold;text-align:center;margin:0 0 6pt;">《 주간 보고 &ndash; 상세 》</p>
<p style="font-size:10pt;font-weight:bold;text-align:right;margin:0 0 3pt;">◈ 보고 주간: ${year}년${weekNum}주차(${dotDate(range.monday)}~${dotDate(range.friday)})</p>
<table style="border-collapse:collapse;width:100%;table-layout:fixed;${BORDER}">
<tr>${header}</tr>
${rows.join('\n')}
</table>
</body></html>`;
}
