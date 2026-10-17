import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, statSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import {
  AttachmentStorageNotConfigured, attachmentStorageConfigured,
  getAttachment, putAttachment, removeAttachment
} from './attachmentStorage';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'attach-test-'));
  vi.stubEnv('ATTACHMENT_DIR', dir);
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

describe('attachmentStorage', () => {
  it('저장하고 같은 내용을 읽어온다', async () => {
    const key = await putAttachment(Buffer.from('hello'));
    expect(key).toMatch(/^[0-9a-f]{32}$/);
    expect((await getAttachment(key)).toString()).toBe('hello');
  });

  it('파일은 소유자만 읽도록 저장한다', async () => {
    const key = await putAttachment(Buffer.from('x'));
    expect(statSync(path.join(dir, key)).mode & 0o077).toBe(0);
  });

  it('삭제하면 읽을 수 없고, 없는 키를 지워도 오류가 없다', async () => {
    const key = await putAttachment(Buffer.from('x'));
    await removeAttachment(key);
    await expect(getAttachment(key)).rejects.toThrow();
    await expect(removeAttachment(key)).resolves.toBeUndefined();
  });

  it('경로를 벗어나는 키는 거부한다', async () => {
    await expect(getAttachment('../etc/passwd')).rejects.toThrow('잘못된 저장 키');
    await expect(removeAttachment('..%2f..%2fx')).rejects.toThrow('잘못된 저장 키');
  });

  it('상대 경로 설정은 거부한다', async () => {
    vi.stubEnv('ATTACHMENT_DIR', 'relative/dir');
    await expect(putAttachment(Buffer.from('x'))).rejects.toThrow('절대 경로');
  });

  it('운영에서 저장 폴더가 없으면 기본 경로로 저장하지 않고 막는다', async () => {
    vi.stubEnv('ATTACHMENT_DIR', '');
    vi.stubEnv('NODE_ENV', 'production');
    expect(attachmentStorageConfigured()).toBe(false);
    await expect(putAttachment(Buffer.from('x'))).rejects.toBeInstanceOf(AttachmentStorageNotConfigured);
  });
});
