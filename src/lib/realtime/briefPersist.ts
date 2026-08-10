/**
 * 요약본 문서 저장의 단일 경로.
 *
 * persist.ts(주간보고)와 같은 규칙을 따른다 — advisory lock 으로 직렬화하고,
 * 잠금·세대를 트랜잭션 안에서 확인하며, requestId 로 멱등을 보장한다.
 * 별도 함수로 둔 이유는 저장 대상 테이블과 변환 규칙(HTML vs 블록 JSON)이 다르기 때문이다.
 */
import * as Y from 'yjs';
import type { PrismaClient } from '@prisma/client';
import { prisma } from '../db';
import { briefToHtml, briefTitle } from './briefDoc';
import { PRODUCTION_ENV } from './persist';

export type BriefOp = 'normal' | 'seed' | 'lock-finalize' | 'restore';

export interface BriefPersistInput {
  environment: string;
  year: number;
  weekNum: number;
  update: Uint8Array;
  requestId: string;
  docGeneration?: number;
  writeEpoch?: number;
  op?: BriefOp;
  seedId?: string;
  /**
   * 룸이 onLoad 에서 받은 seedId. 저장 시점의 DB 문서와 다르면 **다른 문서**다.
   *
   * 문서 행이 지워졌다가 다시 시드되면 세대·에폭이 1 로 되돌아가 fencing 이 통하지 않는다.
   * 그 상태로 옛 룸이 저장하면 독립 생성된 두 Y.Doc 이 병합돼 본문이 두 벌이 되고
   * meta.title 은 한쪽이 통째로 사라진다. seedId 가 그 마지막 방어선이다.
   */
  expectedSeedId?: string;
  /**
   * 시드를 만들 때 근거로 삼은 Brief.content.
   * 트랜잭션 안에서 다시 읽어 달라졌으면 시드를 취소한다(레거시 저장과의 경합 방지).
   */
  seedFromContent?: string;
  /** 이번 저장을 유발한 사용자 — 기존 Brief 행을 새로 만들 때 createdBy 로 쓴다 */
  actorUserId?: number;
  snapshotReason?: 'lock' | 'bulk-delete' | 'pre-restore';
}

export type BriefPersistResult =
  | { ok: true; revision: number; docGeneration: number; writeEpoch: number; deduped?: boolean }
  | {
      ok: false;
      reason: 'locked' | 'generation-mismatch' | 'epoch-mismatch' | 'not-found'
        | 'already-seeded' | 'seed-mismatch' | 'stale-seed' | 'busy';
      revision?: number;
    };

const LOCK_TIMEOUT_MS = 5000;
const SNAPSHOT_INTERVAL_MS = 7 * 60 * 1000;
const INTERVAL_SNAPSHOT_KEEP = 12;
const RECEIPT_TTL_MS = 24 * 60 * 60 * 1000;
const RECEIPT_SWEEP_PROBABILITY = 0.02;

/** 요약본 문서 키 → advisory lock 용 int4 두 개 (주간보고와 다른 네임스페이스) */
function lockKeys(environment: string, year: number, weekNum: number): [number, number] {
  const s = `brief:${environment}:${year}:${weekNum}`;
  const fnv = (seed: number) => {
    let h = seed;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h | 0;
  };
  return [fnv(0x811c9dc5), fnv(0x9e3779b9)];
}

type Tx = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

