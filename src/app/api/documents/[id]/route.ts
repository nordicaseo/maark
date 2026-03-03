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
import { requireRole } from '@/lib/auth';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await ensureDb();
  const { id } = await params;
  try {
    const [doc] = await db
      .select()
      .from(documents)
      .where(eq(documents.id, parseInt(id, 10)));

    if (!doc) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    return NextResponse.json(doc);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch' }, { status: 500 });
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
    if (body.projectId !== undefined)
      updateData.projectId = body.projectId ? parseInt(body.projectId, 10) : null;
    if (body.authorId !== undefined) updateData.authorId = body.authorId || null;

    const [doc] = await db
      .update(documents)
      .set(updateData)
      .where(eq(documents.id, parseInt(id, 10)))
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
            documentId: parseInt(id, 10),
          });
          const targetTaskStatus = documentStatusToTaskStatus(body.status);

          for (const task of linkedTasks) {
            if (task.status !== targetTaskStatus) {
              await convex.mutation(api.tasks.updateStatusFromSync, {
                id: task._id,
                status: targetTaskStatus,
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
  } catch (error) {
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
  try {
    await db.delete(documents).where(eq(documents.id, parseInt(id, 10)));
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to delete' }, { status: 500 });
  }
}
