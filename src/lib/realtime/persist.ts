/**
 * 공유 문서 저장의 단일 경로.
 *
 * Worker 의 debounce 저장, 클라이언트 비상 저장, 잠금 확정, 복원이 **모두 이 함수를 거친다.**
 * `Y.applyUpdate` 가 멱등이어도 DB 의 `read → merge → write` 시퀀스는 원자적이지 않으므로,
 * 문서 키 기준 advisory lock 으로 직렬화한다.
 *
 * 왜 행 잠금(SELECT ... FOR UPDATE)이 아니라 advisory lock 인가:
 * 문서가 아직 없는 최초 생성 시점에는 잠글 행이 없다. 키 해시 기반 advisory lock 은
 * 생성/갱신 경로를 하나로 직렬화한다.
 */
import * as Y from 'yjs';
import type { PrismaClient } from '@prisma/client';
import { prisma } from '../db';
import { materializeToJson } from './materialize';

export type PersistOp = 'normal' | 'lock-finalize' | 'restore' | 'seed';

export interface PersistInput {
  environment: string;
  teamId: number;
  year: number;
  weekNum: number;
  /** Yjs update 바이트 (전체 상태 스냅샷이어도 됨 — applyUpdate 는 병합) */
  update: Uint8Array;
  /** 중복 저장 방지용 UUID. 같은 값으로 재호출하면 기존 revision 을 그대로 돌려준다 */
  requestId: string;
  /** 클라이언트/Worker 가 알고 있는 세대. normal 저장은 정확히 일치해야 한다 */
  docGeneration?: number;
  writeEpoch?: number;
  op?: PersistOp;
  /** 이번 저장분을 실제로 편집한 사용자들 (Worker 가 연결에서 누적해 보낸다) */
  dirtyUserIds?: number[];
  /** 스냅샷을 남길 사유. 없으면 간격 규칙에 따른다 */
  snapshotReason?: 'lock' | 'bulk-delete' | 'pre-restore';
  /** 최초 생성 시 필요 */
  seedId?: string;
  seededFrom?: string;
}

export type PersistResult =
  | { ok: true; revision: number; docGeneration: number; writeEpoch: number; deduped?: boolean }
  | { ok: false; reason: 'locked' | 'generation-mismatch' | 'epoch-mismatch' | 'not-found' | 'already-seeded' | 'busy'; revision?: number };

/** 간격 스냅샷 주기 — persist 마다 남기면 활발한 편집 중 수십 초 만에 이력이 밀려난다 */
const SNAPSHOT_INTERVAL_MS = 7 * 60 * 1000;
/** 문서당 보관할 interval 스냅샷 수 (사건 스냅샷은 별도로 남긴다) */
const INTERVAL_SNAPSHOT_KEEP = 12;
/**
 * 영수증 보관 기간. 재전송은 초~분 단위에 일어나므로 하루면 충분하다.
 * 정리하지 않으면 저장 횟수만큼 무한히 쌓인다.
 */
const RECEIPT_TTL_MS = 24 * 60 * 60 * 1000;
/** 정리는 매 저장마다 하지 않고 가끔만 — 저장 경로의 지연을 늘리지 않기 위해 */
const RECEIPT_SWEEP_PROBABILITY = 0.02;
/** SummaryData 미러를 쓰는 유일한 환경 — 미러 테이블에는 environment 구분이 없다 */
export const PRODUCTION_ENV = 'production';
/** advisory lock 대기 상한 — 넘으면 예외 대신 busy 로 돌려준다 */
const LOCK_TIMEOUT_MS = 5000;

/**
 * 문서 키 → advisory lock 용 int4 두 개.
 * `pg_advisory_xact_lock(int4, int4)` 를 쓰면 BigInt 없이 32bit 정수 두 개로 충분하다
 * (프로젝트 tsconfig target 이 ES2017 이라 BigInt 리터럴을 쓸 수 없다).
 * 해시가 충돌하면 서로 무관한 문서가 같은 락을 기다릴 뿐, 정확성에는 영향이 없다.
 */
function lockKeys(environment: string, teamId: number, year: number, weekNum: number): [number, number] {
  const s = `${environment}:${teamId}:${year}:${weekNum}`;
  // FNV-1a 32bit 를 서로 다른 오프셋으로 두 번
  const fnv = (seed: number) => {
    let h = seed;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h | 0; // int4 범위로
  };
  return [fnv(0x811c9dc5), fnv(0x9e3779b9)];
}

type Tx = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

