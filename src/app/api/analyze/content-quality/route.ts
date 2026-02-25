import { NextRequest, NextResponse } from 'next/server';
import { db, ensureDb } from '@/db';
import { documents } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { analyzeContentQuality } from '@/lib/analyzers/content-quality';

export async function POST(req: NextRequest) {
  await ensureDb();
  try {
    const { documentId, text, contentType } = await req.json();

    if (!text || text.trim().length < 20) {
      return NextResponse.json(
        { error: 'Text too short for analysis' },
        { status: 400 }
      );
    }

    const result = analyzeContentQuality(text, contentType || 'blog_post');

    if (documentId) {
      await db
        .update(documents)
        .set({
          contentQualityScore: result.score,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(documents.id, documentId));
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error('Content quality error:', error);
    return NextResponse.json(
      { error: 'Analysis failed' },
      { status: 500 }
    );
  }
}
