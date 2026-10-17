import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { currentUserId, unauthorized, forbidden, requireMasterOrAbove } from '@/lib/auth';
import { getAttachment } from '@/lib/attachmentStorage';
import { buildBriefReport, MAX_MAIL_ATTACHMENT_BYTES } from '@/lib/mail/buildBriefReport';
import { sendMail } from '@/lib/mail/sendMail';

const EMAIL = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;

/** 보고메일 발송 */
export async function POST(req: NextRequest) {
  const uid = await currentUserId();
  if (!uid) return unauthorized();
  if (!(await requireMasterOrAbove(uid))) return forbidden('관리자 이상만 발송할 수 있습니다.');

  const body = await req.json().catch(() => ({}));
  const { year, weekNum, confirmResend } = body;
  if (!year || !weekNum) return NextResponse.json({ error: '연도와 주차가 필요합니다.' }, { status: 400 });

  const norm = (v: unknown) => (Array.isArray(v) ? v : []).map(x => String(x).trim().toLowerCase()).filter(Boolean);
  const to = norm(body.to);
  const cc = norm(body.cc).filter(e => !to.includes(e));
  const badEmail = [...to, ...cc].find(e => !EMAIL.test(e));
  if (badEmail) return NextResponse.json({ error: `이메일 형식이 올바르지 않습니다: ${badEmail}` }, { status: 400 });
  if (to.length === 0) return NextResponse.json({ error: '받는 사람을 1명 이상 지정해주세요.' }, { status: 400 });
  if (to.length + cc.length > 100) return NextResponse.json({ error: '수신자는 100명까지 가능합니다.' }, { status: 400 });

  // 최종 마감 전에는 보고할 수 없다 — 아직 바뀔 수 있는 초안이 임원에게 나가는 것을 막는다
  const brief = await prisma.brief.findUnique({ where: { year_weekNum: { year, weekNum } }, select: { isLocked: true } });
  if (!brief?.isLocked) {
    return NextResponse.json({ error: '요약본을 최종 잠금한 뒤에 보고메일을 보낼 수 있습니다.' }, { status: 409 });
  }

  const sentBefore = await prisma.briefMailLog.count({ where: { year, weekNum, status: 'sent' } });
  if (sentBefore > 0 && !confirmResend) {
    return NextResponse.json({ error: '이 주차 보고메일은 이미 발송되었습니다. 다시 보내시겠습니까?', code: 'already_sent' }, { status: 409 });
  }

  const origin = process.env.NEXT_APP_URL || req.nextUrl.origin;
  const ids: number[] = Array.isArray(body.attachmentIds) ? body.attachmentIds.map(Number).filter(Number.isInteger) : [];
  const report = await buildBriefReport(year, weekNum, ids, `${origin}/brief`);
  if (report.totalSize > MAX_MAIL_ATTACHMENT_BYTES) {
    return NextResponse.json({ error: `첨부 합계가 ${MAX_MAIL_ATTACHMENT_BYTES / 1024 / 1024}MB를 넘습니다. 일부를 빼고 보내주세요.` }, { status: 413 });
  }

  const logBase = {
    year, weekNum, sentBy: uid, subject: report.subject,
    recipients: { to, cc },
    attachments: report.attachments.map(a => ({ id: a.id, fileName: a.fileName, size: a.size, teamName: a.teamName }))
  };

  try {
    const files = await Promise.all(report.attachments.map(async a => ({
      filename: a.fileName, content: await getAttachment(a.storageKey), contentType: a.mime
    })));
    const result = await sendMail({ to, cc, subject: report.subject, html: report.html, attachments: files });
    await prisma.briefMailLog.create({ data: { ...logBase, status: result.status } });
    return NextResponse.json({ ok: true, status: result.status });
  } catch (e) {
    // 실패 사유는 이력에만 남기고 응답에는 일반 문구만 준다(SMTP 응답에 접속 정보가 섞일 수 있다)
    await prisma.briefMailLog.create({ data: { ...logBase, status: 'failed', error: String(e).slice(0, 500) } });
    return NextResponse.json({ error: '메일 발송에 실패했습니다. 잠시 후 다시 시도해주세요.' }, { status: 502 });
  }
}
