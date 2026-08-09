/**
 * DB 통합 테스트용 안전장치.
 *
 * 통합 테스트는 매 케이스마다 모든 테이블을 deleteMany 한다. TEST_DATABASE_URL 을 잘못 지정하면
 * 운영 데이터가 지워지므로, "명백히 로컬 테스트 DB"가 아니면 아예 실행되지 않게 막는다.
 *
 * 허용 조건 (둘 다 만족):
 *   1. 호스트가 localhost / 127.0.0.1 / ::1
 *   2. DB 이름이 test 를 포함
 */
export interface TestDbCheck {
  usable: boolean;
  url?: string;
  reason?: string;
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

export function checkTestDatabaseUrl(raw: string | undefined): TestDbCheck {
  if (!raw) return { usable: false, reason: 'TEST_DATABASE_URL 이 없습니다 (통합 테스트 건너뜀)' };

  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { usable: false, reason: 'TEST_DATABASE_URL 을 URL 로 해석할 수 없습니다' };
  }

  const host = u.hostname;
  if (!LOCAL_HOSTS.has(host)) {
    return {
      usable: false,
      reason:
        `안전장치: 통합 테스트는 로컬 DB 에서만 실행합니다. 호스트=${host}. ` +
        `이 테스트는 모든 테이블을 삭제하므로 원격 DB 를 가리키면 실행하지 않습니다.`
    };
  }

  const dbName = u.pathname.replace(/^\//, '');
  if (!/test/i.test(dbName)) {
    return {
      usable: false,
      reason: `안전장치: DB 이름에 'test' 가 들어가야 합니다. 현재=${dbName || '(없음)'}`
    };
  }

  return { usable: true, url: raw };
}

/**
 * 테스트 파일 상단에서 호출한다.
 * 사용 가능하면 url 을 돌려주고, 조건 미달이면 사유를 콘솔에 남긴 뒤 undefined 를 돌려준다
 * (해당 describe 를 skip 시키기 위함).
 */
export function resolveTestDatabaseUrl(): string | undefined {
  const check = checkTestDatabaseUrl(process.env.TEST_DATABASE_URL);
  if (check.usable) return check.url;
  // 값이 있는데 거부된 경우만 알린다 — 없으면 조용히 건너뛴다
  if (process.env.TEST_DATABASE_URL) console.warn(`[통합 테스트 건너뜀] ${check.reason}`);
  return undefined;
}
