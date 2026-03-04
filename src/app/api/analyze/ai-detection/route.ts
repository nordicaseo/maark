import { NextRequest, NextResponse } from 'next/server';
import { db, ensureDb } from '@/db';
import { dbNow } from '@/db/utils';
import { documents } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { requireRole } from '@/lib/auth';
import { validateScopedAiContext } from '@/lib/access';
import { logAuditEvent } from '@/lib/observability';

export async function POST(req: NextRequest) {
  const auth = await requireRole('editor');
  if (auth.error) return auth.error;

  await ensureDb();
  try {
    const { documentId: rawDocumentId, text, projectId: rawProjectId } = await req.json();

    if (!text || text.trim().length < 50) {
      return NextResponse.json(
        { error: 'Text too short for analysis (min 50 characters)' },
        { status: 400 }
      );
    }
    const parsedDocumentId = rawDocumentId !== undefined && rawDocumentId !== null
      ? Number(rawDocumentId)
      : null;
    const parsedProjectId = rawProjectId !== undefined && rawProjectId !== null
      ? Number(rawProjectId)
      : null;
    const documentId = Number.isFinite(parsedDocumentId) ? parsedDocumentId : null;
    const projectId = Number.isFinite(parsedProjectId) ? parsedProjectId : null;

    const scoped = await validateScopedAiContext(auth.user, { documentId, projectId });
    if (!scoped.ok) {
      return NextResponse.json({ error: scoped.error || 'Forbidden' }, { status: scoped.statusCode || 403 });
    }

    // Dynamic import to avoid loading heavy module on every request
    const { analyzeAiDetection } = await import('@/lib/analyzers/ai-detection');
    const result = analyzeAiDetection(text);

    // Update document scores
    if (documentId) {
      await db
        .update(documents)
        .set({
          aiDetectionScore: result.compositeScore,
          aiRiskLevel: result.riskLevel,
          updatedAt: dbNow(),
        })
        .where(eq(documents.id, documentId));
    }

    await logAuditEvent({
      userId: auth.user.id,
      action: 'analyze.ai_detection',
      resourceType: documentId ? 'document' : 'analysis',
      resourceId: documentId ?? null,
      projectId: scoped.resolvedProjectId,
      metadata: { textLength: text.length, compositeScore: result.compositeScore },
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error('AI detection error:', error);
    return NextResponse.json(
      { error: 'Analysis failed' },
      { status: 500 }
    );
  }
}
