export function getWeekNumber(d: Date): number {
  d = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

export function getWeekRange(year: number, weekNum: number): { monday: Date; friday: Date } {
  // ISO week: week 1 contains Jan 4th
  const jan4 = new Date(year, 0, 4);
  const dayOfWeek = jan4.getDay() || 7;
  const monday = new Date(jan4);
  monday.setDate(jan4.getDate() - dayOfWeek + 1 + (weekNum - 1) * 7);
  const friday = new Date(monday);
  friday.setDate(monday.getDate() + 4);
  return { monday, friday };
}

/** 해당 연도의 마지막 ISO 주차 (52 또는 53) — 12/28 은 항상 그 해 마지막 ISO 주에 속한다 */
export function getLastWeekOfYear(year: number): number {
  return getWeekNumber(new Date(year, 11, 28));
}

/** 직전 주차 — 1주차면 전년도 마지막 주(52/53)로 넘어간다 */
export function getPrevWeek(year: number, weekNum: number): { year: number; weekNum: number } {
  if (weekNum > 1) return { year, weekNum: weekNum - 1 };
  return { year: year - 1, weekNum: getLastWeekOfYear(year - 1) };
}

/** 다음 주차 — 그 해 마지막 주차면 다음 해 1주차로 넘어간다 */
export function getNextWeek(year: number, weekNum: number): { year: number; weekNum: number } {
  if (weekNum < getLastWeekOfYear(year)) return { year, weekNum: weekNum + 1 };
  return { year: year + 1, weekNum: 1 };
}

/**
 * 그 날짜가 속한 ISO 주차와 **그 주의 해**.
 *
 * 연초·연말에는 달력 연도와 주차의 해가 다르다 — 2027-01-01(금)은 2026년 53주차에 속한다.
 * `now.getFullYear()` 와 주차를 그냥 짝지으면 그 며칠 동안 존재하지 않는 주차를 조회한다.
 */
export function getIsoWeek(d: Date): { year: number; weekNum: number } {
  const weekNum = getWeekNumber(d);
  const month = d.getMonth();
  let year = d.getFullYear();
  if (month === 11 && weekNum === 1) year += 1;        // 12월 말인데 1주차 → 다음 해 1주차
  else if (month === 0 && weekNum >= 52) year -= 1;    // 1월 초인데 52/53주차 → 전년도 마지막 주
  return { year, weekNum };
}

/**
 * 화면을 열었을 때 기본으로 조회할 주차 — **월·화는 지난주, 수~일은 이번주**.
 *
 * 한 주가 끝난 뒤 월·화에 그 주 보고를 마무리하고 취합·요약한다. 그때 화면이 이번 주로 열리면
 * 매번 한 주 뒤로 돌려놓고 봐야 한다. 수요일부터는 이번 주 내용을 쓰기 시작하므로 이번 주로 연다.
 */
export function getDefaultWeek(now: Date = new Date()): { year: number; weekNum: number } {
  const cur = getIsoWeek(now);
  const day = now.getDay();                            // 0=일, 1=월, 2=화
  return day === 1 || day === 2 ? getPrevWeek(cur.year, cur.weekNum) : cur;
}

export function formatDateShort(d: Date): string {
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export function getRecentWeeks(count: number): { year: number; weekNum: number }[] {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentWeek = getWeekNumber(now);

  const weeks: { year: number; weekNum: number }[] = [];
  let y = currentYear;
  let w = currentWeek;

  for (let i = 0; i < count; i++) {
    weeks.push({ year: y, weekNum: w });
    const prev = getPrevWeek(y, w);
    y = prev.year;
    w = prev.weekNum;
  }

  return weeks;
}
