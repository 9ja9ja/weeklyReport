import nodemailer from 'nodemailer';

/**
 * 메일 발송.
 *
 * SMTP_HOST 가 설정돼 있으면 nodemailer 로 실제 발송하고, 없으면 **발송하지 않고** 결과만 돌려준다(dryrun).
 * 사내 시스템 이관 전이라 SMTP 접속정보가 아직 없다 — 개발 중 실수로 실제 임원에게 나가는 일이 없도록
 * 설정이 없으면 기본이 "안 보냄"이다.
 *
 * 환경변수: SMTP_HOST, SMTP_PORT(기본 587), SMTP_SECURE(true 면 465 방식), SMTP_USER, SMTP_PASS,
 *          MAIL_FROM(기본 Finger <no-reply@finger.co.kr>)
 */
export interface MailAttachment { filename: string; content: Buffer; contentType?: string }

export interface MailInput {
  to: string[];
  cc: string[];
  subject: string;
  html: string;
  attachments: MailAttachment[];
}

export type MailResult = { status: 'sent' | 'dryrun' };

export const MAIL_FROM = process.env.MAIL_FROM || 'Finger <no-reply@finger.co.kr>';

export function mailConfigured(): boolean {
  return !!process.env.SMTP_HOST;
}

export async function sendMail(input: MailInput): Promise<MailResult> {
  if (!mailConfigured()) return { status: 'dryrun' };

  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined
  });
  await transport.sendMail({
    from: MAIL_FROM,
    to: input.to,
    cc: input.cc,
    subject: input.subject,
    html: input.html,
    attachments: input.attachments
  });
  return { status: 'sent' };
}
