import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { prisma } from '@/lib/db';
import { getUserTeams } from '@/lib/auth';
import { createSession } from '@/lib/session';

/**
 * 다이렉트 로그인 링크 — 사내 서비스에서 버튼 한 번으로 진입하는 용도.
 *
 * GET /api/auth/bypass?token=<BYPASS_TOKEN>&redirect=/overview
 *
 * 환경변수:
 *   BYPASS_TOKEN    — 긴 랜덤 문자열 (openssl rand -base64 48)
 *   BYPASS_USER_ID  — 자동 로그인할 사용자의 DB id (정수)
 */
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token');
  const redirect = request.nextUrl.searchParams.get('redirect') || '/overview';

  // ── 환경변수 확인 ──
  const expectedToken = process.env.BYPASS_TOKEN;
  const bypassUserId = Number(process.env.BYPASS_USER_ID);

  if (!expectedToken || expectedToken.length < 32 || !bypassUserId) {
    return NextResponse.json(
      { error: 'bypass 미설정' },
      { status: 500 }
    );
  }

  // ── 토큰 검증 (constant-time) ──
  if (!token) {
    return NextResponse.json({ error: '토큰 누락' }, { status: 401 });
  }

  const a = Buffer.from(token);
  const b = Buffer.from(expectedToken);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return NextResponse.json({ error: '잘못된 토큰' }, { status: 401 });
  }

  // ── 사용자 조회 ──
  const user = await prisma.user.findUnique({
    where: { id: bypassUserId },
    include: { team: true },
  });

  if (!user || !user.isActive) {
    return NextResponse.json({ error: '사용자 없음' }, { status: 404 });
  }

  // ── 세션 쿠키 발급 ──
  await createSession(user.id);

  // ── 클라이언트 sessionStorage 세팅용 데이터 ──
  const teams = await getUserTeams(user.id);
  const sessionData = {
    userId: user.id,
    userName: user.name,
    primaryTeamId: user.teamId,
    activeTeamId: user.teamId,
    teams,
    role: user.role,
    position: user.position,
  };

  // ── HTML 응답: sessionStorage 세팅 후 리다이렉트 ──
  // 단순 redirect()로는 sessionStorage를 설정할 수 없으므로
  // 짧은 HTML 페이지를 반환해 브라우저에서 JS로 처리한다.
  const safeRedirect = redirect.startsWith('/') ? redirect : '/overview';
  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>로그인 중...</title></head>
<body>
<p style="font-family:sans-serif;color:#666;text-align:center;margin-top:40vh">
로그인 중...
</p>
<script>
try {
  sessionStorage.setItem(
    'wr_user_session_v2',
    ${JSON.stringify(JSON.stringify(sessionData))}
  );
} catch(e) {}
location.replace(${JSON.stringify(safeRedirect)});
</script>
</body></html>`;

  return new NextResponse(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}
