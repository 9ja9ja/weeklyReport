/**
 * 요약본 실시간 문서 시드.
 *
 * 기존 Brief.content(HTML) 를 Y.Doc 으로 옮긴다. 클라이언트가 만들게 두면 여러 명이 동시에
 * 들어올 때 각자 시드해 중복·소실이 나므로 **서버가 원자적으로 한 번만** 만든다.
 * 실제 원자성은 persistBriefUpdate 의 advisory lock 이 보장한다.
 */
import * as Y from 'yjs';
import { prisma } from '../db';
import { buildBriefDoc } from './briefDoc';
import { persistBriefUpdate } from './briefPersist';

export interface BriefSeedResult {
  created: boolean;
  reason?: 'locked' | 'already-exists' | 'failed';
  seedId?: string;
  seededFromExisting?: boolean;
}

/**
 * 문서가 없으면 만든다. 이미 있으면 아무것도 하지 않는다.
 * 토큰 발급 경로와 Worker 콜드스타트 양쪽에서 호출해도 안전하다.
 */
export async function ensureBriefDocument(
  environment: string, year: number, weekNum: number, actorUserId?: number
): Promise<BriefSeedResult> {
  const existing = await prisma.briefDoc.findUnique({
    where: { environment_year_weekNum: { environment, year, weekNum } },
    select: { seedId: true }
  });
  if (existing) return { created: false, reason: 'already-exists', seedId: existing.seedId };

  // 기존 요약본이 있으면 그 내용으로 시작한다
  const brief = await prisma.brief.findUnique({
    where: { year_weekNum: { year, weekNum } },
    select: { title: true, content: true, isLocked: true }
  });
  if (brief?.isLocked) return { created: false, reason: 'locked' };

  // 시드 원본을 읽은 뒤 문서를 만드는 동안(대용량 표면 수십 ms) 레거시 저장이 끼어들 수 있다.
  // 그 경우 트랜잭션 안에서 stale-seed 로 거부되므로 최신 내용으로 다시 만든다.
  let source = brief;
  for (let attempt = 0; attempt < 3; attempt++) {
    const seedId = `brief-${year}-${weekNum}-${crypto.randomUUID()}`;
    const content = source?.content ?? '';
    const doc = buildBriefDoc(content, source?.title ?? '', seedId);

    const res = await persistBriefUpdate({
      environment, year, weekNum,
      update: Y.encodeStateAsUpdate(doc),
      requestId: `seed-${crypto.randomUUID()}`,
      op: 'seed',
      seedId,
      seedFromContent: content,
      actorUserId
    });

    if (res.ok) return { created: true, seedId, seededFromExisting: !!content };

    if (res.reason === 'stale-seed') {
      source = await prisma.brief.findUnique({
        where: { year_weekNum: { year, weekNum } },
        select: { title: true, content: true, isLocked: true }
      });
      if (source?.isLocked) return { created: false, reason: 'locked' };
      continue;
    }
    return {
      created: false,
      reason: res.reason === 'locked' ? 'locked' : res.reason === 'already-seeded' ? 'already-exists' : 'failed'
    };
  }
  return { created: false, reason: 'failed' };
}
