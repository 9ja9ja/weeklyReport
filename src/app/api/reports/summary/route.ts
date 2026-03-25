import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const year = parseInt(searchParams.get('year') || '0');
  const weekNum = parseInt(searchParams.get('weekNum') || '0');

  try {
    const summary = await prisma.summaryData.findUnique({
      where: { year_weekNum: { year, weekNum } }
    });
    return NextResponse.json({ contents: summary?.contents || null });
  } catch (error) {
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { year, weekNum, contents } = await request.json();
    const result = await prisma.summaryData.upsert({
      where: { year_weekNum: { year, weekNum } },
      update: { contents, updatedAt: new Date() },
      create: { year, weekNum, contents }
    });
    return NextResponse.json({ success: true, id: result.id });
  } catch (error) {
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
