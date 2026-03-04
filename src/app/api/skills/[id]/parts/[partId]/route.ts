import { NextRequest, NextResponse } from 'next/server';
import { db, ensureDb } from '@/db/index';
import { skillParts } from '@/db/schema';
import { and, eq } from 'drizzle-orm';
import { dbNow } from '@/db/utils';
import { requireRole } from '@/lib/auth';
import { userCanAccessSkill } from '@/lib/access';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; partId: string }> }
) {
  await ensureDb();
  const auth = await requireRole('editor');
  if (auth.error) return auth.error;
  const { id, partId } = await params;
  const skillId = parseInt(id, 10);
  const parsedPartId = parseInt(partId, 10);
  if (Number.isNaN(skillId) || Number.isNaN(parsedPartId)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  }
  if (!(await userCanAccessSkill(auth.user, skillId, { write: true }))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

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
      .where(and(eq(skillParts.id, parsedPartId), eq(skillParts.skillId, skillId)))
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
  const auth = await requireRole('editor');
  if (auth.error) return auth.error;
  const { id, partId } = await params;
  const skillId = parseInt(id, 10);
  const parsedPartId = parseInt(partId, 10);
  if (Number.isNaN(skillId) || Number.isNaN(parsedPartId)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  }
  if (!(await userCanAccessSkill(auth.user, skillId, { write: true }))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    await db
      .delete(skillParts)
      .where(and(eq(skillParts.id, parsedPartId), eq(skillParts.skillId, skillId)));
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting skill part:', error);
    return NextResponse.json({ error: 'Failed to delete part' }, { status: 500 });
  }
}
