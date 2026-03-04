import { NextRequest, NextResponse } from 'next/server';
import { db, ensureDb } from '@/db';
import { dbNow } from '@/db/utils';
import { documents } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { analyzeContentQuality } from '@/lib/analyzers/content-quality';
import { requireRole } from '@/lib/auth';
import { userCanAccessDocument, userCanAccessProject } from '@/lib/access';
import { logAuditEvent } from '@/lib/observability';

export async function POST(req: NextRequest) {
  const auth = await requireRole('editor');
  if (auth.error) return auth.error;

  await ensureDb();
  try {
    const { documentId, text, contentType, projectId } = await req.json();

    if (!text || text.trim().length < 20) {
      return NextResponse.json(
        { error: 'Text too short for analysis' },
        { status: 400 }
      );
    }
    if (
      documentId !== undefined &&
      documentId !== null &&
      !(await userCanAccessDocument(auth.user, Number(documentId)))
    ) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (
      (documentId === undefined || documentId === null) &&
      projectId !== undefined &&
      projectId !== null &&
      !(await userCanAccessProject(auth.user, Number(projectId)))
    ) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const result = analyzeContentQuality(text, contentType || 'blog_post');

    if (documentId) {
      await db
        .update(documents)
        .set({
          contentQualityScore: result.score,
          updatedAt: dbNow(),
        })
        .where(eq(documents.id, documentId));
    }

    await logAuditEvent({
      userId: auth.user.id,
      action: 'analyze.content_quality',
      resourceType: documentId ? 'document' : 'analysis',
      resourceId: documentId ?? null,
      projectId: projectId ?? null,
      metadata: { textLength: text.length, score: result.score, contentType: contentType || null },
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error('Content quality error:', error);
    return NextResponse.json(
      { error: 'Analysis failed' },
      { status: 500 }
    );
  }
}
