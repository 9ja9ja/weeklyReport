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
