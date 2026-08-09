import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // 러너 시작 시 DATABASE_URL 을 무해한 값으로 고정한다 (운영 DB 오접속 방지)
    setupFiles: ['./vitest.setup.ts'],
    // DB 통합 테스트가 같은 테스트 DB 를 초기화하므로 파일 병렬 실행을 끈다.
    // (병렬로 두면 한 파일의 beforeEach 가 다른 파일이 만든 팀을 지워 FK 위반이 난다)
    fileParallelism: false
  },
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, 'src') }
  }
});
