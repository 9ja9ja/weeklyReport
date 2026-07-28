import { NextResponse } from 'next/server';
import { getSessionUserId } from '@/lib/session';

/** 현재 세션 쿠키가 유효한지 확인 — 클라이언트가 저장해둔 로그인 상태와 대조하는 용도 */
export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ userId: null }, { status: 401 });
  return NextResponse.json({ userId });
}
