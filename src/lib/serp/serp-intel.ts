import { eq } from 'drizzle-orm';
import { db, ensureDb } from '@/db';
import { dbNow } from '@/db/utils';
import { serpCache } from '@/db/schema';
import { extractEntities, TfIdf } from '@/lib/serp/tfidf';
import { fetchSerpUrls, scrapePageContent } from '@/lib/serp/scraper';
import { fetchDataForSeoOrganic } from '@/lib/serp/providers/dataforseo';
import { fetchSerpApiOrganic } from '@/lib/serp/providers/serpapi';

export interface SerpCompetitor {
  rank: number;
  url: string;
  domain: string;
  title: string;
  snippet?: string;
}

export interface SerpIntelTerm {
  term: string;
  score?: number;
  frequency?: number;
  sources?: number;
}

export interface SerpIntelSnapshot {
  keyword: string;
  provider: 'dataforseo' | 'serpapi' | 'local' | 'cache';
  fetchedAt: string;
  competitors: SerpCompetitor[];
  entities: SerpIntelTerm[];
  lsiKeywords: SerpIntelTerm[];
  suggestions: string[];
  sources: Array<{ url: string; title?: string }>;
}

function normalizeKeyword(keyword: string): string {
  return keyword.trim().toLowerCase();
}

function getDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, '');
  } catch {
    return '';
  }
}

function uniqueByTerm(terms: SerpIntelTerm[], max = 30): SerpIntelTerm[] {
  const seen = new Set<string>();
  const out: SerpIntelTerm[] = [];
  for (const term of terms) {
    const key = String(term.term || '').toLowerCase().trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(term);
    if (out.length >= max) break;
  }
  return out;
}

function buildSuggestions(args: {
  keyword: string;
  competitors: SerpCompetitor[];
  entities: SerpIntelTerm[];
  lsiKeywords: SerpIntelTerm[];
}): string[] {
  const suggestions: string[] = [];
  const topDomains = Array.from(
    new Set(args.competitors.map((c) => c.domain).filter(Boolean))
  ).slice(0, 4);

  suggestions.push(
    `Match SERP intent for "${args.keyword}" before drafting outline sections.`
  );
  if (topDomains.length > 0) {
    suggestions.push(`Benchmark against top competitors: ${topDomains.join(', ')}.`);
  }
  if (args.entities.length > 0) {
    suggestions.push(
      `Include core entities early: ${args.entities
        .slice(0, 6)
        .map((t) => t.term)
        .join(', ')}.`
    );
  }
  if (args.lsiKeywords.length > 0) {
    suggestions.push(
      `Cover related terms naturally: ${args.lsiKeywords
        .slice(0, 8)
        .map((t) => t.term)
        .join(', ')}.`
    );
  }
  suggestions.push(
    'Align heading structure with recurring SERP patterns and include unique value gaps.'
  );

  return suggestions.slice(0, 6);
}

async function extractTermsFromCorpus(corpus: string[]) {
  const entities = extractEntities(corpus)
    .map((item) => ({
      term: item.term,
      frequency: item.frequency,
      sources: item.sources,
    }))
    .slice(0, 24);

  const tfidf = new TfIdf();
  corpus.forEach((text) => tfidf.addDocument(text));
  const lsiKeywords = tfidf
    .getCorpusTopTerms(30)
    .map((term) => ({
      term: term.term,
      score: Number(term.score.toFixed(6)),
      frequency: term.docFrequency,
    }))
    .slice(0, 24);

  return {
    entities: uniqueByTerm(entities, 24),
    lsiKeywords: uniqueByTerm(lsiKeywords, 24),
  };
}

async function runLocalSerpFallback(keyword: string): Promise<{
  provider: 'local';
  competitors: SerpCompetitor[];
}> {
  const serpUrls = await fetchSerpUrls(keyword);
  const competitors = serpUrls
    .map((item, index) => ({
      rank: index + 1,
      url: item.url,
      domain: getDomain(item.url),
      title: item.title || item.url,
    }))
    .filter((item) => item.domain)
    .slice(0, 10);

  if (competitors.length === 0) {
    throw new Error('No local SERP sources available (Google CSE not configured).');
  }

  return {
    provider: 'local',
    competitors,
  };
}

async function gatherCorpusFromCompetitors(
  competitors: SerpCompetitor[]
): Promise<string[]> {
  const corpus = competitors
    .map((item) => `${item.title}\n${item.snippet || ''}`.trim())
    .filter(Boolean);

  const scrapeTargets = competitors.slice(0, 4);
  const pageResults = await Promise.allSettled(
    scrapeTargets.map((item) => scrapePageContent(item.url))
  );
  for (const result of pageResults) {
    if (result.status === 'fulfilled' && result.value.trim().length > 120) {
      corpus.push(result.value.trim());
    }
  }
  return corpus;
}

