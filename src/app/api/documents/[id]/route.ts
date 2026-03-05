import { NextRequest, NextResponse } from 'next/server';
import { db, ensureDb } from '@/db';
import { dbNow } from '@/db/utils';
import { documents } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { getConvexClient } from '@/lib/convex/server';
import { api } from '../../../../../convex/_generated/api';
import {
  documentStatusToTaskStatus,
  SYNC_SOURCE_KEY,
  SYNC_SOURCE_CONVEX,
} from '@/lib/sync/document-task-sync';
import { getAuthUser, requireRole } from '@/lib/auth';
import { userCanAccessDocument, userCanAccessProject } from '@/lib/access';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await ensureDb();
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;
  const documentId = parseInt(id, 10);
  if (Number.isNaN(documentId)) {
    return NextResponse.json({ error: 'Invalid document id' }, { status: 400 });
  }
  if (!(await userCanAccessDocument(user, documentId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  try {
    const [doc] = await db
      .select()
      .from(documents)
      .where(eq(documents.id, documentId));

    if (!doc) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    return NextResponse.json(doc);
  } catch {
    return NextResponse.json({ error: 'Failed to fetch' }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await ensureDb();
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;
  const documentId = parseInt(id, 10);
  if (Number.isNaN(documentId)) {
    return NextResponse.json({ error: 'Invalid document id' }, { status: 400 });
  }
  if (!(await userCanAccessDocument(user, documentId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  try {
    const body = await req.json();

    const updateData: Record<string, unknown> = { updatedAt: dbNow() };
    if (body.title !== undefined) updateData.title = body.title;
    if (body.content !== undefined) updateData.content = body.content;
    if (body.plainText !== undefined) updateData.plainText = body.plainText;
    if (body.status !== undefined) updateData.status = body.status;
    if (body.contentType !== undefined) updateData.contentType = body.contentType;
    if (body.targetKeyword !== undefined) updateData.targetKeyword = body.targetKeyword;
    if (body.wordCount !== undefined) updateData.wordCount = body.wordCount;
    if (body.aiDetectionScore !== undefined) updateData.aiDetectionScore = body.aiDetectionScore;
    if (body.aiRiskLevel !== undefined) updateData.aiRiskLevel = body.aiRiskLevel;
    if (body.semanticScore !== undefined) updateData.semanticScore = body.semanticScore;
    if (body.contentQualityScore !== undefined)
      updateData.contentQualityScore = body.contentQualityScore;
    if (body.researchSnapshot !== undefined) updateData.researchSnapshot = body.researchSnapshot;
    if (body.outlineSnapshot !== undefined) updateData.outlineSnapshot = body.outlineSnapshot;
    if (body.prewriteChecklist !== undefined) updateData.prewriteChecklist = body.prewriteChecklist;
    if (body.agentQuestions !== undefined) updateData.agentQuestions = body.agentQuestions;
    const parsedProjectId =
      body.projectId !== undefined
        ? (body.projectId ? parseInt(body.projectId, 10) : null)
        : undefined;
    if (parsedProjectId !== undefined) {
      updateData.projectId = parsedProjectId;
    }
    if (body.authorId !== undefined) updateData.authorId = body.authorId || null;

    if (
      body.projectId !== undefined &&
      !(await userCanAccessProject(user, parsedProjectId))
    ) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const [doc] = await db
      .update(documents)
      .set(updateData)
      .where(eq(documents.id, documentId))
      .returning();

    // ── Sync status change to linked Convex task(s) ──────────────────
    if (
      body.status !== undefined &&
      body[SYNC_SOURCE_KEY] !== SYNC_SOURCE_CONVEX
    ) {
      try {
        const convex = getConvexClient();
        if (convex) {
            const linkedTasks = await convex.query(api.tasks.getByDocument, {
              documentId,
              projectId: doc.projectId ?? undefined,
            });
          const targetTaskStatus = documentStatusToTaskStatus(body.status);

          for (const task of linkedTasks) {
            if (task.status !== targetTaskStatus) {
              await convex.mutation(api.tasks.updateStatusFromSync, {
                id: task._id,
                status: targetTaskStatus,
                expectedProjectId: doc.projectId ?? undefined,
              });
            }
          }
        }
      } catch (syncErr) {
        console.error('Sync document status → Convex task failed:', syncErr);
        // Non-blocking: document update already succeeded
      }
    }

    return NextResponse.json(doc);
  } catch {
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await ensureDb();

  const auth = await requireRole('editor');
  if (auth.error) return auth.error;

  const { id } = await params;
  const documentId = parseInt(id, 10);
  if (Number.isNaN(documentId)) {
    return NextResponse.json({ error: 'Invalid document id' }, { status: 400 });
  }
  if (!(await userCanAccessDocument(auth.user, documentId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  try {
    await db.delete(documents).where(eq(documents.id, documentId));
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: 'Failed to delete' }, { status: 500 });
  }
}
