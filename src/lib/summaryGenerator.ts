import { prisma } from './db';

type Bullet = { id: string; text: string };
type SubBlock = { id: string; subText: string; authorText?: string; bullets: Bullet[] };
type CateData = { current: SubBlock[]; next: SubBlock[] };
type EditorState = Record<number, CateData>;

export async function regenerateSummary(year: number, weekNum: number, teamId: number) {
  // 잠금 상태 확인
  const lock = await prisma.summaryLock.findUnique({
    where: { teamId_year_weekNum: { teamId, year, weekNum } }
  });
  if (lock?.isLocked) return;

  // 해당 팀 유저들의 리포트 조회
  const reports = await prisma.report.findMany({
    where: { year, weekNum, user: { teamId } },
    include: { user: true, items: true }
  });

  const map: EditorState = {};
  reports.forEach(report => {
    const userName = report.user.name;
    report.items.forEach(item => {
      if (!map[item.categoryId]) map[item.categoryId] = { current: [], next: [] };
      const cur: SubBlock[] = safeParseJson(item.currentContents);
      const nxt: SubBlock[] = safeParseJson(item.nextContents);
      cur.forEach(b => { map[item.categoryId].current.push({ ...b, authorText: b.authorText || userName }); });
      nxt.forEach(b => { map[item.categoryId].next.push({ ...b, authorText: b.authorText || userName }); });
    });
  });

  const contents = JSON.stringify(map);
  await prisma.summaryData.upsert({
    where: { teamId_year_weekNum: { teamId, year, weekNum } },
    update: { contents, updatedAt: new Date() },
    create: { teamId, year, weekNum, contents }
  });
}

function safeParseJson(str: string): SubBlock[] {
  try {
    const parsed = typeof str === 'string' ? JSON.parse(str) : str;
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}
