import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireOverviewAccess, currentUserId, unauthorized } from '@/lib/auth';
import { isExecutiveGroup } from '@/lib/roles';
import { exportHtmlToDrive, isDriveConfigured } from '@/lib/googleDrive';
import { buildOverviewHtml, type DocTeam } from '@/lib/overviewDoc';
import { getWeekRange, getNextWeek } from '@/lib/weekUtils';
import type { ContentBlock } from '@/lib/reportBlocks';

type CateData = { current: ContentBlock[]; next: ContentBlock[] };
type EditorState = Record<number, CateData>;

function safeState(str: string | null | undefined): EditorState {
  if (!str) return {};
  try {
    const v = JSON.parse(str);
    return v && typeof v === 'object' ? (v as EditorState) : {};
  } catch { return {}; }
}
function safeBlocks(str: string): ContentBlock[] {
  try {
    const v = typeof str === 'string' ? JSON.parse(str) : str;
    return Array.isArray(v) ? v : [];
  } catch { return []; }
}

/** GET: 설정 여부만 확인 (버튼 노출용) */
export async function GET() {
  return NextResponse.json({ configured: isDriveConfigured() });
}

/**
 * POST /api/overview/export
 * { year, weekNum, teamId?, onlyFilled?, includeAuthor? }   (요청자 신원은 세션 쿠키)
 *
 * 전체 취합본을 기존 문서 양식으로 만들어 구글 드라이브
 * <루트>/<연도>/<월> 폴더에 구글 문서로 저장한다.
 */
export async function POST(request: Request) {
  try {
    const me = await currentUserId();
    if (!me) return unauthorized();
    const body = await request.json();
    const year = parseInt(body.year, 10);
    const weekNum = parseInt(body.weekNum, 10);
    const teamId = body.teamId ? parseInt(body.teamId, 10) : null;
    const onlyFilled = body.onlyFilled !== false;
    const includeAuthor = body.includeAuthor !== false;

    if (!year || !weekNum) return NextResponse.json({ error: 'year, weekNum required' }, { status: 400 });
    if (!(await requireOverviewAccess(me))) {
      return NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 });
    }
    if (!isDriveConfigured()) {
      return NextResponse.json(
        { error: '구글 드라이브 연동이 설정되지 않았습니다. 환경변수(GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REFRESH_TOKEN / GDRIVE_ROOT_FOLDER_ID)를 확인해주세요.' },
        { status: 503 }
      );
    }

    // ── 전체 취합본 조립 (/api/overview 와 동일 규칙) ──
    const [allTeams, summaries, locks, reports] = await Promise.all([
      prisma.team.findMany({
        where: teamId ? { id: teamId } : {},
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

    // 화면(전체 취합본)과 같은 대상이어야 한다 — 임원 그룹은 보고를 쓰지 않으므로 뺀다
    const teams = allTeams.filter(t => !isExecutiveGroup(t));

    const summaryMap = new Map(summaries.map(s => [s.teamId, safeState(s.contents)]));
    const lockMap = new Map(locks.map(l => [l.teamId, l]));
    const fallback = new Map<number, EditorState>();

    reports.forEach(rep => {
      rep.items.forEach(item => {
        const tid = item.category.teamId;
        if (summaryMap.has(tid)) return;
        if (!fallback.has(tid)) fallback.set(tid, {});
        const st = fallback.get(tid)!;
        if (!st[item.categoryId]) st[item.categoryId] = { current: [], next: [] };
        safeBlocks(item.currentContents).forEach(b =>
          st[item.categoryId].current.push({ ...b, authorText: b.authorText || rep.user.name })
        );
        safeBlocks(item.nextContents).forEach(b =>
          st[item.categoryId].next.push({ ...b, authorText: b.authorText || rep.user.name })
        );
      });
    });

    const docTeams: DocTeam[] = teams.map(team => {
      const data = summaryMap.get(team.id) ?? fallback.get(team.id) ?? {};
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
      const hasContent = parts.some(p =>
        p.majors.some(m => m.categories.some(c => c.current.length > 0 || c.next.length > 0))
      );
      return {
        id: team.id,
        name: team.name,
        division: team.division,
        isLocked: lockMap.get(team.id)?.isLocked ?? false,
        hasContent,
        parts
      };
    });

    if (!docTeams.some(t => t.hasContent)) {
      return NextResponse.json({ error: `${weekNum}주차에 작성된 내용이 없습니다.` }, { status: 400 });
    }

    // ── 문서 만들기 ──
    const range = getWeekRange(year, weekNum);
    const nw = getNextWeek(year, weekNum);
    const nextRange = getWeekRange(nw.year, nw.weekNum);
    const html = buildOverviewHtml({
      teams: docTeams,
      year,
      weekNum,
      range,
      nextRange,
      onlyFilled,
      includeAuthor
    });

    const teamSuffix = teamId ? `_${teams[0]?.name ?? ''}` : '';
    const fileName = `상세본_서비스본부_주간_보고_${year}년_${weekNum}주차${teamSuffix}`;

    // 월 폴더는 해당 주차 월요일 기준
    const result = await exportHtmlToDrive({
      html,
      fileName,
      year,
      month: range.monday.getMonth() + 1
    });

    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error('drive export failed:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '내보내기 실패' },
      { status: 500 }
    );
  }
}
