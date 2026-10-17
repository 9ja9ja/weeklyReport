/**
 * 메일 서버 연동 확인 — 앱이 쓰는 것과 같은 환경변수로 접속하고 시험 메일을 한 통 보낸다.
 *
 * 사용법 (앱 서버에서, .env 또는 환경변수에 SMTP_* 가 있는 상태로):
 *   node --env-file=.env scripts/mail-test.mjs 받을주소@finger.co.kr
 *   node --env-file=.env scripts/mail-test.mjs --verify-only      # 접속·인증만 확인(메일 안 보냄)
 *
 * 환경변수: SMTP_HOST, SMTP_PORT(기본 587), SMTP_SECURE(true 면 465 방식), SMTP_USER, SMTP_PASS,
 *          MAIL_FROM(기본 Finger <no-reply@finger.co.kr>)
 *
 * 비밀번호는 어디에도 출력하지 않는다.
 */
import nodemailer from 'nodemailer';

const args = process.argv.slice(2);
const verifyOnly = args.includes('--verify-only');
const to = args.find(a => !a.startsWith('--'));

const host = process.env.SMTP_HOST;
const port = Number(process.env.SMTP_PORT || 587);
const secure = process.env.SMTP_SECURE === 'true';
const user = process.env.SMTP_USER;
const pass = process.env.SMTP_PASS;
const from = process.env.MAIL_FROM || 'Finger <no-reply@finger.co.kr>';

if (!host) {
  console.error('SMTP_HOST 가 없습니다. 환경변수(.env)를 확인하세요.');
  process.exit(1);
}
if (!verifyOnly && !to) {
  console.error('받을 주소를 지정하세요.  예) node --env-file=.env scripts/mail-test.mjs me@finger.co.kr');
  process.exit(1);
}

// 오류 문구에 비밀번호가 섞여 나오는 일이 없도록 가린다
const scrub = text => (pass ? String(text).split(pass).join('***') : String(text));

console.log(`서버 ${host}:${port} (${secure ? 'SSL' : 'STARTTLS/평문'}) · 계정 ${user ? '사용' : '없음(인증 없이 접속)'} · 보낸 사람 ${from}`);

const transport = nodemailer.createTransport({
  host, port, secure,
  auth: user ? { user, pass } : undefined,
  connectionTimeout: 15000,
  greetingTimeout: 15000,
  socketTimeout: 30000
});

try {
  await transport.verify();
  console.log('접속·인증 확인: 성공');
  if (verifyOnly) process.exit(0);

  const info = await transport.sendMail({
    from,
    to,
    subject: '[테스트] 주간보고 메일 발송 확인',
    text: '주간보고 시스템의 메일 발송 설정 확인용 시험 메일입니다. 답장하지 않으셔도 됩니다.',
    html: '<p>주간보고 시스템의 메일 발송 설정 확인용 시험 메일입니다.</p><p>답장하지 않으셔도 됩니다.</p>'
  });
  console.log(`발송 성공 → ${to}  (서버 응답: ${scrub(info.response)})`);
} catch (e) {
  console.error(`실패: ${scrub(e.message)}${e.code ? `  [${e.code}]` : ''}`);
  process.exit(1);
}
