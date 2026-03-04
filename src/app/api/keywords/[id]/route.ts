import { NextRequest, NextResponse } from 'next/server';
import { db, ensureDb } from '@/db';
import { keywords } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { getAuthUser, requireRole } from '@/lib/auth';
import { userCanAccessKeyword, userCanAccessProject } from '@/lib/access';
import { dbNow } from '@/db/utils';
import { logAuditEvent } from '@/lib/observability';

function parseId(id: string): number | null {
  const n = Number.parseInt(id, 10);
  return Number.isFinite(n) ? n : null;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await ensureDb();
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const keywordId = parseId(id);
  if (!keywordId) {
    return NextResponse.json({ error: 'Invalid keyword id' }, { status: 400 });
  }
  if (!(await userCanAccessKeyword(user, keywordId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const [keyword] = await db.select().from(keywords).where(eq(keywords.id, keywordId)).limit(1);
  if (!keyword) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  return NextResponse.json(keyword);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await ensureDb();
  const auth = await requireRole('editor');
  if (auth.error) return auth.error;

  const { id } = await params;
  const keywordId = parseId(id);
  if (!keywordId) {
    return NextResponse.json({ error: 'Invalid keyword id' }, { status: 400 });
  }
  if (!(await userCanAccessKeyword(auth.user, keywordId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const body = await req.json();
    const updateData: Record<string, unknown> = { updatedAt: dbNow() };

    if (body.keyword !== undefined) updateData.keyword = body.keyword?.trim() || '';
    if (body.intent !== undefined) updateData.intent = body.intent;
    if (body.status !== undefined) updateData.status = body.status;
    if (body.priority !== undefined) updateData.priority = body.priority;
    if (body.ownerId !== undefined) updateData.ownerId = body.ownerId || null;
    if (body.volume !== undefined) updateData.volume = Number.isFinite(body.volume) ? body.volume : null;
    if (body.difficulty !== undefined) updateData.difficulty = Number.isFinite(body.difficulty) ? body.difficulty : null;
    if (body.targetUrl !== undefined) updateData.targetUrl = body.targetUrl || null;
    if (body.notes !== undefined) updateData.notes = body.notes || null;
    if (body.lastTaskId !== undefined) updateData.lastTaskId = body.lastTaskId || null;

    if (body.projectId !== undefined) {
      const projectId = body.projectId ? Number.parseInt(String(body.projectId), 10) : null;
      if (!(await userCanAccessProject(auth.user, projectId))) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
      updateData.projectId = projectId;
    }

    const [updated] = await db
      .update(keywords)
      .set(updateData)
      .where(eq(keywords.id, keywordId))
      .returning();

    await logAuditEvent({
      userId: auth.user.id,
      action: 'keyword.update',
      resourceType: 'keyword',
      resourceId: keywordId,
      projectId: Number(updated.projectId ?? 0) || null,
      metadata: { status: updated.status, priority: updated.priority, ownerId: updated.ownerId },
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error('Error updating keyword:', error);
    return NextResponse.json({ error: 'Failed to update keyword' }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await ensureDb();
  const auth = await requireRole('editor');
  if (auth.error) return auth.error;

  const { id } = await params;
  const keywordId = parseId(id);
  if (!keywordId) {
    return NextResponse.json({ error: 'Invalid keyword id' }, { status: 400 });
  }
  if (!(await userCanAccessKeyword(auth.user, keywordId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    await db.delete(keywords).where(eq(keywords.id, keywordId));
    await logAuditEvent({
      userId: auth.user.id,
      action: 'keyword.delete',
      resourceType: 'keyword',
      resourceId: keywordId,
      severity: 'warning',
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting keyword:', error);
    return NextResponse.json({ error: 'Failed to delete keyword' }, { status: 500 });
  }
}
