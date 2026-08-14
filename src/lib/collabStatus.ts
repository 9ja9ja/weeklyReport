import { prisma } from '@/lib/db';
import { isCollabWeek, type TeamCollabRange } from '@/lib/collabWeek';
import { currentEnvironment } from '@/lib/realtime/persist';

/**
 * 공동 편집 주차의 "작성했는가" 판정 — 한 곳에 모아 둔다.
 *
 * 공동 편집 주차는 개인 Report 를 만들지 않는다(/api/reports POST 가 409 로 막는다).
 * 그래서 Report 유무만 보는 화면은 팀 전체가 '미작성' 으로 보인다 — 메인·취합본은
 * 10/14 인데 대시보드 카드만 0/14 로 뜨던 어긋남이 여기서 났다.
 * 작성 여부는 실제 편집 이력(DocActivity)으로 본다. 이월 시드만으로 "작성함"이
 * 되지 않도록 편집 이벤트를 따로 기록해 둔 값이다.
 *
 * 규칙이 화면마다 갈리면 같은 주차가 화면마다 다른 숫자로 보이므로,
 * 작성 여부를 표시하는 API 는 전부 이 함수를 거친다.
 */
export interface WeekKey { year: number; weekNum: number }
export type CollabTeam = TeamCollabRange & { id: number };

export interface CollabStatus {
  /** 이 팀·주차가 공동 편집 대상인가 */
  isCollab(teamId: number, year: number, weekNum: number): boolean;
  /** 공동 편집 주차에서 이 사람이 마지막으로 편집한 시각 (없으면 null = 미작성) */
  editedAt(teamId: number, userId: number, year: number, weekNum: number): Date | null;
}

export async function loadCollabStatus(teams: CollabTeam[], weeks: WeekKey[]): Promise<CollabStatus> {
  const collabKeys = new Set<string>();
  const teamIds = new Set<number>();
  for (const t of teams) {
    for (const w of weeks) {
      if (!isCollabWeek(t, w.year, w.weekNum)) continue;
      collabKeys.add(`${t.id}:${w.year}:${w.weekNum}`);
      teamIds.add(t.id);
    }
  }

  // 환경(environment)까지 맞춘다 — preview 에서 만든 편집 이력이 운영 현황에 섞이면 안 된다.
  const activities = teamIds.size
    ? await prisma.docActivity.findMany({
        where: {
          environment: currentEnvironment(),
          teamId: { in: [...teamIds] },
          OR: weeks.map(w => ({ year: w.year, weekNum: w.weekNum }))
        },
        select: { teamId: true, userId: true, year: true, weekNum: true, lastEditedAt: true }
      })
    : [];
  const edits = new Map(
    activities.map(a => [`${a.teamId}:${a.userId}:${a.year}:${a.weekNum}`, a.lastEditedAt])
  );

  return {
    isCollab: (teamId, year, weekNum) => collabKeys.has(`${teamId}:${year}:${weekNum}`),
    editedAt: (teamId, userId, year, weekNum) => edits.get(`${teamId}:${userId}:${year}:${weekNum}`) ?? null
  };
}
