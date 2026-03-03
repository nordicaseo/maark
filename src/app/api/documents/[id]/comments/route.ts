import { NextRequest, NextResponse } from 'next/server';
import { db, ensureDb } from '@/db';
import { documentComments, documents } from '@/db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { getAuthUser } from '@/lib/auth';

/**
 * GET /api/documents/:id/comments
 * Returns all comments for a document (auth required).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const documentId = parseInt(id);
  if (isNaN(documentId)) {
    return NextResponse.json({ error: 'Invalid document ID' }, { status: 400 });
  }

  await ensureDb();

  try {
    const results = await db
      .select()
      .from(documentComments)
      .where(eq(documentComments.documentId, documentId))
      .orderBy(desc(documentComments.createdAt));

    return NextResponse.json(results);
  } catch (error) {
    console.error('Error fetching document comments:', error);
    return NextResponse.json([], { status: 200 });
  }
}

/**
 * PATCH /api/documents/:id/comments
 * Resolve or unresolve a comment.
 * Body: { commentId: number, isResolved: boolean }
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const documentId = parseInt(id);
  if (isNaN(documentId)) {
    return NextResponse.json({ error: 'Invalid document ID' }, { status: 400 });
  }

  const body = await req.json();
  const { commentId, isResolved } = body;

  if (!commentId) {
    return NextResponse.json({ error: 'commentId is required' }, { status: 400 });
  }

  await ensureDb();

  try {
    const [updated] = await db
      .update(documentComments)
      .set({ isResolved: isResolved ? 1 : 0 })
      .where(
        and(
          eq(documentComments.id, commentId),
          eq(documentComments.documentId, documentId)
        )
      )
      .returning();

    return NextResponse.json(updated || { ok: true });
  } catch (error) {
    console.error('Error updating comment:', error);
    return NextResponse.json({ error: 'Failed to update comment' }, { status: 500 });
  }
}
