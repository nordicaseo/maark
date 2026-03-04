import { NextRequest, NextResponse } from 'next/server';
import { db, ensureDb } from '@/db';
import { keywords } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { requireRole } from '@/lib/auth';
import { userCanAccessKeyword } from '@/lib/access';
import { dbNow } from '@/db/utils';
import { logAuditEvent, logAlertEvent } from '@/lib/observability';
import { createTopicWorkflow } from '@/lib/topic-workflow';

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

    const created = await createTopicWorkflow({
      user: auth.user,
      projectId: keyword.projectId,
      topic: title,
      entryPoint: 'keywords',
      keywordId: keyword.id,
      targetKeyword: keyword.keyword,
      options: {
        outlineReviewOptional: true,
        seoReviewRequired: true,
      },
    });

    await db
      .update(keywords)
      .set({
        status: 'in_progress',
        lastTaskId: created.taskId,
        updatedAt: dbNow(),
      })
      .where(eq(keywords.id, keywordId));

    await logAuditEvent({
      userId: auth.user.id,
      action: 'keyword.create_task',
      resourceType: 'keyword',
      resourceId: keyword.id,
      projectId: keyword.projectId,
      metadata: {
        taskId: created.taskId,
        documentId: created.contentDocumentId ?? null,
        keyword: keyword.keyword,
        reused: created.reused,
      },
    });

    return NextResponse.json({
      success: true,
      keywordId: keyword.id,
      documentId: created.contentDocumentId ?? null,
      taskId: created.taskId,
      reused: created.reused,
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
