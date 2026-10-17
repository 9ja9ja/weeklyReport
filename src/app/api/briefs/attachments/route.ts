import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { currentUserId, unauthorized, forbidden, requireTeamEditor } from '@/lib/auth';
import { putAttachment } from '@/lib/attachmentStorage';
import { briefMailSent } from '@/lib/briefTeamStatus';

/** 파일 한 개당 한도. 메일로 나가는 합계는 보낼 때 따로 본다. */
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

/** 팀 첨부 업로드 — 해당 팀 소속(임원 제외)과 최고관리자 */
export async function POST(req: NextRequest) {
  const uid = await currentUserId();
  if (!uid) return unauthorized();

  const form = await req.formData().catch(() => null);
  const year = parseInt(String(form?.get('year') ?? ''));
  const weekNum = parseInt(String(form?.get('weekNum') ?? ''));
  const teamId = parseInt(String(form?.get('teamId') ?? ''));
  const file = form?.get('file');
  if (!year || !weekNum || !teamId || !(file instanceof File)) {
    return NextResponse.json({ error: '요청 값이 올바르지 않습니다.' }, { status: 400 });
  }

  if (!(await requireTeamEditor(uid, teamId))) return forbidden('해당 팀 소속만 첨부할 수 있습니다.');

  const team = await prisma.team.findUnique({ where: { id: teamId }, select: { briefExcluded: true } });
  if (!team || team.briefExcluded) return NextResponse.json({ error: '첨부 대상 팀이 아닙니다.' }, { status: 400 });

  if (await briefMailSent(year, weekNum)) {
    return NextResponse.json({ error: '보고메일이 이미 발송된 주차라 첨부를 바꿀 수 없습니다.' }, { status: 409 });
  }
  if (file.size === 0) return NextResponse.json({ error: '빈 파일은 올릴 수 없습니다.' }, { status: 400 });
  if (file.size > MAX_ATTACHMENT_BYTES) {
    return NextResponse.json({ error: `파일은 ${MAX_ATTACHMENT_BYTES / 1024 / 1024}MB 이하만 올릴 수 있습니다.` }, { status: 413 });
  }

  const key = await putAttachment(Buffer.from(await file.arrayBuffer()));
  const row = await prisma.briefAttachment.create({
    data: {
      year, weekNum, teamId,
      // 경로 구분자는 파일명에 필요 없고 다운로드 헤더에만 쓰이므로 제거해 둔다
      fileName: file.name.replace(/[\\/]/g, '_').slice(0, 200) || 'file',
      size: file.size,
      mime: file.type || 'application/octet-stream',
      storageKey: key,
      uploadedBy: uid
    }
  });
  return NextResponse.json({ id: row.id });
}
