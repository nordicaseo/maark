import { NextRequest, NextResponse } from 'next/server';
import { db, ensureDb } from '@/db';
import { documents } from '@/db/schema';
import { eq } from 'drizzle-orm';

export async function POST(req: NextRequest) {
  await ensureDb();
  try {
    const { documentId, text } = await req.json();

    if (!text || text.trim().length < 50) {
      return NextResponse.json(
        { error: 'Text too short for analysis (min 50 characters)' },
        { status: 400 }
      );
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
          updatedAt: new Date().toISOString(),
        })
        .where(eq(documents.id, documentId));
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error('AI detection error:', error);
    return NextResponse.json(
      { error: 'Analysis failed' },
      { status: 500 }
    );
  }
}