export async function persistBriefUpdate(input: BriefPersistInput): Promise<BriefPersistResult> {
  const { environment, year, weekNum, update, requestId, op = 'normal', seedId, actorUserId } = input;

  return prisma.$transaction(async (tx: Tx) => {
    const [lk1, lk2] = lockKeys(environment, year, weekNum);
    await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT_MS}ms'`);
    try {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${lk1}::int4, ${lk2}::int4)`;
    } catch {
      return { ok: false as const, reason: 'busy' as const };
    }

    // 멱등 — 영수증 키에 문서 스코프를 넣어 다른 문서의 저장과 섞이지 않게 한다
    const scopedRequestId = `brief:${environment}:${year}:${weekNum}:${requestId}`;
    const receipt = await tx.persistReceipt.findUnique({ where: { requestId: scopedRequestId } });
    if (receipt) {
      if (input.docGeneration !== undefined && input.docGeneration !== receipt.docGeneration) {
        return { ok: false as const, reason: 'generation-mismatch' as const, revision: receipt.revision };
      }
      if (input.writeEpoch !== undefined && input.writeEpoch !== receipt.writeEpoch) {
        return { ok: false as const, reason: 'epoch-mismatch' as const, revision: receipt.revision };
      }
      return {
        ok: true as const,
        revision: receipt.revision,
        docGeneration: receipt.docGeneration,
        writeEpoch: receipt.writeEpoch,
        deduped: true
      };
    }

    const existing = await tx.briefDoc.findUnique({
      where: { environment_year_weekNum: { environment, year, weekNum } }
    });

    // 잠금은 기존 Brief 테이블이 진실원본이다 (요약본 잠금 UI 가 그걸 쓴다)
    const brief = await tx.brief.findUnique({
      where: { year_weekNum: { year, weekNum } },
      select: { isLocked: true, content: true }
    });
    const isLocked = brief?.isLocked === true;

    // 최초 생성
    if (!existing) {
      if (op !== 'seed') return { ok: false as const, reason: 'not-found' as const };
      if (isLocked) return { ok: false as const, reason: 'locked' as const };

      // 시드 원본을 트랜잭션 밖에서 읽었으므로, 그 사이 레거시 저장이 들어왔을 수 있다.
      // 그대로 만들면 방금 저장한 내용이 문서에 없는 채로 굳고 다음 미러가 그걸 덮어쓴다.
      if (input.seedFromContent !== undefined && (brief?.content ?? '') !== input.seedFromContent) {
        return { ok: false as const, reason: 'stale-seed' as const };
      }

      const doc = new Y.Doc();
      Y.applyUpdate(doc, update);
      const created = await tx.briefDoc.create({
        data: {
          environment, year, weekNum,
          ydoc: Buffer.from(Y.encodeStateAsUpdate(doc)),
          html: briefToHtml(doc),
          title: briefTitle(doc),
          seedId: seedId ?? '',
          revision: 1
        }
      });
      // 시드는 기존 Brief 를 건드리지 않는다 — 새 문서로 확정본을 덮으면 안 된다
      await tx.persistReceipt.create({
        data: {
          requestId: scopedRequestId, revision: created.revision,
          docGeneration: created.docGeneration, writeEpoch: created.writeEpoch
        }
      });
      return {
        ok: true as const,
        revision: created.revision,
        docGeneration: created.docGeneration,
        writeEpoch: created.writeEpoch
      };
    }

    // 룸이 알고 있는 문서와 DB 의 문서가 같은 것인지 확인한다.
    // 세대·에폭은 문서가 재생성되면 1 로 되돌아가므로 이 검사가 따로 필요하다.
    if (op !== 'seed' && input.expectedSeedId !== undefined && existing.seedId !== input.expectedSeedId) {
      return { ok: false as const, reason: 'seed-mismatch' as const, revision: existing.revision };
    }

    // 이미 있는데 seed 로 들어오면 게이트를 건너뛰지 않게 여기서 끊는다
    if (op === 'seed') {
      if (seedId && existing.seedId === seedId) {
        return {
          ok: true as const,
          revision: existing.revision,
          docGeneration: existing.docGeneration,
          writeEpoch: existing.writeEpoch,
          deduped: true
        };
      }
      return { ok: false as const, reason: 'already-seeded' as const, revision: existing.revision };
    }

    if (op === 'normal') {
      if (isLocked) return { ok: false as const, reason: 'locked' as const, revision: existing.revision };
      if (input.docGeneration !== undefined && input.docGeneration !== existing.docGeneration) {
        return { ok: false as const, reason: 'generation-mismatch' as const, revision: existing.revision };
      }
      if (input.writeEpoch !== undefined && input.writeEpoch !== existing.writeEpoch) {
        return { ok: false as const, reason: 'epoch-mismatch' as const, revision: existing.revision };
      }
    }

    // restore 는 병합이 아니라 치환이다 — Yjs update 는 가산적이라 얹으면 삭제가 되돌아오지 않는다
    const doc = new Y.Doc();
    if (op !== 'restore') Y.applyUpdate(doc, new Uint8Array(existing.ydoc));
    Y.applyUpdate(doc, update);

    const html = briefToHtml(doc);
    const title = briefTitle(doc);
    const nextRevision = existing.revision + 1;
    const ydocBytes = Buffer.from(Y.encodeStateAsUpdate(doc));

    // 광역 삭제 감지 — **지우기 직전** 상태를 남긴다.
    // 지운 뒤 상태를 저장해봐야 복구에 쓸 수 없다.
    if (existing.html.length >= 200 && html.length < existing.html.length * 0.4) {
      await tx.briefDocSnapshot.create({
        data: {
          docId: existing.id, ydoc: existing.ydoc,
          docGeneration: existing.docGeneration, revision: existing.revision,
          reason: 'bulk-delete'
        }
      });
    }

    const updated = await tx.briefDoc.update({
      where: { id: existing.id },
      data: {
        ydoc: ydocBytes,
        html,
        title,
        revision: nextRevision,
        ...(op === 'lock-finalize' ? { writeEpoch: existing.writeEpoch + 1 } : {}),
        ...(op === 'restore' ? { docGeneration: existing.docGeneration + 1, writeEpoch: 1 } : {})
      }
    });

    await mirrorBrief(tx, {
      environment, year, weekNum, title, html, isLocked, op, actorUserId, hasBriefRow: !!brief
    });

    // 되돌릴 지점을 남긴다. ydoc·html·Brief 미러가 한 트랜잭션에서 함께 갱신되므로
    // 광역 삭제가 들어오면 세 곳이 동시에 비어 복구할 원본이 남지 않는다.
    await maybeSnapshot(
      tx, updated.id, ydocBytes,
      updated.docGeneration, nextRevision,
      op === 'lock-finalize' ? 'lock' : input.snapshotReason
    );
    await sweepReceipts(tx);

    await tx.persistReceipt.create({
      data: {
        requestId: scopedRequestId, revision: nextRevision,
        docGeneration: updated.docGeneration, writeEpoch: updated.writeEpoch
      }
    });

    return {
      ok: true as const,
      revision: nextRevision,
      docGeneration: updated.docGeneration,
      writeEpoch: updated.writeEpoch
    };
  }, { timeout: 20_000 });
}

/**
 * 기존 Brief 미러 — 전환 기간 롤백 경로라 같은 트랜잭션에서 함께 쓴다.
 *
 * 두 가지를 반드시 지켜야 한다.
 *  1. **운영 환경에서만** 쓴다. Brief 에는 environment 컬럼이 없어서, 프리뷰/개발이 미러를 쓰면
 *     운영 요약본을 그대로 덮는다(BriefDoc 은 environment 로 갈리지만 미러는 안 갈린다).
 *  2. 잠긴 주차는 건드리지 않는다. 잠금 확정(lock-finalize)만 예외로 최종본을 기록한다.
 */
async function mirrorBrief(
  tx: Tx,
  p: {
    environment: string; year: number; weekNum: number;
    title: string; html: string; isLocked: boolean; op: BriefOp;
    actorUserId?: number; hasBriefRow: boolean;
  }
) {
  if (p.environment !== PRODUCTION_ENV) return;
  if (p.isLocked && p.op !== 'lock-finalize') return;

  if (p.hasBriefRow) {
    await tx.brief.update({
      where: { year_weekNum: { year: p.year, weekNum: p.weekNum } },
      data: { title: p.title, content: p.html }
    });
  } else if (p.actorUserId) {
    // 행이 없을 때만 만든다. 작성자를 모르면 만들지 않는다 —
    // createdBy 에 의미 없는 값을 넣느니 미러를 건너뛰는 편이 낫다.
    await tx.brief.create({
      data: { year: p.year, weekNum: p.weekNum, title: p.title, content: p.html, createdBy: p.actorUserId }
    });
  }
}

/** 사건 스냅샷은 항상, 간격 스냅샷은 마지막 이후 SNAPSHOT_INTERVAL_MS 지났을 때만 */
async function maybeSnapshot(
  tx: Tx, docId: number, ydoc: Buffer, docGeneration: number, revision: number,
  reason?: 'lock' | 'bulk-delete' | 'pre-restore'
) {
  if (reason) {
    await tx.briefDocSnapshot.create({ data: { docId, ydoc, docGeneration, revision, reason } });
    return;
  }
  const last = await tx.briefDocSnapshot.findFirst({
    where: { docId, reason: 'interval' },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true }
  });
  if (last && Date.now() - last.createdAt.getTime() < SNAPSHOT_INTERVAL_MS) return;

  await tx.briefDocSnapshot.create({ data: { docId, ydoc, docGeneration, revision, reason: 'interval' } });

  // 링버퍼 — interval 만 정리한다. 사건 스냅샷(lock 등)은 보존한다.
  const olds = await tx.briefDocSnapshot.findMany({
    where: { docId, reason: 'interval' },
    orderBy: { createdAt: 'desc' },
    skip: INTERVAL_SNAPSHOT_KEEP,
    select: { id: true }
  });
  if (olds.length) {
    await tx.briefDocSnapshot.deleteMany({ where: { id: { in: olds.map((o: { id: number }) => o.id) } } });
  }
}

/**
 * 오래된 영수증 정리. 요약본만 파일럿하는 동안에는 persist.ts 의 정리가 돌지 않아
 * 이쪽에서도 해주지 않으면 PersistReceipt 가 저장 횟수만큼 무한히 쌓인다.
 */
async function sweepReceipts(tx: Tx) {
  if (Math.random() > RECEIPT_SWEEP_PROBABILITY) return;
  await tx.persistReceipt.deleteMany({
    where: { createdAt: { lt: new Date(Date.now() - RECEIPT_TTL_MS) } }
  });
}
