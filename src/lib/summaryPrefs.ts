/**
 * 취합본 표시 설정(내용없음 포함 / 작성자 포함)의 단일 기준점.
 *
 * 값은 팀·주차 단위(SummaryData)에 저장되는데, 체크박스 토글은 **만진 필드만** 부분 저장한다.
 * 그래서 "이번 주에는 아직 설정한 적 없음(null)" 상태가 흔하고, 그때는 같은 팀의 직전 설정을
 * 물려받아야 지난주에 끈 옵션이 이번 주에 되살아나지 않는다.
 *
 * 이 규칙이 화면마다 갈리면 같은 주차가 화면마다 다르게 보인다 — 실제로 팀별 취합본만
 * 물려받기를 하고 전체취합본·PDF·엑셀은 `?? true` 로 하드코딩돼 있어서, 체크박스는 꺼져
 * 보이는데 내용없음 행이 그대로 출력됐다(2026-08-28 신고). 판정을 여기 한 곳에 모은다.
 */
import { prisma } from '@/lib/db';

export interface StoredPrefs {
  teamId: number;
  year: number;
  weekNum: number;
  includeEmpty: boolean | null;
  includeAuthor: boolean | null;
}

export interface DisplayPrefs {
  includeEmpty: boolean;
  includeAuthor: boolean;
}

/** 한 번도 설정한 적 없고 물려받을 것도 없을 때 — 둘 다 포함이 기본이다 */
export const DEFAULT_DISPLAY_PREFS: DisplayPrefs = { includeEmpty: true, includeAuthor: true };

/**
 * 설정을 담으려고 만들어진 자리표시 행인가.
 *
 * 표시 설정 토글(PATCH)은 그 주차 행이 없으면 `contents: '{}'` 로 행을 만든다 —
 * 설정을 넣을 자리가 필요하기 때문이다. 이 행은 취합본이 아니다.
 * 취합본으로 세면 "취합본 있음(내용 없음)"이 되어 **개별 보고 폴백이 막히고**
 * 개인 작성 팀이 통째로 빈칸으로 나온다(운영에서 땡겨요 2026-32 행을 확인).
 *
 * 분류 키가 하나라도 있으면 실제 취합본으로 본다 — 팀장이 항목을 모두 지운 취합본은
 * 분류 키가 남아 있고, 그건 의도한 빈 취합본이라 개별 보고로 되살리면 안 된다.
 */
export function isPlaceholderSummary(contents: string | null | undefined): boolean {
  if (!contents) return true;
  try {
    const v = JSON.parse(contents);
    if (!v || typeof v !== 'object' || Array.isArray(v)) return true;
    return Object.keys(v).length === 0;
  } catch {
    return true;
  }
}

/**
 * 팀별로 (year, weekNum) **이전** 중 설정이 남아 있는 가장 최근 행을 고른다.
 *
 * includeEmpty 가 비어 있는 행은 후보에서 뺀다 — 미러가 자동 생성만 해 둔 행이라
 * 물려줄 설정이 없다. (팀별 취합본이 예전부터 쓰던 판정과 같은 기준이다)
 */
export function pickInherited(
  rows: StoredPrefs[], year: number, weekNum: number
): Map<number, StoredPrefs> {
  const best = new Map<number, StoredPrefs>();
  for (const r of rows) {
    if (r.includeEmpty == null) continue;
    if (r.year > year || (r.year === year && r.weekNum >= weekNum)) continue;
    const cur = best.get(r.teamId);
    if (!cur || r.year > cur.year || (r.year === cur.year && r.weekNum > cur.weekNum)) {
      best.set(r.teamId, r);
    }
  }
  return best;
}

/** 자기 주차 값이 비어 있는 필드만 직전 설정으로 채우고, 그것도 없으면 기본값 */
export function resolveDisplayPrefs(
  own: Pick<StoredPrefs, 'includeEmpty' | 'includeAuthor'> | null | undefined,
  prev: Pick<StoredPrefs, 'includeEmpty' | 'includeAuthor'> | null | undefined
): DisplayPrefs {
  return {
    includeEmpty: own?.includeEmpty ?? prev?.includeEmpty ?? DEFAULT_DISPLAY_PREFS.includeEmpty,
    includeAuthor: own?.includeAuthor ?? prev?.includeAuthor ?? DEFAULT_DISPLAY_PREFS.includeAuthor
  };
}

/**
 * 여러 팀의 표시 설정을 한 번에 확정한다.
 *
 * 전체취합본·PDF·엑셀은 모든 팀을 한 요청에서 그리므로 팀마다 조회하면 N+1 이 된다.
 * 후보 행을 한 번에 받아 메모리에서 고른다 (팀 수 x 주차 수라 규모가 작다).
 */
export async function loadDisplayPrefs(
  teamIds: number[], year: number, weekNum: number
): Promise<Map<number, DisplayPrefs>> {
  const out = new Map<number, DisplayPrefs>();
  if (!teamIds.length) return out;

  const rows = await prisma.summaryData.findMany({
    where: { teamId: { in: teamIds } },
    select: { teamId: true, year: true, weekNum: true, includeEmpty: true, includeAuthor: true }
  });

  const own = new Map<number, StoredPrefs>();
  for (const r of rows) {
    if (r.year === year && r.weekNum === weekNum) own.set(r.teamId, r);
  }
  const inherited = pickInherited(rows, year, weekNum);

  for (const teamId of teamIds) {
    out.set(teamId, resolveDisplayPrefs(own.get(teamId), inherited.get(teamId)));
  }
  return out;
}
