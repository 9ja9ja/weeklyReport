import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { currentUserId, unauthorized, forbidden, requireOverviewAccess, requireTeamEditor } from '@/lib/auth';
import { getAttachment, removeAttachment } from '@/lib/attachmentStorage';
import { briefMailSent } from '@/lib/briefTeamStatus';

async function load(ctx: { params: Promise<{ id: string }> }) {
  const id = parseInt((await ctx.params).id, 10);
  if (!Number.isInteger(id)) return null;
  return prisma.briefAttachment.findUnique({ where: { id } });
}

/** 다운로드 — 로그인한 직원이면 받을 수 있다(요약본 조회 권한과 같다) */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const uid = await currentUserId();
  if (!uid) return unauthorized();
  if (!(await requireOverviewAccess(uid))) return forbidden('조회 권한이 없습니다.');

  const row = await load(ctx);
  if (!row) return NextResponse.json({ error: '파일을 찾을 수 없습니다.' }, { status: 404 });

  let data: Buffer;
  try { data = await getAttachment(row.storageKey); }
  catch { return NextResponse.json({ error: '파일이 저장소에 없습니다.' }, { status: 404 }); }

  // 올라온 파일이 브라우저 안에서 실행·렌더되지 않도록 항상 내려받기로, 타입은 고정으로 내려준다
  return new NextResponse(new Uint8Array(data), {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(row.fileName)}`,
      'X-Content-Type-Options': 'nosniff',
      'Content-Length': String(data.length)
    }
  });
}

/** 삭제 — 해당 팀 소속(임원 제외)과 최고관리자 */
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const uid = await currentUserId();
  if (!uid) return unauthorized();

  const row = await load(ctx);
  if (!row) return NextResponse.json({ error: '파일을 찾을 수 없습니다.' }, { status: 404 });
  if (!(await requireTeamEditor(uid, row.teamId))) return forbidden('해당 팀 소속만 삭제할 수 있습니다.');

  if (await briefMailSent(row.year, row.weekNum)) {
    return NextResponse.json({ error: '보고메일이 이미 발송된 주차라 첨부를 바꿀 수 없습니다.' }, { status: 409 });
  }

  await prisma.briefAttachment.delete({ where: { id: row.id } });
  await removeAttachment(row.storageKey);
  return NextResponse.json({ ok: true });
}
