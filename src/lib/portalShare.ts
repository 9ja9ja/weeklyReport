import crypto from 'crypto';

/**
 * 사내 포털(회사 도메인)에서 로그인 없이 요약본을 열람할 때 쓰는 공유 키.
 * BRIEF_SHARE_KEY 가 설정되지 않았으면 항상 거부한다 — 기본값을 두면
 * 배포 환경에서 실수로 공개 상태가 될 수 있다.
 */
export function verifyPortalKey(key: string | null): boolean {
  const secret = process.env.BRIEF_SHARE_KEY;
  if (!secret || !key) return false;
  if (key.length !== secret.length) return false;
  return crypto.timingSafeEqual(Buffer.from(key), Buffer.from(secret));
}
