import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { verifyPortalKey } from '@/lib/portalShare';

/** 사내 포털에서 로그인 없이 요약본을 조회하는 전용 엔드포인트 (읽기 전용) */
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  if (!verifyPortalKey(searchParams.get('key'))) {
    return NextResponse.json({ error: '접근 권한이 없습니다.' }, { status: 403 });
  }

  const year = parseInt(searchParams.get('year') || '');
  const weekNum = parseInt(searchParams.get('weekNum') || '');
  if (!year || !weekNum) return NextResponse.json({ error: '연도와 주차가 필요합니다.' }, { status: 400 });

  const brief = await prisma.brief.findUnique({ where: { year_weekNum: { year, weekNum } } });
  return NextResponse.json({ brief });
}
