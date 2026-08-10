import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { currentUserId, unauthorized, forbidden, requireMasterOrAbove } from '@/lib/auth';

/** 개선요청 상세 + 코멘트 스레드 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const me = await currentUserId();
  if (!me) return unauthorized();

  const id = parseInt((await ctx.params).id, 10);
  if (!Number.isInteger(id)) return NextResponse.json({ error: 'id 가 필요합니다.' }, { status: 400 });

  const item = await prisma.improvement.findUnique({
    where: { id },
    select: {
      id: true, seq: true, title: true, content: true, category: true, status: true,
      createdAt: true, updatedAt: true, doneAt: true, createdBy: true,
      author: { select: { id: true, name: true } },
      assignee: { select: { id: true, name: true } },
      comments: {
        orderBy: { createdAt: 'asc' },
        select: {
          id: true, body: true, type: true, createdAt: true,
          author: { select: { id: true, name: true } }
        }
      }
    }
  });
  if (!item) return NextResponse.json({ error: '요청을 찾을 수 없습니다.' }, { status: 404 });
  return NextResponse.json({ item });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const me = await currentUserId();
  if (!me) return unauthorized();

  const id = parseInt((await ctx.params).id, 10);
  const { body } = await req.json().catch(() => ({}));
  if (!Number.isInteger(id)) return NextResponse.json({ error: 'id 가 필요합니다.' }, { status: 400 });
  if (!body?.trim()) return NextResponse.json({ error: '내용을 입력해주세요.' }, { status: 400 });

  const exists = await prisma.improvement.findUnique({ where: { id }, select: { id: true } });
  if (!exists) return NextResponse.json({ error: '요청을 찾을 수 없습니다.' }, { status: 404 });

  const comment = await prisma.improvementComment.create({
    data: { improvementId: id, authorId: me, body: body.trim() },
    select: {
      id: true, body: true, type: true, createdAt: true,
      author: { select: { id: true, name: true } }
    }
  });
  return NextResponse.json({ comment });
}

export async function DELETE(req: NextRequest) {
  const me = await currentUserId();
  if (!me) return unauthorized();

  const commentId = parseInt(req.nextUrl.searchParams.get('commentId') ?? '', 10);
  if (!Number.isInteger(commentId)) return NextResponse.json({ error: 'commentId 가 필요합니다.' }, { status: 400 });

  const c = await prisma.improvementComment.findUnique({
    where: { id: commentId }, select: { authorId: true, type: true }
  });
  if (!c) return NextResponse.json({ error: '댓글을 찾을 수 없습니다.' }, { status: 404 });
  // 상태 변경 기록은 이력이라 지우지 않는다
  if (c.type !== 'comment') return forbidden('변경 이력은 삭제할 수 없습니다.');
  if (c.authorId !== me && !(await requireMasterOrAbove(me))) {
    return forbidden('본인이 쓴 댓글만 삭제할 수 있습니다.');
  }

  await prisma.improvementComment.delete({ where: { id: commentId } });
  return NextResponse.json({ success: true });
}
