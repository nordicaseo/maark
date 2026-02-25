import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { documents, serpCache } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { scrapeSerpContent } from '@/lib/serp/scraper';
import { TfIdf, extractEntities } from '@/lib/serp/tfidf';
import { analyzeSemanticCoverage } from '@/lib/analyzers/semantic';

async function getSerpData(keyword: string) {
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
        entities: cached.entities as any[],
        lsiKeywords: cached.lsiKeywords as any[],
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
      fetchedAt: new Date().toISOString(),
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
        fetchedAt: new Date().toISOString(),
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
    fetchedAt: new Date().toISOString(),
  };
}

export async function POST(req: NextRequest) {
  try {
    const { documentId, text, keyword } = await req.json();

    if (!keyword) {
      return NextResponse.json(
        { error: 'Keyword is required' },
        { status: 400 }
      );
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
          updatedAt: new Date().toISOString(),
        })
        .where(eq(documents.id, documentId));
    }

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
