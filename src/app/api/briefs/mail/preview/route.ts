import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { currentUserId, unauthorized, forbidden, requireMasterOrAbove } from '@/lib/auth';
import { buildBriefReport } from '@/lib/mail/buildBriefReport';
import { mailConfigured, MAIL_FROM } from '@/lib/mail/sendMail';

/** 보고메일 미리보기 — 선택한 첨부 기준 제목·본문, 마지막 발송 이력, 잠금 여부 */
export async function POST(req: NextRequest) {
  const uid = await currentUserId();
  if (!uid) return unauthorized();
  if (!(await requireMasterOrAbove(uid))) return forbidden('관리자 이상만 볼 수 있습니다.');

  const { year, weekNum, attachmentIds } = await req.json().catch(() => ({}));
  if (!year || !weekNum) return NextResponse.json({ error: '연도와 주차가 필요합니다.' }, { status: 400 });

  const origin = process.env.NEXT_APP_URL || req.nextUrl.origin;
  const ids: number[] = Array.isArray(attachmentIds) ? attachmentIds.map(Number).filter(Number.isInteger) : [];
  const [report, brief, last] = await Promise.all([
    buildBriefReport(year, weekNum, ids, `${origin}/brief`),
    prisma.brief.findUnique({ where: { year_weekNum: { year, weekNum } }, select: { isLocked: true } }),
    prisma.briefMailLog.findFirst({ where: { year, weekNum, status: { in: ['sent', 'dryrun'] } }, orderBy: { sentAt: 'desc' } })
  ]);
  const sender = last
    ? await prisma.user.findUnique({ where: { id: last.sentBy }, select: { name: true } })
    : null;
  const lastRecipients = (last?.recipients ?? {}) as { to?: string[]; cc?: string[] };

  return NextResponse.json({
    from: MAIL_FROM,
    subject: report.subject,
    html: report.html,
    totalSize: report.totalSize,
    pendingTeams: report.pendingTeams,
    locked: brief?.isLocked ?? false,
    smtpConfigured: mailConfigured(),
    lastSent: last
      ? {
          status: last.status,
          sentAt: last.sentAt,
          sentByName: sender?.name ?? null,
          count: (lastRecipients.to?.length ?? 0) + (lastRecipients.cc?.length ?? 0)
        }
      : null
  });
}
