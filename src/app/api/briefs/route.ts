import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { currentUserId, unauthorized, forbidden, requireMasterOrAbove } from '@/lib/auth';

export async function GET(req: NextRequest) {
  const uid = await currentUserId();
  if (!uid) return unauthorized();
  if (!(await requireMasterOrAbove(uid))) return forbidden('관리자 이상만 접근할 수 있습니다.');

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

  const brief = await prisma.brief.upsert({
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

  return NextResponse.json({ brief });
}
