import { NextRequest, NextResponse } from 'next/server';
import { db, ensureDb } from '@/db';
import { documents } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { getAuthUser } from '@/lib/auth';
import { userCanAccessDocument } from '@/lib/access';

/**
 * Lightweight polling endpoint for live writing progress.
 * Returns only draft_content + draft_phase (and content for "complete" phase).
 */
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

  const [doc] = await db
    .select({
      draftContent: documents.draftContent,
      draftPhase: documents.draftPhase,
      content: documents.content,
      status: documents.status,
    })
    .from(documents)
    .where(eq(documents.id, documentId));

  if (!doc) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  return NextResponse.json({
    draftContent: doc.draftContent,
    draftPhase: doc.draftPhase,
    status: doc.status,
    // When writing is complete, send the final content so editor can switch to it
    content: doc.draftPhase === 'complete' ? doc.content : undefined,
  });
}
