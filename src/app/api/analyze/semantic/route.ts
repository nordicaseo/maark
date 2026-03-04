import { NextRequest, NextResponse } from 'next/server';
import { db, ensureDb } from '@/db';
import { dbNow } from '@/db/utils';
import { documents, serpCache } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { scrapeSerpContent } from '@/lib/serp/scraper';
import { TfIdf, extractEntities } from '@/lib/serp/tfidf';
import { analyzeSemanticCoverage } from '@/lib/analyzers/semantic';
import { requireRole } from '@/lib/auth';
import { validateScopedAiContext } from '@/lib/access';
import { logAuditEvent } from '@/lib/observability';

async function getSerpData(keyword: string) {
  await ensureDb();
  // Check cache first
  const [cached] = await db
    .select()
    .from(serpCache)
    .where(eq(serpCache.keyword, keyword.toLowerCase()));

  if (cached) {
    const age = Date.now() - new Date(cached.fetchedAt).getTime();
    const TTL = 48 * 60 * 60 * 1000; // 48 hours
    if (age < TTL) {
      return {
        entities: cached.entities as { term: string }[],
        lsiKeywords: cached.lsiKeywords as { term: string }[],
        topUrls: cached.topUrls as string[],
        fetchedAt: typeof cached.fetchedAt === 'string' ? cached.fetchedAt : cached.fetchedAt.toISOString(),
      };
    }
  }

  // Scrape fresh data
  const { urls, texts } = await scrapeSerpContent(keyword);

  if (texts.length === 0) {
    return {
      entities: [],
      lsiKeywords: [],
      topUrls: [],
      fetchedAt: dbNow(),
    };
  }

  // Extract entities
  const entities = extractEntities(texts);

  // Extract LSI keywords via TF-IDF
  const tfidf = new TfIdf();
  texts.forEach((text) => tfidf.addDocument(text));
  const topTerms = tfidf.getCorpusTopTerms(25);
  const lsiKeywords = topTerms.map((t) => ({
    term: t.term,
    score: Math.round(t.score * 10000) / 10000,
    frequency: t.docFrequency,
  }));

  // Cache results
  if (cached) {
    await db
      .update(serpCache)
      .set({
        entities,
        lsiKeywords,
        topUrls: urls,
        fetchedAt: dbNow(),
      })
      .where(eq(serpCache.keyword, keyword.toLowerCase()));
  } else {
    await db.insert(serpCache).values({
      keyword: keyword.toLowerCase(),
      entities,
      lsiKeywords,
      topUrls: urls,
    });
  }

  return {
    entities,
    lsiKeywords,
    topUrls: urls,
    fetchedAt: dbNow(),
  };
}

export async function POST(req: NextRequest) {
  const auth = await requireRole('editor');
  if (auth.error) return auth.error;

  await ensureDb();
  try {
    const {
      documentId: rawDocumentId,
      text,
      keyword,
      projectId: rawProjectId,
    } = await req.json();

    if (!keyword) {
      return NextResponse.json(
        { error: 'Keyword is required' },
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

    const serpData = await getSerpData(keyword);
    const semantic = analyzeSemanticCoverage(
      text || '',
      serpData.entities,
      serpData.lsiKeywords
    );

    if (documentId) {
      await db
        .update(documents)
        .set({
          semanticScore: semantic.score,
          updatedAt: dbNow(),
        })
        .where(eq(documents.id, documentId));
    }

    await logAuditEvent({
      userId: auth.user.id,
      action: 'analyze.semantic',
      resourceType: documentId ? 'document' : 'analysis',
      resourceId: documentId ?? null,
      projectId: scoped.resolvedProjectId,
      metadata: { keyword, score: semantic.score, textLength: typeof text === 'string' ? text.length : 0 },
    });

    return NextResponse.json({
      semantic,
      serpData: {
        keyword,
        ...serpData,
      },
    });
  } catch (error) {
    console.error('Semantic analysis error:', error);
    return NextResponse.json(
      { error: 'Analysis failed' },
      { status: 500 }
    );
  }
}
