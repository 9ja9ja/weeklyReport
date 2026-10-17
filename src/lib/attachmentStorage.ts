import { promises as fs } from 'fs';
import path from 'path';
import crypto from 'crypto';

/**
 * 첨부파일 저장소 — 앱 서버 디스크의 고정 폴더.
 *
 * 저장 폴더는 환경변수 ATTACHMENT_DIR 로 지정한다. **앱 폴더 밖의 절대 경로**여야 한다
 * (예: /data/weekly-report/attachments). 배포가 새 폴더로 갈아끼우는 방식이면
 * 앱 폴더 안에 둔 파일은 다음 배포 때 사라진다.
 * 그래서 운영(NODE_ENV=production)에서 ATTACHMENT_DIR 이 없으면 기본 경로로 조용히 저장하지 않고
 * 오류로 막는다. 개발 환경만 프로젝트 안 .data/attachments 를 기본값으로 쓴다.
 *
 * 다른 저장소(NAS 마운트 경로는 그대로 ATTACHMENT_DIR 로 가능, 오브젝트 스토리지 등)로 바꿀 때는
 * 이 파일의 put/get/remove 만 바꾸면 된다 — 호출하는 쪽은 storageKey 문자열만 안다.
 *
 * storageKey 는 서버가 만든 무작위 값이라 사용자 입력(파일명)이 경로에 들어가지 않는다.
 * 원래 파일명은 DB(BriefAttachment.fileName)에만 둔다.
 */
export class AttachmentStorageNotConfigured extends Error {
  constructor() {
    super('첨부 저장 폴더(ATTACHMENT_DIR)가 설정되지 않았습니다.');
  }
}

/** 환경변수는 호출 시점에 읽는다 — 시작 순서에 상관없이 서버 설정이 반영되고 테스트에서도 바꿀 수 있다 */
function root(): string {
  const dir = process.env.ATTACHMENT_DIR;
  if (dir) {
    if (!path.isAbsolute(dir)) throw new Error('ATTACHMENT_DIR 은 절대 경로여야 합니다.');
    return dir;
  }
  if (process.env.NODE_ENV === 'production') throw new AttachmentStorageNotConfigured();
  return path.join(process.cwd(), '.data', 'attachments');
}

/** 저장소를 쓸 수 있게 설정돼 있는가 (업로드 화면이 미리 안내할 때 쓴다) */
export function attachmentStorageConfigured(): boolean {
  try { root(); return true; } catch { return false; }
}

const KEY_PATTERN = /^[0-9a-f]{32}$/;

function resolve(key: string): string {
  // DB 값이라도 형식을 한 번 더 확인해 경로 탈출(../)을 원천 차단한다
  if (!KEY_PATTERN.test(key)) throw new Error('잘못된 저장 키입니다.');
  return path.join(root(), key);
}

export async function putAttachment(data: Buffer): Promise<string> {
  const dir = root();
  const key = crypto.randomBytes(16).toString('hex');
  // 폴더·파일은 앱 실행 계정만 읽도록 둔다(첨부에 내부 문서가 들어간다)
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  await fs.writeFile(resolve(key), data, { flag: 'wx', mode: 0o600 });
  return key;
}

export async function getAttachment(key: string): Promise<Buffer> {
  return fs.readFile(resolve(key));
}

export async function removeAttachment(key: string): Promise<void> {
  await fs.rm(resolve(key), { force: true });
}
