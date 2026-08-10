import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { currentUserId, unauthorized, forbidden, requireMasterOrAbove } from '@/lib/auth';
import { currentEnvironment } from '@/lib/realtime/persist';
import { signToken, briefRoomName } from '@/lib/realtime/token';
import { tokenSecret, TOKEN_TTL_SEC, isRealtimeConfigured } from '@/lib/realtime/secrets';
import { ensureBriefDocument } from '@/lib/realtime/briefSeed';
import { isBriefCollabWeek } from '@/lib/realtime/briefCutover';

/**
 * 요약본 실시간 룸 접속 토큰. **사용자 세션용**이다.
 *
 * 요약본은 팀 구분이 없고 편집 권한이 마스터 이상이라 주간보고 토큰 경로와 조건이 다르다.
 * 조회는 로그인 직원 전체지만 **편집은 마스터 이상**이므로 그 외에는 읽기전용으로 접속시킨다.
 *
 * ── GET 과 POST 를 나눈 이유 ──────────────────────────────
 * 문서 생성(시드)은 **POST 에만** 있다. 세션 쿠키가 sameSite=lax 라 크로스사이트
 * 최상위 GET 내비게이션에는 쿠키가 실린다 — 시드가 GET 에 있으면 관리자에게 링크 하나만
 * 클릭시켜 임의 주차의 문서를 만들어낼 수 있고, 그 주차는 레거시 저장이 영구 차단된다.
 * 재접속마다 토큰을 새로 받는 경로(provider params)는 부작용이 없어야 하므로 GET 을 쓴다.
 *
 * GET  /api/realtime/brief-token?year=&weekNum=   토큰만 발급 (문서 없으면 409)
 * POST /api/realtime/brief-token { year, weekNum } 필요하면 문서를 만들고 토큰 발급
 */

/** 주차 값 범위 — 벗어난 값으로는 룸 이름조차 만들 수 없어 쓰레기 행만 남는다 */
function validWeek(year: number, weekNum: number): boolean {
  return Number.isInteger(year) && Number.isInteger(weekNum)
    && year >= 2000 && year <= 2100
    && weekNum >= 1 && weekNum <= 53;
}

async function issue(year: number, weekNum: number, allowSeed: boolean) {
  const me = await currentUserId();
  if (!me) return unauthorized();

  if (!isRealtimeConfigured()) {
    return NextResponse.json({ error: '실시간 기능이 아직 구성되지 않았습니다.' }, { status: 503 });
  }
  if (!validWeek(year, weekNum)) {
    return NextResponse.json({ error: 'year·weekNum 이 올바르지 않습니다.' }, { status: 400 });
  }

  const user = await prisma.user.findUnique({
    where: { id: me },
    select: { id: true, name: true, role: true, isActive: true }
  });
  if (!user?.isActive) return unauthorized();

  // 임원은 요약본을 조회만 한다. 실시간 룸에는 들이지 않는다.
  if (user.role === 'executive') return forbidden('임원 계정은 실시간 편집에 참여하지 않습니다.');

  // 컷오버 밖의 주차는 실시간을 쓰지 않는다. 문서가 이미 있어도 마찬가지다 —
  // 환경변수를 지우면 즉시 기존 방식으로 되돌아가는 kill switch 가 된다.
  if (!isBriefCollabWeek(year, weekNum)) {
    return NextResponse.json({ error: '이 주차는 공동 편집 대상이 아닙니다.', notSeeded: true }, { status: 409 });
  }

  const master = await requireMasterOrAbove(me);
  const environment = currentEnvironment();

  // 편집 권한이 있는 사람이 명시적으로 편집을 시작할 때만 문서를 만든다.
  // 조회자만 들락거리는데 빈 문서가 생기면 기존 Brief 와 상태가 갈린다.
  if (allowSeed && master) await ensureBriefDocument(environment, year, weekNum, me);

  const doc = await prisma.briefDoc.findUnique({
    where: { environment_year_weekNum: { environment, year, weekNum } },
    select: { docGeneration: true, writeEpoch: true, revision: true, seedId: true }
  });
  if (!doc) {
    // 아직 아무도 편집을 시작하지 않았다 — 클라이언트는 기존 방식으로 보여주면 된다
    return NextResponse.json({ error: '아직 실시간 문서가 없습니다.', notSeeded: true }, { status: 409 });
  }

  const brief = await prisma.brief.findUnique({
    where: { year_weekNum: { year, weekNum } },
    select: { isLocked: true }
  });
  const isLocked = brief?.isLocked === true;

  const payload = {
    uid: user.id,
    name: user.name,
    kind: 'brief' as const,
    env: environment,
    year, weekNum,
    gen: doc.docGeneration,
    // 잠겼거나 마스터가 아니면 읽기전용
    readOnly: isLocked || !master,
    master,
    exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SEC
  };

  return NextResponse.json({
    token: await signToken(payload, tokenSecret()),
    room: briefRoomName(environment, year, weekNum, doc.docGeneration),
    host: process.env.NEXT_PUBLIC_REALTIME_HOST ?? null,
    docGeneration: doc.docGeneration,
    writeEpoch: doc.writeEpoch,
    revision: doc.revision,
    isLocked,
    readOnly: payload.readOnly,
    master,
    expiresAt: payload.exp
  }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  return issue(Number(searchParams.get('year')), Number(searchParams.get('weekNum')), false);
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  return issue(Number(body?.year), Number(body?.weekNum), true);
}
