/**
 * 주차 진행 단계 — **작성중 → 작성마감 → 취합완료**.
 *
 * 왜 가운데 단계가 필요한가:
 * 공동 편집 주차의 취합본은 공유 문서의 미러다. 팀원 룸이 살아있는 동안 팀장이 취합본을
 * 고치면 룸의 다음 저장(최대 6초)이 그대로 덮어써, 다듬은 내용이 조용히 사라진다.
 * 그래서 팀원 입력을 먼저 멈춘 뒤(작성마감)에야 팀장이 취합본을 정리할 수 있게 한다.
 * 취합완료(isLocked)는 그 뒤의 최종 확정이며 기존 의미 그대로다.
 *
 * 작성마감은 **공동 편집 주차에만** 쓴다. 개인 작성 주차는 룸이 없어 경합이 없으므로
 * 예전처럼 작성중에도 취합본을 고칠 수 있다.
 *
 * 서버·화면이 같은 규칙과 같은 표기를 쓰도록 판정을 여기 한 곳에 둔다.
 */
export type SummaryStage = 'open' | 'closed' | 'locked';

export interface StageFlags {
  isClosed?: boolean | null;
  isLocked?: boolean | null;
}

export const STAGE_LABEL: Record<SummaryStage, string> = {
  open: '작성중',
  closed: '작성마감',
  locked: '취합완료'
};

export function summaryStage(lock: StageFlags | null | undefined): SummaryStage {
  if (lock?.isLocked) return 'locked';
  if (lock?.isClosed) return 'closed';
  return 'open';
}

/** 팀원이 작성 화면에서 입력할 수 있는가 (작성중일 때만) */
export function membersCanWriteAt(stage: SummaryStage): boolean {
  return stage === 'open';
}

/**
 * 팀장이 취합본에서 편집할 수 있는가.
 * 공동 편집 주차는 작성마감 상태에서만, 개인 작성 주차는 취합완료 전까지.
 */
export function canMasterEditAt(stage: SummaryStage, collab: boolean): boolean {
  return collab ? stage === 'closed' : stage !== 'locked';
}

export function membersCanWrite(lock: StageFlags | null | undefined): boolean {
  return membersCanWriteAt(summaryStage(lock));
}

export function masterCanEditSummary(lock: StageFlags | null | undefined, collab: boolean): boolean {
  return canMasterEditAt(summaryStage(lock), collab);
}
