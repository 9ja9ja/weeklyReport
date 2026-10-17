/**
 * 보고메일 수신자 초기값 시드 — 기존 수동 발송 메일(받는 사람 1명 + 참조 9명) 그대로.
 * 이미 있는 이메일은 건드리지 않으므로 여러 번 실행해도 안전하다(이후 화면에서 고친 목록을 덮어쓰지 않는다).
 *
 * 실행: node prisma/seed_brief_mail_recipients.mjs   (DATABASE_URL 은 .env 를 따른다)
 */
import { PrismaClient } from '@prisma/client';

const TO = [
  { name: '성왕선', email: 'timeride@finger.co.kr' }
];
const CC = [
  { name: '김홍규', email: 'hkkim@finger.co.kr' },
  { name: '강경오', email: 'kokang@finger.co.kr' },
  { name: '최호식', email: 'hosik1982@finger.co.kr' },
  { name: '김민서', email: 'mskim@finger.co.kr' },
  { name: '구자영', email: '9ja9ja@finger.co.kr' },
  { name: '김종호', email: 'jkim@finger.co.kr' },
  { name: '황충근', email: 'cghwang@finger.co.kr' },
  { name: '박상희', email: 'sanghee84@finger.co.kr' },
  { name: '이재민', email: 'ljm1532@finger.co.kr' }
];

const prisma = new PrismaClient();
try {
  let added = 0;
  for (const [kind, list] of [['to', TO], ['cc', CC]]) {
    for (const [i, r] of list.entries()) {
      const exists = await prisma.briefMailRecipient.findUnique({ where: { email: r.email } });
      if (exists) continue;
      await prisma.briefMailRecipient.create({ data: { ...r, kind, orderIdx: i } });
      added++;
    }
  }
  console.log(`수신자 ${added}명 추가 (전체 ${await prisma.briefMailRecipient.count()}명)`);
} finally {
  await prisma.$disconnect();
}
