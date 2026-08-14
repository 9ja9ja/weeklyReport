import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireTeamMaster, currentUserId, unauthorized } from '@/lib/auth';
import { currentEnvironment, isCollabWeek } from '@/lib/realtime/persist';
import { roomName } from '@/lib/realtime/token';
import { freezeRoomForLock, announceLocked, announceUnlocked, unfreezeRoom } from '@/lib/realtime/roomControl';
import { summaryStage, membersCanWrite, STAGE_LABEL, type SummaryStage } from '@/lib/summaryStage';

export async function GET(request: Request) {
    const me = await currentUserId();
    if (!me) return unauthorized();
  const { searchParams } = new URL(request.url);
  const year = parseInt(searchParams.get('year') || '0');
  const weekNum = parseInt(searchParams.get('weekNum') || '0');
  const teamId = parseInt(searchParams.get('teamId') || '0');
  const all = searchParams.get('all') === 'true';

  // 전체 팀 잠금 현황판
  if (all) {
    try {
      const [teams, locks] = await Promise.all([
        prisma.team.findMany({ orderBy: { orderIdx: 'asc' }, select: { id: true, name: true, division: true } }),
        prisma.summaryLock.findMany({ where: { year, weekNum } })
      ]);
      const lockMap = new Map(locks.map(l => [l.teamId, l]));
      const lockedByIds = locks.map(l => l.lockedBy).filter((v): v is number => v != null);
      const users = lockedByIds.length > 0
        ? await prisma.user.findMany({ where: { id: { in: lockedByIds } }, select: { id: true, name: true } })
        : [];
      const userMap = new Map(users.map(u => [u.id, u.name]));

      return NextResponse.json(
        teams.map(t => {
          const l = lockMap.get(t.id);
          return {
            teamId: t.id,
            teamName: t.name,
            division: t.division,
            isLocked: l?.isLocked ?? false,
            isClosed: l?.isClosed ?? false,
            stage: summaryStage(l),
            lockedAt: l?.lockedAt ?? null,
            lockedByName: l?.lockedBy != null ? userMap.get(l.lockedBy) ?? null : null
          };
        })
      );
    } catch {
      return NextResponse.json({ error: 'Failed' }, { status: 500 });
    }
  }

  if (!teamId) return NextResponse.json({ isLocked: false, isClosed: false, stage: 'open' });

  try {
    const lock = await prisma.summaryLock.findUnique({
      where: { teamId_year_weekNum: { teamId, year, weekNum } }
    });
    return NextResponse.json({
      isLocked: lock?.isLocked ?? false,
      isClosed: lock?.isClosed ?? false,
      stage: summaryStage(lock),
      lockedBy: lock?.lockedBy ?? null,
      lockedAt: lock?.lockedAt ?? null,
      closedAt: lock?.closedAt ?? null
    });
  } catch {
    return NextResponse.json({ isLocked: false, isClosed: false, stage: 'open' });
  }
}

/**
 * 단계 전환 — 작성중 ↔ 작성마감 ↔ 취합완료.
 *
 * 새 화면은 `{ stage }` 로 목표 단계를 보낸다. 예전 `{ isLocked }` 도 계속 받는다
 * (공동 편집 주차에서 취합완료를 풀면 작성중이 아니라 작성마감으로 돌아간다 —
 *  팀원 입력을 다시 열지 말지는 별도 판단이라 자동으로 열지 않는다).
 */
