import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { currentUserId, unauthorized, forbidden, requireMasterOrAbove } from '@/lib/auth';

const EMAIL = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;

/** 보고메일 받는 사람·참조 목록 */
export async function GET() {
  const uid = await currentUserId();
  if (!uid) return unauthorized();
  if (!(await requireMasterOrAbove(uid))) return forbidden('관리자 이상만 볼 수 있습니다.');

  const rows = await prisma.briefMailRecipient.findMany({ orderBy: [{ orderIdx: 'asc' }, { id: 'asc' }] });
  return NextResponse.json({
    to: rows.filter(r => r.kind === 'to').map(r => ({ email: r.email, name: r.name })),
    cc: rows.filter(r => r.kind === 'cc').map(r => ({ email: r.email, name: r.name }))
  });
}

/** 목록 전체 교체 — 모달에서 고친 목록을 그대로 저장한다 */
export async function PUT(req: NextRequest) {
  const uid = await currentUserId();
  if (!uid) return unauthorized();
  if (!(await requireMasterOrAbove(uid))) return forbidden('관리자 이상만 바꿀 수 있습니다.');

  const body = await req.json().catch(() => null);
  const clean = (list: unknown) => Array.isArray(list)
    ? list.map(x => ({
        email: String((x as { email?: unknown })?.email ?? '').trim().toLowerCase(),
        name: String((x as { name?: unknown })?.name ?? '').trim().slice(0, 50)
      }))
    : null;
  const to = clean(body?.to);
  const cc = clean(body?.cc);
  if (!to || !cc) return NextResponse.json({ error: '요청 값이 올바르지 않습니다.' }, { status: 400 });

  const all = [...to, ...cc];
  const bad = all.find(r => !EMAIL.test(r.email));
  if (bad) return NextResponse.json({ error: `이메일 형식이 올바르지 않습니다: ${bad.email}` }, { status: 400 });
  if (all.length > 100) return NextResponse.json({ error: '수신자는 100명까지 등록할 수 있습니다.' }, { status: 400 });
  if (new Set(all.map(r => r.email)).size !== all.length) {
    return NextResponse.json({ error: '같은 이메일이 받는 사람/참조에 중복되어 있습니다.' }, { status: 400 });
  }

  await prisma.$transaction([
    prisma.briefMailRecipient.deleteMany(),
    prisma.briefMailRecipient.createMany({
      data: [
        ...to.map((r, i) => ({ ...r, kind: 'to', orderIdx: i })),
        ...cc.map((r, i) => ({ ...r, kind: 'cc', orderIdx: i }))
      ]
    })
  ]);
  return NextResponse.json({ ok: true });
}
