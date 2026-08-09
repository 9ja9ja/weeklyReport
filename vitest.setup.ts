/**
 * 테스트 러너 전역 가드.
 *
 * @prisma/client 를 import 하는 것만으로 .env 가 process.env 에 로드되어
 * DATABASE_URL 이 운영 DB 를 가리키게 된다. 테스트 파일 하나가 실수로 싱글턴 prisma 를
 * 쓰면 운영 데이터를 지울 수 있으므로, 러너 수준에서 DATABASE_URL 자체를 무해한 값으로
 * 덮어쓴다. 통합 테스트는 TEST_DATABASE_URL 을 명시적으로 검사해 따로 연결한다.
 */
import { checkTestDatabaseUrl } from './src/lib/realtime/testDb';

const check = checkTestDatabaseUrl(process.env.TEST_DATABASE_URL);

if (check.usable && check.url) {
  // 통합 테스트가 싱글턴 prisma 를 쓰더라도 로컬 테스트 DB 로만 간다
  process.env.DATABASE_URL = check.url;
} else {
  // 어떤 코드가 실수로 연결을 시도해도 운영에 닿지 않도록 존재하지 않는 로컬 주소로 고정
  process.env.DATABASE_URL = 'postgresql://invalid:invalid@127.0.0.1:1/vitest_no_db';
}
