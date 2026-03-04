import { NextRequest, NextResponse } from 'next/server';
import { db, ensureDb } from '@/db';
import { pageIssues, pageSnapshots, pages } from '@/db/schema';
import { and, desc, eq } from 'drizzle-orm';
import { getAuthUser, requireRole } from '@/lib/auth';
import { userCanAccessPage, userCanAccessProject } from '@/lib/access';
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
  const pageId = parseId(id);
  if (!pageId) {
    return NextResponse.json({ error: 'Invalid page id' }, { status: 400 });
  }
  if (!(await userCanAccessPage(user, pageId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const [page] = await db.select().from(pages).where(eq(pages.id, pageId)).limit(1);
  if (!page) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const issues = await db
    .select()
    .from(pageIssues)
    .where(and(eq(pageIssues.pageId, pageId), eq(pageIssues.isOpen, 1)))
    .orderBy(desc(pageIssues.lastSeenAt));

  const snapshots = await db
    .select()
    .from(pageSnapshots)
    .where(eq(pageSnapshots.pageId, pageId))
    .orderBy(desc(pageSnapshots.createdAt))
    .limit(10);

  return NextResponse.json({ ...page, issues, snapshots });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await ensureDb();
  const auth = await requireRole('editor');
  if (auth.error) return auth.error;

  const { id } = await params;
  const pageId = parseId(id);
  if (!pageId) {
    return NextResponse.json({ error: 'Invalid page id' }, { status: 400 });
  }
  if (!(await userCanAccessPage(auth.user, pageId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const body = await req.json();
    const updateData: Record<string, unknown> = { updatedAt: dbNow() };

    if (body.url !== undefined) updateData.url = body.url;
    if (body.title !== undefined) updateData.title = body.title || null;
    if (body.projectId !== undefined) {
      const projectId = body.projectId ? Number.parseInt(String(body.projectId), 10) : null;
      if (!(await userCanAccessProject(auth.user, projectId))) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
      updateData.projectId = projectId;
    }

    const [updated] = await db
      .update(pages)
      .set(updateData)
      .where(eq(pages.id, pageId))
      .returning();

    await logAuditEvent({
      userId: auth.user.id,
      action: 'page.update',
      resourceType: 'page',
      resourceId: pageId,
      projectId: Number(updated.projectId ?? 0) || null,
      metadata: { url: updated.url },
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error('Error updating page:', error);
    return NextResponse.json({ error: 'Failed to update page' }, { status: 500 });
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
  const pageId = parseId(id);
  if (!pageId) {
    return NextResponse.json({ error: 'Invalid page id' }, { status: 400 });
  }
  if (!(await userCanAccessPage(auth.user, pageId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    await db.delete(pages).where(eq(pages.id, pageId));
    await logAuditEvent({
      userId: auth.user.id,
      action: 'page.delete',
      resourceType: 'page',
      resourceId: pageId,
      severity: 'warning',
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting page:', error);
    return NextResponse.json({ error: 'Failed to delete page' }, { status: 500 });
  }
}
