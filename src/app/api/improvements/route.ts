import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { currentUserId, unauthorized, forbidden, requireMasterOrAbove } from '@/lib/auth';
import { isCategory, isStatus, statusMeta } from '@/lib/improvement';

/**
 * 개선요청 게시판.
 *
 * 등록·조회·코멘트는 로그인한 직원 누구나. 상태 변경과 담당자 지정은 마스터 이상이 한다 —
 * 요청자가 스스로 "완료"로 바꾸면 진행 현황을 믿을 수 없게 된다.
 */

const listSelect = {
  id: true, seq: true, title: true, category: true, status: true,
  createdAt: true, updatedAt: true, doneAt: true,
  author: { select: { id: true, name: true } },
  assignee: { select: { id: true, name: true } },
  _count: { select: { comments: true } }
};

export async function GET(req: NextRequest) {
  const me = await currentUserId();
  if (!me) return unauthorized();

  const { searchParams } = req.nextUrl;
  const status = searchParams.get('status');
  const category = searchParams.get('category');
  const mine = searchParams.get('mine') === 'true';
  const q = (searchParams.get('q') ?? '').trim();

  const items = await prisma.improvement.findMany({
    where: {
      ...(isStatus(status) ? { status } : {}),
      ...(category && isCategory(category) ? { category } : {}),
      ...(mine ? { createdBy: me } : {}),
      ...(q
        ? { OR: [{ title: { contains: q, mode: 'insensitive' as const } }, { content: { contains: q, mode: 'insensitive' as const } }] }
        : {})
    },
    orderBy: [{ createdAt: 'desc' }],
    select: listSelect,
    take: 300
  });

  // 아직 처리 안 된 것이 위로 오게 한다. 상태가 문자열이라 DB 정렬로는 우선순위를 못 준다.
  const rank: Record<string, number> = { open: 0, in_progress: 1, hold: 2, done: 3, rejected: 4 };
  items.sort((a, b) => {
    const d = (rank[a.status] ?? 9) - (rank[b.status] ?? 9);
    return d !== 0 ? d : b.createdAt.getTime() - a.createdAt.getTime();
  });

  return NextResponse.json({ items });
}

export async function POST(req: NextRequest) {
  const me = await currentUserId();
  if (!me) return unauthorized();

  const { title, content, category } = await req.json().catch(() => ({}));
  if (!title?.trim()) return NextResponse.json({ error: '제목을 입력해주세요.' }, { status: 400 });

  // seq 는 화면 표시용 연속 번호다. 동시에 두 명이 등록해도 겹치지 않게
  // 트랜잭션 안에서 마지막 값을 읽어 올린다(unique 제약이 최종 방어선).
  const created = await prisma.$transaction(async tx => {
    const last = await tx.improvement.findFirst({ orderBy: { seq: 'desc' }, select: { seq: true } });
    return tx.improvement.create({
      data: {
        seq: (last?.seq ?? 0) + 1,
        title: title.trim(),
        content: (content ?? '').trim(),
        category: isCategory(category) ? category : '기타',
        createdBy: me
      },
      select: listSelect
    });
  });

  return NextResponse.json({ item: created });
}

export async function PATCH(req: NextRequest) {
  const me = await currentUserId();
  if (!me) return unauthorized();

  const { id, title, content, category, status, assigneeId } = await req.json().catch(() => ({}));
  if (!Number.isInteger(id)) return NextResponse.json({ error: 'id 가 필요합니다.' }, { status: 400 });

  const target = await prisma.improvement.findUnique({
    where: { id },
    select: { id: true, createdBy: true, status: true, assigneeId: true }
  });
  if (!target) return NextResponse.json({ error: '요청을 찾을 수 없습니다.' }, { status: 404 });

  const master = await requireMasterOrAbove(me);
  const isAuthor = target.createdBy === me;

  const data: Record<string, unknown> = {};
  const logs: string[] = [];

  // 본문 수정은 작성자 또는 마스터. 이미 처리된 건은 작성자가 고칠 수 없다 —
  // 완료 처리된 내용이 나중에 바뀌면 이력이 맞지 않는다.
  if (title !== undefined || content !== undefined || category !== undefined) {
    if (!isAuthor && !master) return forbidden('본인이 등록한 요청만 수정할 수 있습니다.');
    if (isAuthor && !master && target.status !== 'open') {
      return forbidden('이미 처리가 시작된 요청은 수정할 수 없습니다.');
    }
    if (typeof title === 'string') {
      if (!title.trim()) return NextResponse.json({ error: '제목을 입력해주세요.' }, { status: 400 });
      data.title = title.trim();
    }
    if (typeof content === 'string') data.content = content.trim();
    if (category !== undefined) {
      if (!isCategory(category)) return NextResponse.json({ error: '구분이 올바르지 않습니다.' }, { status: 400 });
      data.category = category;
    }
  }

  if (status !== undefined) {
    if (!master) return forbidden('상태 변경은 관리자만 할 수 있습니다.');
    if (!isStatus(status)) return NextResponse.json({ error: '상태가 올바르지 않습니다.' }, { status: 400 });
    if (status !== target.status) {
      data.status = status;
      data.doneAt = status === 'done' ? new Date() : null;
      logs.push(`상태를 '${statusMeta(status).label}' 로 변경`);
    }
  }

  if (assigneeId !== undefined) {
    if (!master) return forbidden('담당자 지정은 관리자만 할 수 있습니다.');
    if (assigneeId !== null && !Number.isInteger(assigneeId)) {
      return NextResponse.json({ error: '담당자가 올바르지 않습니다.' }, { status: 400 });
    }
    if (assigneeId !== target.assigneeId) {
      let name = '';
      if (assigneeId !== null) {
        const u = await prisma.user.findUnique({
          where: { id: assigneeId }, select: { id: true, name: true, isActive: true }
        });
        if (!u?.isActive) return NextResponse.json({ error: '담당자를 찾을 수 없습니다.' }, { status: 400 });
        name = u.name;
      }
      data.assigneeId = assigneeId;
      logs.push(assigneeId === null ? '담당자를 해제' : `담당자를 ${name} 으로 지정`);
    }
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: '변경할 내용이 없습니다.' }, { status: 400 });
  }

  // 상태·담당자 변경은 코멘트 스레드에도 남긴다. 누가 언제 바꿨는지 남지 않으면
  // 나중에 "왜 반영 안 됐나"를 되짚을 수 없다.
  const item = await prisma.$transaction(async tx => {
    const updated = await tx.improvement.update({ where: { id }, data, select: listSelect });
    for (const body of logs) {
      await tx.improvementComment.create({ data: { improvementId: id, authorId: me, body, type: 'status' } });
    }
    return updated;
  });

  return NextResponse.json({ item });
}

export async function DELETE(req: NextRequest) {
  const me = await currentUserId();
  if (!me) return unauthorized();
  const id = parseInt(req.nextUrl.searchParams.get('id') ?? '', 10);
  if (!Number.isInteger(id)) return NextResponse.json({ error: 'id 가 필요합니다.' }, { status: 400 });

  const target = await prisma.improvement.findUnique({
    where: { id }, select: { createdBy: true, status: true }
  });
  if (!target) return NextResponse.json({ error: '요청을 찾을 수 없습니다.' }, { status: 404 });

  const master = await requireMasterOrAbove(me);
  if (target.createdBy !== me && !master) return forbidden('본인이 등록한 요청만 삭제할 수 있습니다.');
  if (target.createdBy === me && !master && target.status !== 'open') {
    return forbidden('이미 처리가 시작된 요청은 삭제할 수 없습니다.');
  }

  await prisma.improvement.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