async function readCachedSnapshot(
  normalizedKeyword: string,
  ttlHours: number
): Promise<SerpIntelSnapshot | null> {
  await ensureDb();
  const [cached] = await db
    .select()
    .from(serpCache)
    .where(eq(serpCache.keyword, normalizedKeyword))
    .limit(1);

  if (!cached) return null;

  const fetchedAt =
    typeof cached.fetchedAt === 'string'
      ? new Date(cached.fetchedAt)
      : cached.fetchedAt;
  const age = Date.now() - fetchedAt.getTime();
  if (age > ttlHours * 60 * 60 * 1000) return null;

  const urls = Array.isArray(cached.topUrls)
    ? (cached.topUrls as string[]).filter(Boolean).slice(0, 10)
    : [];
  const entities = Array.isArray(cached.entities)
    ? (cached.entities as SerpIntelTerm[]).slice(0, 24)
    : [];
  const lsiKeywords = Array.isArray(cached.lsiKeywords)
    ? (cached.lsiKeywords as SerpIntelTerm[]).slice(0, 24)
    : [];

  if (urls.length === 0 && entities.length === 0 && lsiKeywords.length === 0) {
    return null;
  }

  const competitors: SerpCompetitor[] = urls.map((url, idx) => ({
    rank: idx + 1,
    url,
    domain: getDomain(url),
    title: getDomain(url) || url,
  }));

  return {
    keyword: normalizedKeyword,
    provider: 'cache',
    fetchedAt: fetchedAt.toISOString(),
    competitors,
    entities,
    lsiKeywords,
    suggestions: buildSuggestions({
      keyword: normalizedKeyword,
      competitors,
      entities,
      lsiKeywords,
    }),
    sources: competitors.map((item) => ({ url: item.url, title: item.title })),
  };
}

async function writeCache(snapshot: SerpIntelSnapshot) {
  await ensureDb();
  const [cached] = await db
    .select({ id: serpCache.id })
    .from(serpCache)
    .where(eq(serpCache.keyword, snapshot.keyword))
    .limit(1);

  const cachePayload = {
    entities: snapshot.entities,
    lsiKeywords: snapshot.lsiKeywords,
    topUrls: snapshot.competitors.map((item) => item.url),
    fetchedAt: dbNow(),
  };

  if (cached?.id) {
    await db
      .update(serpCache)
      .set(cachePayload)
      .where(eq(serpCache.id, cached.id));
  } else {
    await db.insert(serpCache).values({
      keyword: snapshot.keyword,
      ...cachePayload,
    });
  }
}

export async function getSerpIntelSnapshot(args: {
  keyword: string;
  projectId?: number;
  preferFresh?: boolean;
  ttlHours?: number;
  locationName?: string;
  languageName?: string;
}): Promise<SerpIntelSnapshot> {
  const normalizedKeyword = normalizeKeyword(args.keyword);
  if (!normalizedKeyword) {
    throw new Error('Keyword is required for SERP intel');
  }

  const ttlHours = Math.max(6, Math.min(args.ttlHours ?? 168, 24 * 14));
  if (!args.preferFresh) {
    const cached = await readCachedSnapshot(normalizedKeyword, ttlHours);
    if (cached) return cached;
  }

  const errors: string[] = [];

  let providerResult:
    | { provider: 'dataforseo' | 'serpapi' | 'local'; competitors: SerpCompetitor[] }
    | null = null;

  try {
    const result = await fetchDataForSeoOrganic({
      keyword: normalizedKeyword,
      locationName: args.locationName,
      languageName: args.languageName,
    });
    providerResult = {
      provider: result.provider,
      competitors: result.competitors,
    };
  } catch (error) {
    errors.push(`dataforseo: ${error instanceof Error ? error.message : 'unknown error'}`);
  }

  if (!providerResult) {
    try {
      const result = await fetchSerpApiOrganic({
        keyword: normalizedKeyword,
      });
      providerResult = {
        provider: result.provider,
        competitors: result.competitors,
      };
    } catch (error) {
      errors.push(`serpapi: ${error instanceof Error ? error.message : 'unknown error'}`);
    }
  }

  if (!providerResult) {
    try {
      providerResult = await runLocalSerpFallback(normalizedKeyword);
    } catch (error) {
      errors.push(`local: ${error instanceof Error ? error.message : 'unknown error'}`);
    }
  }

  if (!providerResult) {
    throw new Error(`SERP intel failed for "${normalizedKeyword}": ${errors.join(' | ')}`);
  }

  const competitors = providerResult.competitors.slice(0, 10);
  const corpus = await gatherCorpusFromCompetitors(competitors);
  const { entities, lsiKeywords } =
    corpus.length > 0
      ? await extractTermsFromCorpus(corpus)
      : { entities: [], lsiKeywords: [] };

  const snapshot: SerpIntelSnapshot = {
    keyword: normalizedKeyword,
    provider: providerResult.provider,
    fetchedAt: new Date().toISOString(),
    competitors,
    entities,
    lsiKeywords,
    suggestions: buildSuggestions({
      keyword: normalizedKeyword,
      competitors,
      entities,
      lsiKeywords,
    }),
    sources: competitors.map((item) => ({
      url: item.url,
      title: item.title,
    })),
  };

  await writeCache(snapshot);
  return snapshot;
}

