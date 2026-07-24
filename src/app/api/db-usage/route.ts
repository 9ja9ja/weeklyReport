import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

/**
 * DB 사용량 / 무료 플랜 대비 사용률
 *
 * Neon 무료 플랜은 프로젝트당 0.5 GiB(스토리지) 제한.
 * 플랜을 바꾸면 DB_STORAGE_LIMIT_MB 환경변수로 조정한다.
 */
const DEFAULT_LIMIT_MB = 512;

// 자주 바뀌지 않으므로 60초 캐시 (매 페이지 로드마다 DB 를 두드리지 않게)
let cache: { at: number; payload: unknown } | null = null;
const TTL_MS = 60_000;

export async function GET() {
  if (cache && Date.now() - cache.at < TTL_MS) {
    return NextResponse.json(cache.payload);
  }

  try {
    const limitMb = parseInt(process.env.DB_STORAGE_LIMIT_MB || '', 10) || DEFAULT_LIMIT_MB;

    const [row] = await prisma.$queryRaw<{ bytes: bigint }[]>`
      SELECT pg_database_size(current_database()) AS bytes
    `;
    const bytes = Number(row?.bytes ?? 0);
    const usedMb = bytes / (1024 * 1024);
    const percent = limitMb > 0 ? (usedMb / limitMb) * 100 : 0;

    // 보고 데이터 규모도 같이 (증가 추이 감 잡기용)
    const [reports, items] = await Promise.all([
      prisma.report.count(),
      prisma.reportItem.count()
    ]);

    const payload = {
      usedMb: Math.round(usedMb * 10) / 10,
      limitMb,
      percent: Math.round(percent * 10) / 10,
      reports,
      items,
      provider: process.env.DB_PROVIDER_LABEL || 'Neon 무료'
    };

    cache = { at: Date.now(), payload };
    return NextResponse.json(payload);
  } catch {
    return NextResponse.json({ error: 'DB 사용량 조회 실패' }, { status: 500 });
  }
}
