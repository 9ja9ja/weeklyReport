import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireTeamMaster, currentUserId, unauthorized } from '@/lib/auth';
import { currentEnvironment, isCollabWeek } from '@/lib/realtime/persist';
import { roomName } from '@/lib/realtime/token';
import { freezeRoomForLock, announceLocked, announceUnlocked, unfreezeRoom } from '@/lib/realtime/roomControl';

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
            lockedAt: l?.lockedAt ?? null,
            lockedByName: l?.lockedBy != null ? userMap.get(l.lockedBy) ?? null : null
          };
        })
      );
    } catch {
      return NextResponse.json({ error: 'Failed' }, { status: 500 });
    }
  }

  if (!teamId) return NextResponse.json({ isLocked: false });

  try {
    const lock = await prisma.summaryLock.findUnique({
      where: { teamId_year_weekNum: { teamId, year, weekNum } }
    });
    return NextResponse.json({ isLocked: lock?.isLocked ?? false, lockedBy: lock?.lockedBy ?? null, lockedAt: lock?.lockedAt ?? null });
  } catch {
    return NextResponse.json({ isLocked: false });
  }
}

export async function POST(request: Request) {
  try {
    const me = await currentUserId();
    if (!me) return unauthorized();
    const { year, weekNum, teamId, isLocked } = await request.json();
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

    // 공동 편집 주차가 아니면 기존 동작 그대로 (개인 Report 모드)
    if (!collab) {
      const result = await prisma.summaryLock.upsert({
        where: { teamId_year_weekNum: { teamId, year, weekNum } },
        update: { isLocked, lockedBy: isLocked ? me : null, lockedAt: isLocked ? new Date() : null },
        create: { teamId, year, weekNum, isLocked, lockedBy: isLocked ? me : null, lockedAt: isLocked ? new Date() : null }
      });
      return NextResponse.json({ success: true, isLocked: result.isLocked });
    }

    // ── 공동 편집 주차: freeze → 최종 반영 → 커밋 → 방송 ──────────
    //
    // 잠금은 Cloudflare(룸)와 Neon(DB)에 걸친 분산 작업이라 순서만으로는 원자성이 없다.
    // freeze 로 새 편집을 막고, 그 시점 상태를 확정한 뒤 커밋한다.
    const environment = currentEnvironment();
    const doc = await prisma.sharedDoc.findUnique({
      where: { environment_teamId_year_weekNum: { environment, teamId, year, weekNum } },
      select: { docGeneration: true, writeEpoch: true }
    });
    const room = doc ? roomName(environment, teamId, year, weekNum, doc.docGeneration) : null;

    let froze = false;
    if (isLocked && room) {
      const r = await freezeRoomForLock(room);
      froze = r.ok;
      // freeze 는 됐는데 최종 저장이 실패했다면 잠그면 안 된다 —
      // 확정본에 마지막 편집이 빠진 채로 굳고, 그 편집은 되살릴 방법이 없다.
      const saved = (r.body as { saved?: boolean } | undefined)?.saved;
      if (r.ok && saved === false) {
        await unfreezeRoom(room);
        return NextResponse.json(
          { error: '마지막 편집을 저장하지 못해 잠글 수 없습니다. 잠시 후 다시 시도해주세요.' },
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
          update: { isLocked, lockedBy: isLocked ? me : null, lockedAt: isLocked ? new Date() : null },
          create: { teamId, year, weekNum, isLocked, lockedBy: isLocked ? me : null, lockedAt: isLocked ? new Date() : null }
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

    // 실제 커밋된 값만 방송한다
    if (room && committed.writeEpoch != null) {
      if (isLocked) await announceLocked(room, committed.writeEpoch);
      else await announceUnlocked(room, committed.writeEpoch);
    }

    return NextResponse.json({
      success: true,
      isLocked: committed.lock.isLocked,
      ...(committed.writeEpoch != null ? { writeEpoch: committed.writeEpoch } : {})
    });
  } catch (error) {
    return NextResponse.json({ error: '실패' }, { status: 500 });
  }
}
