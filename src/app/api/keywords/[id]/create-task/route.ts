import { NextRequest, NextResponse } from 'next/server';
import { db, ensureDb } from '@/db';
import { documents, keywords } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { requireRole } from '@/lib/auth';
import { userCanAccessKeyword } from '@/lib/access';
import { getConvexClient } from '@/lib/convex/server';
import { api } from '../../../../../../convex/_generated/api';
import { dbNow } from '@/db/utils';
import { logAuditEvent, logAlertEvent } from '@/lib/observability';

function parseId(id: string): number | null {
  const n = Number.parseInt(id, 10);
  return Number.isFinite(n) ? n : null;
}

export async function POST(
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
    const [keyword] = await db
      .select()
      .from(keywords)
      .where(eq(keywords.id, keywordId))
      .limit(1);

    if (!keyword) {
      return NextResponse.json({ error: 'Keyword not found' }, { status: 404 });
    }

    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const title = typeof body.title === 'string' && body.title.trim()
      ? body.title.trim()
      : keyword.keyword;

    const [doc] = await db
      .insert(documents)
      .values({
        title,
        contentType: 'blog_post',
        targetKeyword: keyword.keyword,
        projectId: keyword.projectId,
        authorId: auth.user.id,
        content: { type: 'doc', content: [{ type: 'paragraph' }] },
        plainText: '',
        wordCount: 0,
        status: 'draft',
      })
      .returning();

    const convex = getConvexClient();
    if (!convex) {
      return NextResponse.json({ error: 'Mission Control is not configured (Convex URL missing)' }, { status: 500 });
    }

    const taskId = await convex.mutation(api.tasks.create, {
      title: `Create content: ${keyword.keyword}`,
      description: `Produce content for keyword "${keyword.keyword}" (${keyword.intent}).`,
      type: 'content',
      status: 'BACKLOG',
      priority: keyword.priority?.toUpperCase() === 'HIGH' ? 'HIGH' : 'MEDIUM',
      documentId: doc.id,
      projectId: keyword.projectId,
      tags: ['keyword', keyword.keyword],
    });

    await db
      .update(keywords)
      .set({
        status: 'in_progress',
        lastTaskId: String(taskId),
        updatedAt: dbNow(),
      })
      .where(eq(keywords.id, keywordId));

    await logAuditEvent({
      userId: auth.user.id,
      action: 'keyword.create_task',
      resourceType: 'keyword',
      resourceId: keyword.id,
      projectId: keyword.projectId,
      metadata: { taskId: String(taskId), documentId: doc.id, keyword: keyword.keyword },
    });

    return NextResponse.json({
      success: true,
      keywordId: keyword.id,
      documentId: doc.id,
      taskId: String(taskId),
    });
  } catch (error) {
    await logAlertEvent({
      source: 'keywords',
      eventType: 'create_task_failed',
      severity: 'error',
      message: 'Failed to create Mission Control task from keyword',
      resourceId: keywordId,
      metadata: { error: error instanceof Error ? error.message : 'Unknown error' },
    });
    console.error('Error creating task from keyword:', error);
    return NextResponse.json({ error: 'Failed to create task' }, { status: 500 });
  }
}
