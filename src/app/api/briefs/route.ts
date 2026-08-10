import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { currentUserId, unauthorized, forbidden, requireMasterOrAbove, requireOverviewAccess } from '@/lib/auth';
import { currentEnvironment } from '@/lib/realtime/persist';
import { briefRoomName } from '@/lib/realtime/token';
import { freezeRoomForLock, announceLocked, announceUnlocked, unfreezeRoom } from '@/lib/realtime/roomControl';
import { isBriefCollabWeek } from '@/lib/realtime/briefCutover';

/**
 * 이 주차가 실시간 공동 편집으로 넘어갔는지.
 *
 * BriefDoc 행의 존재 자체가 전환 스위치다. 롤백은 그 행을 지우면 되고,
 * 본문은 매 저장마다 Brief 로 미러링되므로 지워도 내용이 남는다.
 */
async function realtimeDoc(year: number, weekNum: number) {
  // 컷오버가 꺼져 있으면 문서가 남아 있어도 실시간으로 취급하지 않는다.
  // 그래야 환경변수를 지우는 것만으로 기존 저장 경로가 되살아난다.
  if (!isBriefCollabWeek(year, weekNum)) return null;
  return prisma.briefDoc.findUnique({
    where: { environment_year_weekNum: { environment: currentEnvironment(), year, weekNum } },
    select: { id: true, docGeneration: true, writeEpoch: true }
  });
}

export async function GET(req: NextRequest) {
  const uid = await currentUserId();
  if (!uid) return unauthorized();
  if (!(await requireOverviewAccess(uid))) return forbidden('조회 권한이 없습니다.');

  const { searchParams } = req.nextUrl;
  const year = parseInt(searchParams.get('year') || '');
  const weekNum = parseInt(searchParams.get('weekNum') || '');
  if (!year || !weekNum) return NextResponse.json({ error: '연도와 주차가 필요합니다.' }, { status: 400 });

  const brief = await prisma.brief.findUnique({ where: { year_weekNum: { year, weekNum } } });
  return NextResponse.json({ brief });
}

export async function POST(req: NextRequest) {
  const uid = await currentUserId();
  if (!uid) return unauthorized();
  if (!(await requireMasterOrAbove(uid))) return forbidden('관리자 이상만 작성할 수 있습니다.');

  const { year, weekNum, title, content } = await req.json();
  if (!year || !weekNum) return NextResponse.json({ error: '연도와 주차가 필요합니다.' }, { status: 400 });

  // 실시간 문서가 있는 주차는 이 경로로 저장하지 않는다.
  // 오래 열어둔 탭이 실시간 편집분을 통째로 덮어쓰는 사고를 막는다.
  if (await realtimeDoc(year, weekNum)) {
    return NextResponse.json(
      { error: '이 주차는 공동 편집으로 전환되었습니다. 새로고침 후 편집해주세요.', realtime: true },
      { status: 409 }
    );
  }

  const existing = await prisma.brief.findUnique({ where: { year_weekNum: { year, weekNum } } });
  if (existing?.isLocked) return NextResponse.json({ error: '잠금된 요약본은 수정할 수 없습니다.' }, { status: 403 });

  const brief = await prisma.brief.upsert({
    where: { year_weekNum: { year, weekNum } },
    update: { title: title ?? '', content: content ?? '', updatedAt: new Date() },
    create: { year, weekNum, title: title ?? '', content: content ?? '', createdBy: uid }
  });

  return NextResponse.json({ brief });
}

export async function PATCH(req: NextRequest) {
  const uid = await currentUserId();
  if (!uid) return unauthorized();
  if (!(await requireMasterOrAbove(uid))) return forbidden('관리자 이상만 잠금 처리할 수 있습니다.');

  const { year, weekNum, isLocked } = await req.json();
  if (!year || !weekNum) return NextResponse.json({ error: '연도와 주차가 필요합니다.' }, { status: 400 });

  const doc = await realtimeDoc(year, weekNum);
  const room = doc ? briefRoomName(currentEnvironment(), year, weekNum, doc.docGeneration) : null;

  // 잠금 확정: freeze → 최종 저장 → 커밋 → 방송.
  // freeze 없이 커밋하면 그 사이 도착한 편집이 확정본에서 빠지고,
  // 커밋 전에 방송하면 커밋 실패 시 사용자만 잠긴 줄 안다.
  if (room && isLocked) {
    const frozen = await freezeRoomForLock(room);
    // freeze 응답의 saved 까지 봐야 한다. 명령은 받았지만 최종 저장이 실패했다면
    // 확정본에 마지막 편집이 빠진 채로 굳고, 그 편집은 되살릴 방법이 없다.
    const saved = (frozen.body as { saved?: boolean } | undefined)?.saved;
    if (!frozen.ok || saved === false) {
      await unfreezeRoom(room);
      return NextResponse.json(
        { error: '마지막 편집을 저장하지 못해 잠금을 중단했습니다. 잠시 후 다시 시도해주세요.' },
        { status: 503 }
      );
    }
  }

  // 잠금 상태와 fencing 을 한 트랜잭션으로 묶는다.
  // 따로 쓰면 중간에 실패했을 때 "DB 는 잠겼는데 룸은 모르는" 상태가 남는다.
  let brief;
  let bumped: { writeEpoch: number; docGeneration: number } | null = null;
  try {
    [brief, bumped] = await prisma.$transaction(async tx => {
      const b = await tx.brief.upsert({
        where: { year_weekNum: { year, weekNum } },
        update: {
          isLocked: !!isLocked,
          lockedBy: isLocked ? uid : null,
          lockedAt: isLocked ? new Date() : null
        },
        create: {
          year, weekNum, title: '', content: '',
          isLocked: !!isLocked,
          lockedBy: isLocked ? uid : null,
          lockedAt: isLocked ? new Date() : null,
          createdBy: uid
        }
      });
      // writeEpoch 를 올려 구 epoch 로 날아오는 늦은 저장을 fencing 으로 거부한다.
      const e = doc
        ? await tx.briefDoc.update({
            where: { id: doc.id },
            data: { writeEpoch: { increment: 1 } },
            select: { writeEpoch: true, docGeneration: true }
          })
        : null;
      return [b, e] as const;
    });
  } catch (e) {
    // 커밋이 안 됐으므로 잠기지 않았다. freeze 를 풀어 편집을 되돌려준다.
    if (room && isLocked) await unfreezeRoom(room);
    return NextResponse.json({ error: '잠금 상태를 저장하지 못했습니다.', detail: String(e) }, { status: 500 });
  }

  if (room && bumped) {
    if (isLocked) await announceLocked(room, bumped.writeEpoch);
    else {
      await announceUnlocked(room, bumped.writeEpoch);
      await unfreezeRoom(room);
    }
  }

  return NextResponse.json({ brief });
}