export async function POST(request: Request) {
  try {
    const me = await currentUserId();
    if (!me) return unauthorized();
    const body = await request.json();
    const { year, weekNum, teamId } = body as { year: number; weekNum: number; teamId: number };
    if (!teamId) return NextResponse.json({ error: 'teamId required' }, { status: 400 });
    if (!await requireTeamMaster(me, teamId)) return NextResponse.json({ error: '권한이 필요합니다.' }, { status: 403 });

    const team = await prisma.team.findUnique({
      where: { id: teamId },
      select: {
        collabFromYear: true, collabFromWeek: true,
        collabUntilYear: true, collabUntilWeek: true
      }
    });
    const collab = !!team && isCollabWeek(team, year, weekNum);

    const current = await prisma.summaryLock.findUnique({
      where: { teamId_year_weekNum: { teamId, year, weekNum } },
      select: { isLocked: true, isClosed: true }
    });

    const target = resolveTarget(body, collab, current);
    if (!target.ok) return NextResponse.json({ error: target.error }, { status: 400 });
    const stage = target.stage;

    const isLocked = stage === 'locked';
    // 취합완료는 작성마감을 지나온 상태다. 풀었을 때 작성중으로 튀지 않게 함께 세운다.
    const isClosed = collab && stage !== 'open';
    const now = new Date();
    const data = {
      isLocked, lockedBy: isLocked ? me : null, lockedAt: isLocked ? now : null,
      isClosed, closedBy: isClosed ? me : null, closedAt: isClosed ? now : null
    };

    // 공동 편집 주차가 아니면 룸이 없다 — 기존 동작 그대로 (개인 Report 모드)
    if (!collab) {
      const result = await prisma.summaryLock.upsert({
        where: { teamId_year_weekNum: { teamId, year, weekNum } },
        update: data,
        create: { teamId, year, weekNum, ...data }
      });
      return NextResponse.json({ success: true, isLocked: result.isLocked, isClosed: result.isClosed, stage: summaryStage(result) });
    }

    // ── 공동 편집 주차: freeze → 최종 반영 → 커밋 → 방송 ──────────
    //
    // 단계 전환은 Cloudflare(룸)와 Neon(DB)에 걸친 분산 작업이라 순서만으로는 원자성이 없다.
    // freeze 로 새 편집을 막고, 그 시점 상태를 확정한 뒤 커밋한다.
    const environment = currentEnvironment();
    const doc = await prisma.sharedDoc.findUnique({
      where: { environment_teamId_year_weekNum: { environment, teamId, year, weekNum } },
      select: { docGeneration: true, writeEpoch: true }
    });
    const room = doc ? roomName(environment, teamId, year, weekNum, doc.docGeneration) : null;

    // 쓸 수 있던 주차를 닫을 때만 얼린다. 마지막 편집을 확정본에 담아야 하기 때문이다.
    const closingWrites = membersCanWrite(current) && !membersCanWrite({ isLocked, isClosed });

    let froze = false;
    if (closingWrites && room) {
      const r = await freezeRoomForLock(room);
      froze = r.ok;
      // freeze 는 됐는데 최종 저장이 실패했다면 닫으면 안 된다 —
      // 확정본에 마지막 편집이 빠진 채로 굳고, 그 편집은 되살릴 방법이 없다.
      const saved = (r.body as { saved?: boolean } | undefined)?.saved;
      if (r.ok && saved === false) {
        await unfreezeRoom(room);
        return NextResponse.json(
          { error: `마지막 편집을 저장하지 못해 ${STAGE_LABEL[stage]} 처리할 수 없습니다. 잠시 후 다시 시도해주세요.` },
          { status: 503 }
        );
      }
      // r.ok === false 는 룸이 없거나 Worker 미배포인 경우다. DB 가 진실원본이므로 진행한다.
    }

    let committed;
    try {
      committed = await prisma.$transaction(async tx => {
        const lock = await tx.summaryLock.upsert({
          where: { teamId_year_weekNum: { teamId, year, weekNum } },
          update: data,
          create: { teamId, year, weekNum, ...data }
        });
        // 세대를 올려 구 epoch 를 든 늦은 저장을 밀어낸다.
        // updateMany 는 새 값을 돌려주지 않으므로 update 로 실제 값을 받는다 —
        // 추측한 epoch 을 룸에 심으면 이후 저장이 전부 거부된다.
        const bumped = doc
          ? await tx.sharedDoc.update({
              where: { environment_teamId_year_weekNum: { environment, teamId, year, weekNum } },
              data: { writeEpoch: { increment: 1 } },
              select: { writeEpoch: true }
            })
          : null;
        return { lock, writeEpoch: bumped?.writeEpoch ?? null };
      });
    } catch (e) {
      // 커밋이 실패했는데 freeze 를 풀지 않으면 그 룸은 아무도 편집할 수 없게 된다.
      if (froze && room) await unfreezeRoom(room);
      throw e;
    }

    // 실제 커밋된 값만 방송한다. 팀원 화면의 읽기전용 여부는 단계가 정한다 —
    // 작성마감과 취합완료 모두 룸에는 '잠김'으로 알린다(둘 다 팀원은 못 쓴다).
    if (room && committed.writeEpoch != null) {
      if (membersCanWrite(committed.lock)) await announceUnlocked(room, committed.writeEpoch);
      else await announceLocked(room, committed.writeEpoch);
    }

    return NextResponse.json({
      success: true,
      isLocked: committed.lock.isLocked,
      isClosed: committed.lock.isClosed,
      stage: summaryStage(committed.lock),
      ...(committed.writeEpoch != null ? { writeEpoch: committed.writeEpoch } : {})
    });
  } catch (error) {
    return NextResponse.json({ error: '실패' }, { status: 500 });
  }
}

type TargetResult = { ok: true; stage: SummaryStage } | { ok: false; error: string };

/** 요청 본문 → 목표 단계. 예전 `{ isLocked }` 형태도 받는다. */
function resolveTarget(
  body: { stage?: unknown; isLocked?: unknown },
  collab: boolean,
  current: { isLocked: boolean; isClosed: boolean } | null
): TargetResult {
  if (typeof body.stage === 'string') {
    const stage = body.stage as SummaryStage;
    if (stage !== 'open' && stage !== 'closed' && stage !== 'locked') {
      return { ok: false, error: '알 수 없는 단계입니다.' };
    }
    // 개인 작성 주차에는 작성마감 단계가 없다. 룸이 없어 팀원 입력을 따로 멈출 필요가 없다.
    if (stage === 'closed' && !collab) {
      return { ok: false, error: '이 주차는 공동 편집이 아니라 작성마감 단계가 없습니다.' };
    }
    return { ok: true, stage };
  }
  if (typeof body.isLocked === 'boolean') {
    if (body.isLocked) return { ok: true, stage: 'locked' };
    // 공동 편집 주차의 취합완료 해제는 작성마감으로 돌아간다.
    // 곧바로 작성중이 되면 팀원이 다시 쓰기 시작해, 풀자마자 취합본이 흔들린다.
    return { ok: true, stage: collab && current?.isClosed ? 'closed' : 'open' };
  }
  return { ok: false, error: '변경할 단계를 지정해주세요.' };
}
