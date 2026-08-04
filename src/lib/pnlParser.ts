export interface PnlCategoryInput {
  name: string;
  v1Label: string;
  v2Label: string;
  revenueV1: number;
  revenueV2: number;
  costV1: number;
  costV2: number;
  grossProfitV1: number;
  grossProfitV2: number;
  opProfitV1: number;
  opProfitV2: number;
  note: string;
}

const BULLET_RE = /^[◾■◼□▪]/;
const METRIC_KEYS: Record<string, [keyof PnlCategoryInput, keyof PnlCategoryInput]> = {
  '매출금액': ['revenueV1', 'revenueV2'],
  '투입원가': ['costV1', 'costV2'],
  '매출이익': ['grossProfitV1', 'grossProfitV2'],
  '영업이익': ['opProfitV1', 'opProfitV2'],
};

function parseNum(raw: string | undefined): number {
  if (!raw) return 0;
  const cleaned = raw.replace(/,/g, '').trim();
  if (cleaned === '' || cleaned === '-' || cleaned === '±0') return 0;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

/**
 * 엑셀에서 복사한 손익표 범위(탭 구분 텍스트)를 파싱한다.
 * 구조: "◾카테고리명" 헤더 행 → [구분,v1라벨,v2라벨,증감] 헤더 행 →
 * 4개 지표 행(매출금액/투입원가/매출이익/영업이익, 순서 무관) → "※..." 각주 행.
 * 같은 행에 여러 카테고리가 옆으로 나란히 있어도(2열 페어) 각각 인식한다.
 * 증감 컬럼은 무시하고 v2-v1로 항상 재계산한다.
 */
export function parseExcelPnlText(text: string): PnlCategoryInput[] {
  const rows = text.replace(/\r\n/g, '\n').split('\n').map(line => line.split('\t'));
  const categories: PnlCategoryInput[] = [];

  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    for (let c = 0; c < row.length; c++) {
      const cell = (row[c] || '').trim();
      if (!BULLET_RE.test(cell)) continue;

      const name = cell.replace(BULLET_RE, '').trim();
      const headRow = rows[r + 1] || [];
      const v1Label = (headRow[c + 1] || '').trim();
      const v2Label = (headRow[c + 2] || '').trim();

      const cat: PnlCategoryInput = {
        name, v1Label, v2Label,
        revenueV1: 0, revenueV2: 0,
        costV1: 0, costV2: 0,
        grossProfitV1: 0, grossProfitV2: 0,
        opProfitV1: 0, opProfitV2: 0,
        note: '',
      };

      for (let m = 0; m < 4; m++) {
        const mrow = rows[r + 2 + m];
        if (!mrow) continue;
        const label = (mrow[c] || '').trim();
        const keys = METRIC_KEYS[label];
        if (!keys) continue;
        const [v1Key, v2Key] = keys;
        (cat[v1Key] as number) = parseNum(mrow[c + 1]);
        (cat[v2Key] as number) = parseNum(mrow[c + 2]);
      }

      const noteRow = rows[r + 6];
      if (noteRow) {
        const noteCell = (noteRow[c] || '').trim();
        if (noteCell.startsWith('※')) cat.note = noteCell;
      }

      if (name) categories.push(cat);
    }
  }

  return categories;
}

export function formatPnlAmount(n: number): string {
  return Math.round(n).toLocaleString('ko-KR');
}

export interface PnlDelta {
  text: string;
  color: 'red' | 'blue' | 'neutral';
}

/** v1→v2 증감 — 증가(빨강 △), 감소(파랑 ▽), 동일(±0) */
export function pnlDelta(v1: number, v2: number): PnlDelta {
  const diff = v2 - v1;
  if (diff === 0) return { text: '±0', color: 'neutral' };
  if (diff > 0) return { text: `△${formatPnlAmount(diff)}`, color: 'red' };
  return { text: `▽${formatPnlAmount(Math.abs(diff))}`, color: 'blue' };
}

export const PNL_METRICS: { key: 'revenue' | 'cost' | 'grossProfit' | 'opProfit'; label: string }[] = [
  { key: 'revenue', label: '매출금액' },
  { key: 'cost', label: '투입원가' },
  { key: 'grossProfit', label: '매출이익' },
  { key: 'opProfit', label: '영업이익' },
];

export function emptyPnlCategory(): PnlCategoryInput {
  return {
    name: '', v1Label: '', v2Label: '',
    revenueV1: 0, revenueV2: 0,
    costV1: 0, costV2: 0,
    grossProfitV1: 0, grossProfitV2: 0,
    opProfitV1: 0, opProfitV2: 0,
    note: '',
  };
}
