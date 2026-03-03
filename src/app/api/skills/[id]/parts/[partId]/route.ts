import { NextRequest, NextResponse } from 'next/server';
import { db, ensureDb } from '@/db/index';
import { skillParts } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { dbNow } from '@/db/utils';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; partId: string }> }
) {
  await ensureDb();
  const { partId } = await params;

  try {
    const body = await req.json();
    const updateData: any = { updatedAt: dbNow() };
    if (body.label !== undefined) updateData.label = body.label;
    if (body.content !== undefined) updateData.content = body.content;
    if (body.sortOrder !== undefined) updateData.sortOrder = body.sortOrder;
    if (body.partType !== undefined) updateData.partType = body.partType;

    const [part] = await db
      .update(skillParts)
      .set(updateData)
      .where(eq(skillParts.id, parseInt(partId, 10)))
      .returning();

    if (!part) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    return NextResponse.json(part);
  } catch (error) {
    console.error('Error updating skill part:', error);
    return NextResponse.json({ error: 'Failed to update part' }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; partId: string }> }
) {
  await ensureDb();
  const { partId } = await params;

  try {
    await db.delete(skillParts).where(eq(skillParts.id, parseInt(partId, 10)));
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting skill part:', error);
    return NextResponse.json({ error: 'Failed to delete part' }, { status: 500 });
  }
}
