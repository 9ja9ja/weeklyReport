/**
 * 통합 테스트 안전장치 검증.
 * 이 가드가 뚫리면 운영 DB 가 통째로 지워질 수 있으므로 케이스를 촘촘히 둔다.
 */
import { describe, it, expect } from 'vitest';
import { checkTestDatabaseUrl } from './testDb';

describe('checkTestDatabaseUrl', () => {
  it('값이 없으면 건너뛴다', () => {
    expect(checkTestDatabaseUrl(undefined).usable).toBe(false);
    expect(checkTestDatabaseUrl('').usable).toBe(false);
  });

  it('로컬 + 이름에 test 가 있으면 허용', () => {
    for (const url of [
      'postgresql://postgres@127.0.0.1:55432/wrtest',
      'postgresql://postgres@localhost:5432/my_test_db',
      'postgres://u:p@127.0.0.1:5432/TESTDB'
    ]) {
      expect(checkTestDatabaseUrl(url).usable, url).toBe(true);
    }
  });

  it('원격 호스트는 이름에 test 가 있어도 거부', () => {
    for (const url of [
      'postgresql://u:p@ep-floral-cake.ap-southeast-1.aws.neon.tech/test',
      'postgresql://u:p@aws-1-ap-northeast-2.pooler.supabase.com:5432/testdb',
      'postgresql://u:p@10.0.0.5:5432/test'
    ]) {
      const r = checkTestDatabaseUrl(url);
      expect(r.usable, url).toBe(false);
      expect(r.reason).toContain('로컬');
    }
  });

  it('로컬이어도 이름에 test 가 없으면 거부', () => {
    const r = checkTestDatabaseUrl('postgresql://postgres@127.0.0.1:5432/weeklyreport');
    expect(r.usable).toBe(false);
    expect(r.reason).toContain('test');
  });

  it('URL 로 해석 안 되면 거부', () => {
    expect(checkTestDatabaseUrl('not a url').usable).toBe(false);
  });

  it('DB 이름이 비어도 거부', () => {
    expect(checkTestDatabaseUrl('postgresql://postgres@127.0.0.1:5432/').usable).toBe(false);
  });
});
