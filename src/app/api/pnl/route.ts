import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { currentUserId, unauthorized, forbidden, requireOverviewAccess, requireMasterOrAbove } from '@/lib/auth';
import type { PnlCategoryInput } from '@/lib/pnlParser';

export async function GET(req: NextRequest) {
  const uid = await currentUserId();
  if (!uid) return unauthorized();
  if (!(await requireOverviewAccess(uid))) return forbidden('조회 권한이 없습니다.');

  const { searchParams } = req.nextUrl;
  const year = parseInt(searchParams.get('year') || '');
  const weekNum = parseInt(searchParams.get('weekNum') || '');
  if (!year || !weekNum) return NextResponse.json({ error: '연도와 주차가 필요합니다.' }, { status: 400 });

  const report = await prisma.pnlReport.findUnique({
    where: { year_weekNum: { year, weekNum } },
    include: { categories: { orderBy: { orderIdx: 'asc' } } }
  });
  return NextResponse.json({ report });
}

export async function POST(req: NextRequest) {
  const uid = await currentUserId();
  if (!uid) return unauthorized();
  if (!(await requireMasterOrAbove(uid))) return forbidden('관리자 이상만 작성할 수 있습니다.');

  const { year, weekNum, categories } = await req.json() as {
    year: number; weekNum: number; categories: PnlCategoryInput[];
  };
  if (!year || !weekNum) return NextResponse.json({ error: '연도와 주차가 필요합니다.' }, { status: 400 });
  if (!Array.isArray(categories)) return NextResponse.json({ error: '카테고리 데이터가 올바르지 않습니다.' }, { status: 400 });

  const existing = await prisma.pnlReport.findUnique({ where: { year_weekNum: { year, weekNum } } });
  if (existing?.isLocked) return NextResponse.json({ error: '잠금된 손익보고는 수정할 수 없습니다.' }, { status: 403 });

  const report = await prisma.$transaction(async tx => {
    const rep = await tx.pnlReport.upsert({
      where: { year_weekNum: { year, weekNum } },
      update: { updatedAt: new Date() },
      create: { year, weekNum, createdBy: uid }
    });
    await tx.pnlCategory.deleteMany({ where: { reportId: rep.id } });
    if (categories.length) {
      await tx.pnlCategory.createMany({
        data: categories.map((c, i) => ({
          reportId: rep.id,
          orderIdx: i,
          name: c.name ?? '',
          v1Label: c.v1Label ?? '',
          v2Label: c.v2Label ?? '',
          revenueV1: c.revenueV1 ?? 0,
          revenueV2: c.revenueV2 ?? 0,
          costV1: c.costV1 ?? 0,
          costV2: c.costV2 ?? 0,
          grossProfitV1: c.grossProfitV1 ?? 0,
          grossProfitV2: c.grossProfitV2 ?? 0,
          opProfitV1: c.opProfitV1 ?? 0,
          opProfitV2: c.opProfitV2 ?? 0,
          note: c.note ?? '',
        }))
      });
    }
    return tx.pnlReport.findUnique({
      where: { id: rep.id },
      include: { categories: { orderBy: { orderIdx: 'asc' } } }
    });
  });

  return NextResponse.json({ report });
}

export async function PATCH(req: NextRequest) {
  const uid = await currentUserId();
  if (!uid) return unauthorized();
  if (!(await requireMasterOrAbove(uid))) return forbidden('관리자 이상만 잠금 처리할 수 있습니다.');

  const { year, weekNum, isLocked } = await req.json();
  if (!year || !weekNum) return NextResponse.json({ error: '연도와 주차가 필요합니다.' }, { status: 400 });

  const report = await prisma.pnlReport.upsert({
    where: { year_weekNum: { year, weekNum } },
    update: {
      isLocked: !!isLocked,
      lockedBy: isLocked ? uid : null,
      lockedAt: isLocked ? new Date() : null
    },
    create: {
      year, weekNum,
      isLocked: !!isLocked,
      lockedBy: isLocked ? uid : null,
      lockedAt: isLocked ? new Date() : null,
      createdBy: uid
    },
    include: { categories: { orderBy: { orderIdx: 'asc' } } }
  });

  return NextResponse.json({ report });
}
