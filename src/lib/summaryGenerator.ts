import { prisma } from './db';
import { isCollabWeek } from './realtime/persist';

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

  // 공동 편집 주차는 취합본이 공유 문서의 미러다.
  // 개인 Report 로 다시 만들면 팀이 함께 작성한 내용을 통째로 덮어쓴다.
  // 호출부(/api/reports POST)에서도 막지만, 이 함수 자체가 파괴적이라 여기서 한 번 더 끊는다.
  const team = await prisma.team.findUnique({
    where: { id: teamId },
    select: {
      collabFromYear: true, collabFromWeek: true,
      collabUntilYear: true, collabUntilWeek: true
    }
  });
  if (team && isCollabWeek(team, year, weekNum)) return;

  // 겸직 지원: 작성자 소속이 아니라 "항목이 속한 팀" 기준으로 취합한다.
  const reports = await prisma.report.findMany({
    where: { year, weekNum, items: { some: { category: { teamId } } } },
    include: {
      user: true,
      items: { where: { category: { teamId } } }
    }
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
