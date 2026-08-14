import { NextResponse } from 'next/server';
import * as Y from 'yjs';
import { prisma } from '@/lib/db';
import { currentEnvironment, isCollabWeek, persistUpdate, PRODUCTION_ENV } from '@/lib/realtime/persist';
import { buildDocFromState, type EditorState } from '@/lib/realtime/buildDoc';
import { materializeToJson } from '@/lib/realtime/materialize';
import { roomName } from '@/lib/realtime/token';
import { announceGeneration } from '@/lib/realtime/roomControl';
import { summaryStage, masterCanEditSummary } from '@/lib/summaryStage';
import { requireTeamMaster, currentUserId, unauthorized } from '@/lib/auth';

/** 취합본 JSON 안의 블록 수 — "비었는가" 판단에만 쓴다 */
function blockCount(state: EditorState | null): number {
  if (!state) return 0;
  let n = 0;
  for (const cat of Object.values(state)) {
    n += (Array.isArray(cat?.current) ? cat.current.length : 0);
    n += (Array.isArray(cat?.next) ? cat.next.length : 0);
  }
  return n;
}

function safeState(json: string): EditorState | null {
  try { return json ? JSON.parse(json) as EditorState : null; } catch { return null; }
}

export async function GET(request: Request) {
    const me = await currentUserId();
    if (!me) return unauthorized();
  const { searchParams } = new URL(request.url);
  const year = parseInt(searchParams.get('year') || '0');
  const weekNum = parseInt(searchParams.get('weekNum') || '0');
  const teamId = parseInt(searchParams.get('teamId') || '0');

  if (!teamId) return NextResponse.json({ error: 'teamId required' }, { status: 400 });

  try {
    const [summary, lock, team] = await Promise.all([
      prisma.summaryData.findUnique({ where: { teamId_year_weekNum: { teamId, year, weekNum } } }),
      prisma.summaryLock.findUnique({ where: { teamId_year_weekNum: { teamId, year, weekNum } } }),
      prisma.team.findUnique({
        where: { id: teamId },
        select: {
          collabFromYear: true, collabFromWeek: true,
          collabUntilYear: true, collabUntilWeek: true
        }
      })
    ]);
    const collab = !!team && isCollabWeek(team, year, weekNum);

    // 공동 편집 주차의 진실원본은 공유 문서다. SummaryData 는 그 미러인데
    // 운영 환경에서만 갱신되므로(미러 테이블에 environment 구분이 없다) 미러만 읽으면
    // 다른 환경에서 옛 내용이 보인다. 문서를 우선 읽고 없을 때만 미러로 떨어진다.
    let contents = summary?.contents || null;
    if (collab) {
      const doc = await prisma.sharedDoc.findUnique({
        where: {
          environment_teamId_year_weekNum: {
            environment: currentEnvironment(), teamId, year, weekNum
          }
        },
        select: { contents: true }
      });
      if (doc?.contents) contents = doc.contents;
    }

    return NextResponse.json({
      contents,
      collab,
      isLocked: lock?.isLocked ?? false,
      isClosed: lock?.isClosed ?? false,
      stage: summaryStage(lock),
      lockedBy: lock?.lockedBy ?? null,
      lockedAt: lock?.lockedAt ?? null
    });
  } catch (error) {
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const me = await currentUserId();
    if (!me) return unauthorized();
    const { year, weekNum, teamId, contents } = await request.json();
    if (!teamId) return NextResponse.json({ error: 'teamId required' }, { status: 400 });
    if (!await requireTeamMaster(me, teamId)) return NextResponse.json({ error: '권한이 필요합니다.' }, { status: 403 });

    const [lock, team] = await Promise.all([
      prisma.summaryLock.findUnique({ where: { teamId_year_weekNum: { teamId, year, weekNum } } }),
      prisma.team.findUnique({
        where: { id: teamId },
        select: {
          collabFromYear: true, collabFromWeek: true,
          collabUntilYear: true, collabUntilWeek: true
        }
      })
    ]);
    const collab = !!team && isCollabWeek(team, year, weekNum);

    if (lock?.isLocked) return NextResponse.json({ error: '취합완료 상태에서는 저장할 수 없습니다.' }, { status: 403 });

    // 공동 편집 주차는 작성마감 뒤에만 고칠 수 있다. 팀원 룸이 살아있는 동안 여기로 쓰면
    // 룸의 다음 저장(최대 6초)이 그대로 덮어써, 다듬은 내용이 조용히 사라진다.
    if (!masterCanEditSummary(lock, collab)) {
      return NextResponse.json(
        { error: '이 주차는 팀이 함께 작성하는 중입니다. [작성 마감] 후에 취합본을 정리할 수 있습니다.', collab: true },
        { status: 409 }
      );
    }

    if (!collab) {
      const result = await prisma.summaryData.upsert({
        where: { teamId_year_weekNum: { teamId, year, weekNum } },
        update: { contents, updatedAt: new Date() },
        create: { teamId, year, weekNum, contents }
      });
      return NextResponse.json({ success: true, id: result.id });
    }

    // ── 공동 편집 주차(작성마감): 취합본 편집을 공유 문서에 반영한다 ──────────
    //
    // 미러(SummaryData)만 고치면 문서와 갈린다. 다음 주 이월은 공유 문서를 읽으므로
    // 팀장이 다듬은 차주계획이 이월되지 않고, 마감을 취소해 팀원에게 다시 열어주면
    // 팀장의 정리가 통째로 사라진 것처럼 보인다.
    let state: EditorState;
    try {
      state = typeof contents === 'string' ? JSON.parse(contents) : contents;
      if (!state || typeof state !== 'object') throw new Error('bad state');
    } catch {
      return NextResponse.json({ error: '저장할 내용을 읽지 못했습니다.' }, { status: 400 });
    }

    const environment = currentEnvironment();
    // 미러(SummaryData)에는 environment 구분이 없다. 프리뷰/개발이 쓰면 운영 취합본을 덮어
    // overview·PDF·엑셀이 프리뷰 내용을 출력한다. persist.mirrorSummary 와 같은 방어선.
    const canMirror = environment === PRODUCTION_ENV;
    const existing = await prisma.sharedDoc.findUnique({
      where: { environment_teamId_year_weekNum: { environment, teamId, year, weekNum } },
      select: { id: true, ydoc: true, contents: true, docGeneration: true, revision: true, seedId: true }
    });
    const existingContents = existing?.contents ?? '';

    // 문서가 없는 주차(아무도 작성하지 않음)는 덮어쓸 대상이 없다. 미러만 남긴다.
    if (!existing) {
      if (!canMirror) {
        return NextResponse.json(
          { error: '이 환경에서는 취합본을 저장하지 않습니다(운영 취합본 보호).' },
          { status: 409 }
        );
      }
      const result = await prisma.summaryData.upsert({
        where: { teamId_year_weekNum: { teamId, year, weekNum } },
        update: { contents, updatedAt: new Date() },
        create: { teamId, year, weekNum, contents }
      });
      return NextResponse.json({ success: true, id: result.id });
    }

    // 빈 상태로 문서를 치환하지 않는다. 조회가 실패해 화면이 빈 채로 뜬 상태에서
    // [저장] 한 번이면 그 주차 팀 문서가 통째로 사라지고, 되돌릴 길은 스냅샷 수동 복원뿐이다.
    if (blockCount(state) === 0 && blockCount(safeState(existingContents)) > 0) {
      return NextResponse.json(
        { error: '내용이 비어 있어 저장하지 않았습니다. 화면을 새로고침한 뒤 다시 시도해주세요.' },
        { status: 409 }
      );
    }

    // 되돌릴 지점을 먼저 남긴다. 취합본 편집은 삭제·재정렬을 포함해 치환으로 들어가므로
    // 잘못 저장하면 이 스냅샷 말고는 되살릴 방법이 없다.
    await prisma.sharedDocSnapshot.create({
      data: {
        docId: existing.id, ydoc: existing.ydoc,
        docGeneration: existing.docGeneration, revision: existing.revision, reason: 'pre-restore'
      }
    });

    const nextGeneration = existing.docGeneration + 1;
    const doc = buildDocFromState(state, {
      teamId, year, weekNum,
      seedId: existing.seedId,
      docGeneration: nextGeneration,
      isLocked: false
    });
    const materialized = materializeToJson(doc);

    // restore 는 병합이 아니라 치환이다 — Yjs update 는 가산적이라 기존 상태에 얹으면
    // 팀장이 지운 항목이 되살아난다.
    const saved = await persistUpdate({
      environment, teamId, year, weekNum,
      update: Y.encodeStateAsUpdate(doc),
      requestId: crypto.randomUUID(),
      op: 'restore'
    });
    if (!saved.ok) {
      return NextResponse.json(
        { error: saved.reason === 'busy' ? '다른 저장이 진행 중입니다. 잠시 후 다시 시도해주세요.' : '저장하지 못했습니다.' },
        { status: 409 }
      );
    }

    // 미러는 문서와 같은 내용으로 맞춘다. persistUpdate 의 미러와 같은 값이라 중복은 무해하고,
    // 같은 이유(미러에 environment 가 없다)로 운영에서만 쓴다.
    const result = canMirror
      ? await prisma.summaryData.upsert({
          where: { teamId_year_weekNum: { teamId, year, weekNum } },
          update: { contents: materialized, updatedAt: new Date() },
          create: { teamId, year, weekNum, contents: materialized }
        })
      : null;

    // 구세대 룸에 남아있는 접속자를 끊어 새 내용으로 다시 붙게 한다.
    await announceGeneration(
      roomName(environment, teamId, year, weekNum, existing.docGeneration),
      saved.docGeneration
    );

    return NextResponse.json({ success: true, id: result?.id ?? null, revision: saved.revision, docGeneration: saved.docGeneration });
  } catch (error) {
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
