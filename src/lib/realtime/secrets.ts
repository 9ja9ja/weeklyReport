/**
 * 시크릿 조회 — **Next(Node) 전용**.
 *
 * Worker 는 process.env 가 없고 `this.env` 로 바인딩을 받으므로 이 모듈을 쓰지 않는다.
 * token.ts 를 순수 crypto 로 남겨 두 런타임이 같은 서명 로직을 공유하게 하려고 분리했다.
 */
function requireSecret(name: string, value: string | undefined): string {
  if (value && value.length >= 16) return value;
  // 환경을 가리지 않고 실패시킨다.
  //
  // 예전에는 비운영에서 소스에 박힌 상수를 돌려줬는데, 그 값은 저장소를 볼 수 있는 누구나 아는
  // 문자열이라 NODE_ENV 가 빠진 스테이징 한 대만 있어도 서버간 서명을 위조해
  // 임의 문서의 ydoc 을 덤프하거나 덮어쓸 수 있었다. 실시간이 꺼지는 편이 낫다.
  throw new Error(`${name} 환경변수가 설정되지 않았습니다.`);
}

/** 사용자 접속 토큰 서명키 */
export const tokenSecret = () => requireSecret('REALTIME_TOKEN_SECRET', process.env.REALTIME_TOKEN_SECRET);

/** Worker ↔ Next 서버간 시크릿. 토큰 키와 반드시 다른 값이어야 한다 */
export const serverSecret = () => requireSecret('REALTIME_SERVER_SECRET', process.env.REALTIME_SERVER_SECRET);

/**
 * 실시간 기능이 구성됐는가.
 *
 * 시크릿이 없으면 라우트가 예외를 던져 500 이 되는데, 그건 "서버 오류"가 아니라
 * "아직 설정되지 않음"이다. 미구성과 장애를 구분해야 모니터링이 오해하지 않는다.
 */
export function isRealtimeConfigured(): boolean {
  const token = process.env.REALTIME_TOKEN_SECRET ?? '';
  const server = process.env.REALTIME_SERVER_SECRET ?? '';
  // 두 값이 같으면 사용자 토큰으로 서버간 요청을 서명할 수 있게 된다 — 구성 오류로 본다.
  return token.length >= 16 && server.length >= 16 && token !== server;
}

/** 접속 토큰 수명 — 접속 수립용이라 짧게 두고, provider 가 재접속마다 새로 받아간다 */
export const TOKEN_TTL_SEC = 600;
