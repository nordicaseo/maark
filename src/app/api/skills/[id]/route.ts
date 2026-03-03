import { NextRequest, NextResponse } from 'next/server';
import { db, ensureDb } from '@/db/index';
import { skills } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { dbNow } from '@/db/utils';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await ensureDb();
  const { id } = await params;

  try {
    const [skill] = await db
      .select()
      .from(skills)
      .where(eq(skills.id, parseInt(id, 10)));

    if (!skill) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    return NextResponse.json(skill);
  } catch (error) {
    console.error('Error fetching skill:', error);
    return NextResponse.json({ error: 'Failed to fetch skill' }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await ensureDb();
  const { id } = await params;

  try {
    const body = await req.json();

    const updateData: any = { updatedAt: dbNow() };
    if (body.name !== undefined) updateData.name = body.name;
    if (body.description !== undefined) updateData.description = body.description;
    if (body.content !== undefined) updateData.content = body.content;
    if (body.projectId !== undefined) updateData.projectId = body.projectId;
    if (body.isGlobal !== undefined) updateData.isGlobal = body.isGlobal ? 1 : 0;

    const [skill] = await db
      .update(skills)
      .set(updateData)
      .where(eq(skills.id, parseInt(id, 10)))
      .returning();

    if (!skill) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    return NextResponse.json(skill);
  } catch (error) {
    console.error('Error updating skill:', error);
    return NextResponse.json({ error: 'Failed to update skill' }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await ensureDb();
  const { id } = await params;

  try {
    await db.delete(skills).where(eq(skills.id, parseInt(id, 10)));
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting skill:', error);
    return NextResponse.json({ error: 'Failed to delete skill' }, { status: 500 });
  }
}
