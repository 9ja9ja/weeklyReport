/**
 * 개선요청 게시판의 값 정의 — 화면과 API 가 같은 목록을 쓴다.
 * QC 서비스의 이슈 보드에서 이 서비스에 필요한 만큼만 가져왔다.
 */
export const IMPROVEMENT_STATUS = [
  { value: 'open', label: '접수', color: '#64748b' },
  { value: 'in_progress', label: '진행중', color: '#2563eb' },
  { value: 'done', label: '완료', color: '#059669' },
  { value: 'hold', label: '보류', color: '#d97706' },
  { value: 'rejected', label: '반영안함', color: '#dc2626' }
] as const;

export type ImprovementStatus = (typeof IMPROVEMENT_STATUS)[number]['value'];

export const IMPROVEMENT_CATEGORIES = ['작성', '취합', '조회', '요약본', '일정·손익', '기타'] as const;

export const statusMeta = (v: string) =>
  IMPROVEMENT_STATUS.find(s => s.value === v) ?? IMPROVEMENT_STATUS[0];

export const isStatus = (v: unknown): v is ImprovementStatus =>
  typeof v === 'string' && IMPROVEMENT_STATUS.some(s => s.value === v);

export const isCategory = (v: unknown): boolean =>
  typeof v === 'string' && (IMPROVEMENT_CATEGORIES as readonly string[]).includes(v);

/** 표시용 번호 */
export const requestKey = (seq: number) => `REQ-${seq}`;
