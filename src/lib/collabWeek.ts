/**
 * 팀·주차가 공동 편집 대상인지 — **순수 함수**.
 *
 * 서버(persist.ts)와 화면 양쪽이 같은 판정을 써야 한다. persist.ts 는 prisma 를 끌고 오므로
 * 화면에서 import 할 수 없어, 판정만 여기로 떼어냈다. 규칙이 갈리면
 * "화면은 공동 편집인데 서버는 아니라고 해서 저장이 거부되는" 상태가 된다.
 */
export interface TeamCollabRange {
  collabFromYear?: number | null;
  collabFromWeek?: number | null;
  collabUntilYear?: number | null;
  collabUntilWeek?: number | null;
}

/** (연도, 주차) 비교 — 주차 숫자만 보면 연말·연초가 뒤집힌다 */
function cmpWeek(aYear: number, aWeek: number, bYear: number, bWeek: number): number {
  if (aYear !== bYear) return aYear < bYear ? -1 : 1;
  if (aWeek !== bWeek) return aWeek < bWeek ? -1 : 1;
  return 0;
}

export function isCollabWeek(team: TeamCollabRange, year: number, weekNum: number): boolean {
  const fy = team.collabFromYear ?? null;
  const fw = team.collabFromWeek ?? null;
  if (fy == null || fw == null) return false;
  if (cmpWeek(year, weekNum, fy, fw) < 0) return false;

  // 끈 팀은 collabUntil 이 채워진다. 그 주차까지는 공동 편집으로 남고 이후만 기존 방식이다.
  const uy = team.collabUntilYear ?? null;
  const uw = team.collabUntilWeek ?? null;
  if (uy != null && uw != null && cmpWeek(year, weekNum, uy, uw) > 0) return false;

  return true;
}
