import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireOverviewAccess } from '@/lib/auth';
import type { ContentBlock } from '@/lib/reportBlocks';

type CateData = { current: ContentBlock[]; next: ContentBlock[] };
type EditorState = Record<number, CateData>;

function safeParse(str: string | null | undefined): EditorState {
  if (!str) return {};
  try {
    const v = JSON.parse(str);
    return v && typeof v === 'object' ? (v as EditorState) : {};
  } catch {
    return {};
  }
}

function safeParseBlocks(str: string): ContentBlock[] {
  try {
    const v = typeof str === 'string' ? JSON.parse(str) : str;
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/**
 * GET /api/overview?year=2026&weekNum=30&requestUserId=1
 *
 * 전체 팀의 주간보고를 구분 > 팀 > 파트 > 대분류 > 중분류 계층으로 반환한다.
 * 취합본(SummaryData)이 있으면 그것을, 없으면 개별 보고를 합쳐서 채운다.
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const year = parseInt(searchParams.get('year') || '0');
    const weekNum = parseInt(searchParams.get('weekNum') || '0');
    const requestUserId = parseInt(searchParams.get('requestUserId') || '0');

    if (!year || !weekNum) return NextResponse.json({ error: 'year, weekNum required' }, { status: 400 });
    if (!(await requireOverviewAccess(requestUserId))) {
      return NextResponse.json({ error: '전체 취합본 조회 권한이 없습니다.' }, { status: 403 });
    }

    const [teams, summaries, locks, reports] = await Promise.all([
      prisma.team.findMany({
        orderBy: { orderIdx: 'asc' },
        include: {
          parts: {
            where: { isActive: true },
            orderBy: { orderIdx: 'asc' },
            include: {
              majorCategories: { where: { isActive: true }, orderBy: { orderIdx: 'asc' } },
              categories: { where: { isActive: true }, orderBy: { orderIdx: 'asc' } }
            }
          }
        }
      }),
      prisma.summaryData.findMany({ where: { year, weekNum } }),
      prisma.summaryLock.findMany({ where: { year, weekNum } }),
      prisma.report.findMany({
        where: { year, weekNum },
        include: { user: { select: { name: true } }, items: { include: { category: { select: { teamId: true } } } } }
      })
    ]);

    const summaryMap = new Map(summaries.map(s => [s.teamId, safeParse(s.contents)]));
    const lockMap = new Map(locks.map(l => [l.teamId, l]));

    // 취합본이 없는 팀은 개별 보고를 합쳐서 만든다 (항목이 속한 팀 기준)
    const fallback = new Map<number, EditorState>();
    reports.forEach(rep => {
      rep.items.forEach(item => {
        const tid = item.category.teamId;
        if (summaryMap.has(tid)) return; // 취합본이 있으면 건너뜀
        if (!fallback.has(tid)) fallback.set(tid, {});
        const state = fallback.get(tid)!;
        if (!state[item.categoryId]) state[item.categoryId] = { current: [], next: [] };
        safeParseBlocks(item.currentContents).forEach(b =>
          state[item.categoryId].current.push({ ...b, authorText: b.authorText || rep.user.name })
        );
        safeParseBlocks(item.nextContents).forEach(b =>
          state[item.categoryId].next.push({ ...b, authorText: b.authorText || rep.user.name })
        );
      });
    });

    const result = teams.map(team => {
      const data = summaryMap.get(team.id) ?? fallback.get(team.id) ?? {};
      const lock = lockMap.get(team.id);

      const parts = team.parts.map(p => ({
        id: p.id,
        name: p.name,
        majors: p.majorCategories.map(m => ({
          id: m.id,
          name: m.name,
          categories: p.categories
            .filter(c => c.major === m.name)
            .map(c => ({
              id: c.id,
              middle: c.middle,
              current: data[c.id]?.current ?? [],
              next: data[c.id]?.next ?? []
            }))
        }))
      }));

      const filled = parts.some(p =>
        p.majors.some(m => m.categories.some(c => c.current.length > 0 || c.next.length > 0))
      );

      return {
        id: team.id,
        name: team.name,
        division: team.division,
        isLocked: lock?.isLocked ?? false,
        lockedAt: lock?.lockedAt ?? null,
        hasSummary: summaryMap.has(team.id),
        hasContent: filled,
        parts
      };
    });

    return NextResponse.json({ year, weekNum, teams: result });
  } catch (error) {
    console.error('overview failed:', error);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
