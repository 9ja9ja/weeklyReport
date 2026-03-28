import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import bcrypt from 'bcryptjs';

export async function POST(request: Request) {
  try {
    const { userId, currentPassword, newPassword } = await request.json();

    if (!newPassword || newPassword.length < 4) {
      return NextResponse.json({ error: '새 비밀번호는 4자리 이상이어야 합니다.' }, { status: 400 });
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return NextResponse.json({ error: '사용자를 찾을 수 없습니다.' }, { status: 404 });
    }

    // 현재 비밀번호 검증
    if (user.password === 'NOT_SET') {
      if (currentPassword !== '0000') {
        return NextResponse.json({ error: '현재 비밀번호가 일치하지 않습니다.' }, { status: 401 });
      }
    } else {
      const isValid = await bcrypt.compare(currentPassword, user.password);
      if (!isValid) {
        return NextResponse.json({ error: '현재 비밀번호가 일치하지 않습니다.' }, { status: 401 });
      }
    }

    // 새 비밀번호 해시 후 저장
    const hashed = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({
      where: { id: userId },
      data: { password: hashed, mustChangePw: false }
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Change password error:', error);
    return NextResponse.json({ error: '비밀번호 변경 실패' }, { status: 500 });
  }
}
