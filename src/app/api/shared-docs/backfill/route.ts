import { NextResponse } from 'next/server';
import { currentUserId, requireSuperAdmin, unauthorized, forbidden } from '@/lib/auth';
import { runBackfill } from '@/lib/realtime/backfill';
import { currentEnvironment, PRODUCTION_ENV } from '@/lib/realtime/persist';

/**
 * 과거 주차 → SharedDoc 백필. superAdmin 전용.
 *
 * GET  ?dry=true&teamId=&force=   계획만 (기본값 — 실수로 쓰기가 일어나지 않게)
 * POST { confirm:'BACKFILL', force?, teamId? }  실제 적용
 *
 * 변환 규칙(buildDoc/materialize)을 앱과 공유하려고 스크립트가 아니라 라우트로 뒀다.
 */

/** teamId 파싱 — NaN 이 조용히 "전체 스캔"으로 흐르지 않게 한다 */
function parseTeamId(raw: string | number | null | undefined): { ok: true; value?: number } | { ok: false } {
  if (raw === null || raw === undefined || raw === '') return { ok: true };
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) return { ok: false };
  return { ok: true, value: n };
}

/**
 * 이 프로젝트는 프리뷰 배포도 같은 DATABASE_URL 을 쓸 수 있다.
 * 백필은 되돌리기 어려우므로 비운영 환경에서는 명시적 옵트인을 요구한다.
 */
function environmentAllowsWrite(): { ok: boolean; env: string; reason?: string } {
  const env = currentEnvironment();
  if (env === PRODUCTION_ENV) return { ok: true, env };
  if (process.env.ALLOW_NONPROD_BACKFILL === '1') return { ok: true, env };
  return {
    ok: false,
    env,
    reason:
      `현재 환경(${env})에서는 백필 쓰기를 막습니다. ` +
      `프리뷰/개발이 운영 데이터를 건드리는 사고를 막기 위한 장치이며, ` +
      `의도한 것이라면 ALLOW_NONPROD_BACKFILL=1 을 설정해주세요.`
  };
}

export async function GET(request: Request) {
  const me = await currentUserId();
  if (!me) return unauthorized();
  if (!(await requireSuperAdmin(me))) return forbidden('최고관리자 권한이 필요합니다.');

  const { searchParams } = new URL(request.url);
  const team = parseTeamId(searchParams.get('teamId'));
  if (!team.ok) return NextResponse.json({ error: 'teamId 가 올바르지 않습니다.' }, { status: 400 });

  try {
    const report = await runBackfill({
      environment: currentEnvironment(),
      dryRun: true,
      // 계획 단계에서도 force 결과를 미리 볼 수 있어야 한다
      force: searchParams.get('force') === 'true',
      teamId: team.value
    });
    return NextResponse.json({ ...report, environment: currentEnvironment() });
  } catch (e) {
    return NextResponse.json({ error: '백필 조회 실패', detail: String(e) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const me = await currentUserId();
  if (!me) return unauthorized();
  if (!(await requireSuperAdmin(me))) return forbidden('최고관리자 권한이 필요합니다.');

  const gate = environmentAllowsWrite();
  if (!gate.ok) return NextResponse.json({ error: gate.reason, environment: gate.env }, { status: 403 });

  let body: { force?: boolean; teamId?: number | string; confirm?: string } = {};
  try { body = await request.json(); } catch { /* 빈 본문 허용 */ }

  // 되돌리기 어려운 작업이라 명시적 확인 문자열을 요구한다
  if (body.confirm !== 'BACKFILL') {
    return NextResponse.json(
      { error: '확인이 필요합니다. body 에 {"confirm":"BACKFILL"} 를 넣어주세요.' },
      { status: 400 }
    );
  }

  const team = parseTeamId(body.teamId);
  if (!team.ok) return NextResponse.json({ error: 'teamId 가 올바르지 않습니다.' }, { status: 400 });

  try {
    const report = await runBackfill({
      environment: gate.env,
      dryRun: false,
      force: body.force === true,
      teamId: team.value
    });

    // 임계 초과로 중단됐거나 건너뛴 항목이 있으면 눈에 띄게 알린다
    const skippedDiff = report.items.filter(i => i.status === 'skipped-diff').length;
    const errors = report.items.filter(i => i.status === 'error').length;
    const warnings: string[] = [];
    if (report.aborted) warnings.push(report.aborted);
    if (skippedDiff > 0) warnings.push(`왕복에서 내용이 변해 건너뛴 주차 ${skippedDiff}건`);
    if (errors > 0) warnings.push(`처리 중 오류가 난 주차 ${errors}건`);

    return NextResponse.json({
      ...report,
      environment: gate.env,
      ...(warnings.length ? { warning: warnings.join(' / ') } : {})
    });
  } catch (e) {
    return NextResponse.json({ error: '백필 실패', detail: String(e) }, { status: 500 });
  }
}
