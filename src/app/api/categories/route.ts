import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export async function GET() {
  try {
    const categories = await prisma.category.findMany({
      orderBy: [
        { major: 'asc' }, // Will sort by string '서비스' etc but ideally should be indexed
        { orderIdx: 'asc' }
      ]
    });
    return NextResponse.json(categories);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch categories' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { major, middle } = body;
    if (!major || !middle) {
      return NextResponse.json({ error: 'Major and Middle category names are required' }, { status: 400 });
    }
    
    // Auto increment orderIdx for this major category
    const lastCategory = await prisma.category.findFirst({
      where: { major },
      orderBy: { orderIdx: 'desc' }
    });
    const orderIdx = lastCategory ? lastCategory.orderIdx + 1 : 0;

    const newCategory = await prisma.category.create({
      data: { major, middle, orderIdx }
    });
    return NextResponse.json(newCategory);
  } catch (error: any) {
    if (error.code === 'P2002') {
      return NextResponse.json({ error: 'Category already exists' }, { status: 400 });
    }
    return NextResponse.json({ error: 'Failed to create category' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) {
      return NextResponse.json({ error: 'Category ID is required' }, { status: 400 });
    }
    await prisma.category.delete({
      where: { id: parseInt(id) }
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to delete' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const { categoryIds } = await request.json();
    if (!Array.isArray(categoryIds)) throw new Error('Invalid format');

    await prisma.$transaction(
      categoryIds.map((id: number, idx: number) => 
        prisma.category.update({
          where: { id },
          data: { orderIdx: idx }
        })
      )
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to reorder' }, { status: 500 });
  }
}