/**
 * 저장 본체. 트랜잭션 안에서 advisory lock → 검사 → 병합 → 기록 순으로 진행한다.
 */
export async function persistUpdate(input: PersistInput): Promise<PersistResult> {
  const {
    environment, teamId, year, weekNum, update, requestId,
    op = 'normal', dirtyUserIds = [], snapshotReason, seedId, seededFrom = ''
  } = input;

  return prisma.$transaction(async (tx: Tx) => {
    // 0) 같은 문서에 대한 저장을 직렬화. 트랜잭션 종료 시 자동 해제된다.
    //    상한을 두지 않으면 경합 시 Prisma 트랜잭션 타임아웃(P2028) 예외로 끝나 버려
    //    PersistResult 로 처리할 수 없다. lock_timeout 을 걸고 실패를 결과값으로 돌려준다.
    const [lk1, lk2] = lockKeys(environment, teamId, year, weekNum);
    await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT_MS}ms'`);
    try {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${lk1}::int4, ${lk2}::int4)`;
    } catch {
      return { ok: false as const, reason: 'busy' as const };
    }

    // 1) 멱등 — 커밋은 됐는데 ACK 만 유실된 재전송을 걸러낸다
    // 영수증 키는 문서 스코프까지 포함한다. requestId 만 보면 다른 문서의 저장이
    // 남의 영수증에 걸려 조용히 버려진다.
    const scopedRequestId = `${environment}:${teamId}:${year}:${weekNum}:${requestId}`;
    const receipt = await tx.persistReceipt.findUnique({ where: { requestId: scopedRequestId } });
    if (receipt) {
      // 기록 시점의 세대를 그대로 돌려준다. '현재' 세대를 주면 구세대를 든 클라이언트가
      // 재전송만으로 최신 세대 값을 받아가 fencing 을 우회한다.
      // 요청이 든 세대가 영수증과 다르면(그 사이 잠금·복원이 있었다) 실패로 알린다.
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

    const existing = await tx.sharedDoc.findUnique({
      where: { environment_teamId_year_weekNum: { environment, teamId, year, weekNum } }
    });

    // 2) 최초 생성 — seed 경로만 허용한다. 잠긴 주차에는 만들지 않는다.
    if (!existing) {
      if (op !== 'seed') return { ok: false as const, reason: 'not-found' as const };

      const lock = await tx.summaryLock.findUnique({
        where: { teamId_year_weekNum: { teamId, year, weekNum } },
        select: { isLocked: true, isClosed: true }
      });
      // 작성마감·취합완료 주차에는 새 문서를 만들지 않는다. 입력이 끝난 주차에
      // 빈 문서가 생기면 팀장이 정리 중인 취합본과 어긋난다.
      if (lock?.isLocked || lock?.isClosed) return { ok: false as const, reason: 'locked' as const };

      const doc = new Y.Doc();
      Y.applyUpdate(doc, update);
      const created = await tx.sharedDoc.create({
        data: {
          environment, teamId, year, weekNum,
          ydoc: Buffer.from(Y.encodeStateAsUpdate(doc)),
          contents: materializeToJson(doc),
          seedId: seedId ?? '',
          seededFrom,
          revision: 1
        }
      });
      // seed 는 미러하지 않는다. 새로 만든 문서(이월분 또는 빈 문서)로 기존 SummaryData 를
      // 덮으면 그 주차의 확정 취합본이 사라진다. 미러는 실제 편집이 반영될 때만 의미가 있다.
      // (백필은 runBackfill 이 별도 규칙으로 처리한다)
      await touchActivity(tx, environment, teamId, year, weekNum, dirtyUserIds);
      await tx.persistReceipt.create({
        data: {
          requestId: scopedRequestId, revision: created.revision,
          docGeneration: created.docGeneration, writeEpoch: created.writeEpoch
        }
      });
      await writeSnapshot(tx, created.id, created.ydoc, created.docGeneration, created.revision, 'interval');
      await sweepReceipts(tx);
      return {
        ok: true as const,
        revision: created.revision,
        docGeneration: created.docGeneration,
        writeEpoch: created.writeEpoch
      };
    }

    // 2-b) 이미 문서가 있는데 seed 로 들어온 경우.
    //      그대로 두면 잠금·세대 게이트를 모두 건너뛰고 병합으로 떨어져 재시드 가드가 무력화된다.
    if (op === 'seed') {
      // 같은 세대의 재시드(네트워크 재시도)면 성공으로 간주하고 아무것도 하지 않는다
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

    // 3) 일반 저장의 게이트 — 잠금과 세대를 트랜잭션 안에서 확인한다.
    //    WebSocket 의 isReadOnly 는 /save 직접 호출을 막지 못하므로 여기가 최종 방어선이다.
    const lock = await tx.summaryLock.findUnique({
      where: { teamId_year_weekNum: { teamId, year, weekNum } },
      select: { isLocked: true, isClosed: true }
    });

    if (op === 'normal') {
      // 작성마감도 잠금과 똑같이 팀원 저장을 막는다. 여기가 뚫리면 팀장이 취합본을
      // 정리하는 동안 룸의 늦은 저장이 들어와, 정리한 내용을 되돌려버린다.
      if (lock?.isLocked || lock?.isClosed) return { ok: false as const, reason: 'locked' as const, revision: existing.revision };

      // '<' 가 아니라 '!==' — 클라이언트가 더 큰 값을 보내 통과시키는 것도 막는다
      if (input.docGeneration !== undefined && input.docGeneration !== existing.docGeneration) {
        return { ok: false as const, reason: 'generation-mismatch' as const, revision: existing.revision };
      }
      if (input.writeEpoch !== undefined && input.writeEpoch !== existing.writeEpoch) {
        return { ok: false as const, reason: 'epoch-mismatch' as const, revision: existing.revision };
      }
    }

    // 4) 문서 재구성.
    //    restore 는 **병합이 아니라 치환**이다 — Yjs update 는 가산적이라 기존 상태에 얹으면
    //    삭제가 되돌아오지 않는다. 스냅샷 바이트만으로 문서를 새로 만든다.
    const doc = new Y.Doc();
    if (op !== 'restore') Y.applyUpdate(doc, new Uint8Array(existing.ydoc));
    Y.applyUpdate(doc, update);

    const ydoc = Buffer.from(Y.encodeStateAsUpdate(doc));
    const contents = materializeToJson(doc);
    const nextRevision = existing.revision + 1;

    const updated = await tx.sharedDoc.update({
      where: { id: existing.id },
      data: {
        ydoc,
        contents,
        revision: nextRevision,
        // 잠금 확정과 복원은 세대를 올려 구세대의 늦은 저장을 밀어낸다
        ...(op === 'lock-finalize' ? { writeEpoch: existing.writeEpoch + 1 } : {}),
        ...(op === 'restore' ? { docGeneration: existing.docGeneration + 1, writeEpoch: 1 } : {})
      }
    });

    await mirrorSummary(tx, environment, teamId, year, weekNum, contents, lock?.isLocked === true, op);
    await touchActivity(tx, environment, teamId, year, weekNum, dirtyUserIds);
    await tx.persistReceipt.create({
      data: {
        requestId: scopedRequestId, revision: nextRevision,
        docGeneration: updated.docGeneration, writeEpoch: updated.writeEpoch
      }
    });
    await maybeSnapshot(tx, updated.id, ydoc, updated.docGeneration, nextRevision, snapshotReason);
    await sweepReceipts(tx);

    return {
      ok: true as const,
      revision: nextRevision,
      docGeneration: updated.docGeneration,
      writeEpoch: updated.writeEpoch
    };
  }, { timeout: 20_000 });
}

/**
 * SummaryData 미러 — 전환 기간 롤백 경로를 살려두기 위해 같은 트랜잭션에서 함께 쓴다.
 *
 * 두 가지를 반드시 지켜야 한다.
 *  1. 운영 환경에서만 쓴다. SummaryData 에는 environment 컬럼이 없어서, 프리뷰/개발이 미러를 쓰면
 *     운영 취합본을 덮어쓴다(SharedDoc 은 environment 로 갈리지만 미러는 안 갈린다).
 *  2. 잠긴 주차는 건드리지 않는다. 잠금 확정(lock-finalize)만 예외로 최종본을 기록한다.
 */
async function mirrorSummary(
  tx: Tx, environment: string, teamId: number, year: number, weekNum: number,
  contents: string, isLocked: boolean, op: PersistOp
) {
  if (environment !== PRODUCTION_ENV) return;
  if (isLocked && op !== 'lock-finalize') return;

  await tx.summaryData.upsert({
    where: { teamId_year_weekNum: { teamId, year, weekNum } },
    update: { contents },
    create: { teamId, year, weekNum, contents }
  });
}

/**
 * 실제 편집자 기록. 이월 시드만으로 "작성함"이 되지 않도록 authorId 스캔이 아니라
 * Worker 가 연결에서 누적해 보낸 dirtyUserIds 를 쓴다.
 */
async function touchActivity(
  tx: Tx, environment: string, teamId: number, year: number, weekNum: number, userIds: number[]
) {
  if (!userIds.length) return;
  // 존재하는 사용자만 남긴다 — 삭제된 id 가 섞이면 FK 위반으로 본문 저장까지 롤백된다.
  // 작성 현황은 부가 지표이므로 본질 데이터(ydoc/contents)를 막아서는 안 된다.
  const alive = await tx.user.findMany({
    where: { id: { in: [...new Set(userIds)] } },
    select: { id: true }
  });
  if (!alive.length) return;
  const now = new Date();
  for (const { id: userId } of alive) {
    await tx.docActivity.upsert({
      where: { environment_teamId_year_weekNum_userId: { environment, teamId, year, weekNum, userId } },
      update: { lastEditedAt: now },
      create: { environment, teamId, year, weekNum, userId, lastEditedAt: now }
    });
  }
}

async function writeSnapshot(
  tx: Tx, docId: number, ydoc: Buffer, docGeneration: number, revision: number, reason: string
) {
  await tx.sharedDocSnapshot.create({ data: { docId, ydoc, docGeneration, revision, reason } });
}

/**
 * 오래된 영수증 정리. 저장 경로를 느리게 하지 않으려고 확률적으로만 수행한다.
 * 트랜잭션 안에서 돌지만 대상이 인덱스(createdAt)로 좁혀져 부담이 작다.
 */
async function sweepReceipts(tx: Tx) {
  if (Math.random() > RECEIPT_SWEEP_PROBABILITY) return;
  await tx.persistReceipt.deleteMany({
    where: { createdAt: { lt: new Date(Date.now() - RECEIPT_TTL_MS) } }
  });
}

/** 사건 스냅샷은 항상, 간격 스냅샷은 마지막 이후 SNAPSHOT_INTERVAL_MS 지났을 때만 */
async function maybeSnapshot(
  tx: Tx, docId: number, ydoc: Buffer, docGeneration: number, revision: number,
  reason?: 'lock' | 'bulk-delete' | 'pre-restore'
) {
  if (reason) {
    await writeSnapshot(tx, docId, ydoc, docGeneration, revision, reason);
    return;
  }
  const last = await tx.sharedDocSnapshot.findFirst({
    where: { docId, reason: 'interval' },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true }
  });
  if (last && Date.now() - last.createdAt.getTime() < SNAPSHOT_INTERVAL_MS) return;

  await writeSnapshot(tx, docId, ydoc, docGeneration, revision, 'interval');

  // 링버퍼 — interval 만 정리한다. 사건 스냅샷(lock 등)은 보존한다.
  const olds = await tx.sharedDocSnapshot.findMany({
    where: { docId, reason: 'interval' },
    orderBy: { createdAt: 'desc' },
    skip: INTERVAL_SNAPSHOT_KEEP,
    select: { id: true }
  });
  if (olds.length) {
    await tx.sharedDocSnapshot.deleteMany({ where: { id: { in: olds.map((o: { id: number }) => o.id) } } });
  }
}

/** 팀·주차가 공동 편집 대상인지 — 컷오버는 팀·주차 단위다 */
export { isCollabWeek, type TeamCollabRange } from '../collabWeek';

/**
 * 서버가 쓰는 환경 이름 — 프리뷰가 운영 문서를 건드리지 않게 하는 방어선.
 *
 * VERCEL_ENV 는 모든 프리뷰 배포에서 똑같이 'preview' 라, 브랜치가 여럿이면 서로 다른 프리뷰가
 * 같은 SharedDoc 행을 공유해 서로의 문서를 편집하게 된다. 브랜치까지 붙여 갈라준다.
 */
export function currentEnvironment(): string {
  const raw = (() => {
    if (process.env.REALTIME_ENV) return process.env.REALTIME_ENV;
    const vercel = process.env.VERCEL_ENV;
    if (!vercel) return 'development';
    if (vercel !== 'preview') return vercel;
    const branch = process.env.VERCEL_GIT_COMMIT_REF;
    return branch ? `preview-${branch}` : 'preview';
  })();
  // 룸 이름에 그대로 들어가므로 여기서 정규화한다.
  // roomName() 이 뒤늦게 치환하면 토큰의 env 와 룸의 env 가 달라져 접속이 전부 막힌다.
  return raw.replace(/[^a-zA-Z0-9_-]/g, '_');
}

