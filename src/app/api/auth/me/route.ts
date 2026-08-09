import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSessionUserId } from '@/lib/session';

/** 현재 세션 쿠키가 유효한지 확인 — 클라이언트가 저장해둔 로그인 상태와 대조하는 용도 */
export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ userId: null }, { status: 401 });

  // 세션 발급 이후 비활성 처리된 계정은 여기서 걸러 로그아웃시킨다.
  // DB 장애로 판정할 수 없을 때는 로그아웃시키지 않는다(fail-open) — 클라이언트가 응답 실패를
  // "세션 무효"로 해석해 재로그인을 강요하기 때문. 실제 권한이 필요한 라우트는 각자 isActive 를
  // 다시 확인하므로 여기서 통과시켜도 비활성 계정이 뭔가를 할 수는 없다.
  try {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { isActive: true } });
    if (!user?.isActive) return NextResponse.json({ userId: null }, { status: 401 });
  } catch {
    return NextResponse.json({ userId });
  }

  return NextResponse.json({ userId });
}
