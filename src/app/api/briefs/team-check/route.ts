import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { currentUserId, unauthorized, forbidden, requireTeamMaster } from '@/lib/auth';

/** 팀 작성완료 체크·해제. 해당 팀 관리자 또는 최고관리자만 가능하다. */
export async function POST(req: NextRequest) {
  const uid = await currentUserId();
  if (!uid) return unauthorized();

  const { year, weekNum, teamId, checked } = await req.json();
  if (!year || !weekNum || !teamId || typeof checked !== 'boolean') {
    return NextResponse.json({ error: '요청 값이 올바르지 않습니다.' }, { status: 400 });
  }

  // 신원은 세션에서만 읽고, 팀 권한은 그 팀 기준으로 본다(body 의 값은 믿지 않는다)
  if (!(await requireTeamMaster(uid, teamId))) return forbidden('해당 팀 관리자만 체크할 수 있습니다.');

  const team = await prisma.team.findUnique({ where: { id: teamId }, select: { briefExcluded: true } });
  if (!team || team.briefExcluded) {
    return NextResponse.json({ error: '체크 대상 팀이 아닙니다.' }, { status: 400 });
  }

  // 최종 마감된 요약본은 팀 체크도 확정본의 일부라 바꾸지 못하게 한다
  const brief = await prisma.brief.findUnique({ where: { year_weekNum: { year, weekNum } }, select: { isLocked: true } });
  if (brief?.isLocked) {
    return NextResponse.json({ error: '잠금된 요약본은 체크를 바꿀 수 없습니다. 잠금을 해제한 뒤 변경해주세요.' }, { status: 409 });
  }

  if (checked) {
    await prisma.briefTeamCheck.upsert({
      where: { teamId_year_weekNum: { teamId, year, weekNum } },
      update: { checkedBy: uid, checkedAt: new Date() },
      create: { teamId, year, weekNum, checkedBy: uid }
    });
  } else {
    await prisma.briefTeamCheck.deleteMany({ where: { teamId, year, weekNum } });
  }
  return NextResponse.json({ ok: true });
}
