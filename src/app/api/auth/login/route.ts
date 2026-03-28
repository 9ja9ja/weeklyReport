import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import bcrypt from 'bcryptjs';

export async function POST(request: Request) {
  try {
    const { userId, password } = await request.json();

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { team: true }
    });
    if (!user) return NextResponse.json({ error: '사용자를 찾을 수 없습니다.' }, { status: 404 });

    // 최초 로그인
    if (user.password === 'NOT_SET') {
      if (password !== '0000') return NextResponse.json({ error: '비밀번호가 일치하지 않습니다. (초기 비밀번호: 0000)' }, { status: 401 });
      const hashed = await bcrypt.hash('0000', 10);
      await prisma.user.update({ where: { id: userId }, data: { password: hashed } });
      return NextResponse.json({
        success: true,
        user: { id: user.id, name: user.name, role: user.role, teamId: user.teamId, teamName: user.team.name },
        mustChangePw: true
      });
    }

    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) return NextResponse.json({ error: '비밀번호가 일치하지 않습니다.' }, { status: 401 });

    return NextResponse.json({
      success: true,
      user: { id: user.id, name: user.name, role: user.role, teamId: user.teamId, teamName: user.team.name },
      mustChangePw: user.mustChangePw
    });
  } catch (error) {
    console.error('Login error:', error);
    return NextResponse.json({ error: '로그인 실패' }, { status: 500 });
  }
}
