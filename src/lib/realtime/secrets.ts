/**
 * 시크릿 조회 — **Next(Node) 전용**.
 *
 * Worker 는 process.env 가 없고 `this.env` 로 바인딩을 받으므로 이 모듈을 쓰지 않는다.
 * token.ts 를 순수 crypto 로 남겨 두 런타임이 같은 서명 로직을 공유하게 하려고 분리했다.
 */
function requireSecret(name: string, value: string | undefined): string {
  if (value && value.length >= 16) return value;
  if (process.env.NODE_ENV === 'production') {
    // 운영에서 시크릿이 없으면 위조를 막을 수 없다. 통과시키느니 실패시킨다.
    throw new Error(`${name} 환경변수가 설정되지 않았습니다.`);
  }
  return `dev-only-insecure-${name}-do-not-use-in-production`;
}

/** 사용자 접속 토큰 서명키 */
export const tokenSecret = () => requireSecret('REALTIME_TOKEN_SECRET', process.env.REALTIME_TOKEN_SECRET);

/** Worker ↔ Next 서버간 시크릿. 토큰 키와 반드시 다른 값이어야 한다 */
export const serverSecret = () => requireSecret('REALTIME_SERVER_SECRET', process.env.REALTIME_SERVER_SECRET);

/** 접속 토큰 수명 — 접속 수립용이라 짧게 두고, provider 가 재접속마다 새로 받아간다 */
export const TOKEN_TTL_SEC = 600;
