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
    w--;
    if (w < 1) { w = 52; y--; }
  }

  return weeks;
}
