import { promises as fs } from 'fs';
import path from 'path';
import crypto from 'crypto';

/**
 * 첨부파일 저장소.
 *
 * 지금은 로컬 디스크 구현이다. 사내 시스템으로 이관한 뒤 저장소(사내 스토리지·오브젝트 스토리지 등)가
 * 정해지면 이 파일의 put/get/remove 만 바꾸면 된다 — 호출하는 쪽은 storageKey 문자열만 안다.
 *
 * storageKey 는 서버가 만든 무작위 값이라 사용자 입력(파일명)이 경로에 들어가지 않는다.
 * 원래 파일명은 DB(BriefAttachment.fileName)에만 둔다.
 */
const ROOT = process.env.ATTACHMENT_DIR || path.join(process.cwd(), '.data', 'attachments');

const KEY_PATTERN = /^[0-9a-f]{32}$/;

function resolve(key: string): string {
  // DB 값이라도 형식을 한 번 더 확인해 경로 탈출(../)을 원천 차단한다
  if (!KEY_PATTERN.test(key)) throw new Error('잘못된 저장 키입니다.');
  return path.join(ROOT, key);
}

export async function putAttachment(data: Buffer): Promise<string> {
  const key = crypto.randomBytes(16).toString('hex');
  await fs.mkdir(ROOT, { recursive: true });
  await fs.writeFile(resolve(key), data, { flag: 'wx' });
  return key;
}

export async function getAttachment(key: string): Promise<Buffer> {
  return fs.readFile(resolve(key));
}

export async function removeAttachment(key: string): Promise<void> {
  await fs.rm(resolve(key), { force: true });
}
