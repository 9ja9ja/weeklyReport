/**
 * 요약본 공동 편집 컷오버 스위치.
 *
 * 이게 없으면 마스터가 **과거 주차를 열어보기만 해도** 그 주차가 실시간 문서로 전환된다
 * (토큰 발급 경로가 시드하므로). 이미 확정에 가까운 지난 요약본까지 새 경로로 끌려들어가면
 * 파일럿의 영향 범위를 통제할 수 없다.
 *
 * 환경변수 `BRIEF_COLLAB_FROM` 에 시작 주차를 준다 — 예: `2026-W33`.
 * **미설정이면 공동 편집은 꺼진 상태**이고 요약본은 기존 저장 방식으로 동작한다.
 * 값을 지우면 즉시 되돌아가므로 kill switch 로도 쓴다.
 */
export interface CollabFrom {
  year: number;
  weekNum: number;
}

const PATTERN = /^(\d{4})-[Ww](\d{1,2})$/;

export function parseCollabFrom(raw: string | undefined | null): CollabFrom | null {
  if (!raw) return null;
  const m = PATTERN.exec(raw.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const weekNum = Number(m[2]);
  // 주차는 1..53. 범위를 벗어난 값을 통과시키면 의도와 다른 시점부터 켜진다.
  if (weekNum < 1 || weekNum > 53) return null;
  return { year, weekNum };
}

/** 이 주차가 공동 편집 대상인가 (시작 주차 이후 전부) */
export function isBriefCollabWeek(
  year: number,
  weekNum: number,
  raw: string | undefined | null = process.env.BRIEF_COLLAB_FROM
): boolean {
  const from = parseCollabFrom(raw);
  if (!from) return false;
  if (year !== from.year) return year > from.year;
  return weekNum >= from.weekNum;
}
