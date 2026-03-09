import { and, eq, ne, or, sql } from 'drizzle-orm';
import { db } from '@/db';
import { pages, keywords, pageKeywordMappings, taskPageLinks } from '@/db/schema';

// ── Types ──────────────────────────────────────────────────────────

export interface InternalLinkCandidate {
  pageId: number;
  url: string;
  title: string | null;
  primaryKeyword: string | null;
  relevanceReason: 'keyword_primary' | 'keyword_secondary' | 'title_match';
}

// ── Helpers ────────────────────────────────────────────────────────

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'your', 'how',
  'what', 'when', 'where', 'which', 'who', 'why', 'are', 'was', 'were',
  'been', 'being', 'have', 'has', 'had', 'does', 'did', 'will', 'would',
  'could', 'should', 'may', 'might', 'must', 'shall', 'can', 'need',
  'into', 'about', 'over', 'than', 'them', 'then', 'very', 'just',
  'also', 'only', 'most', 'more', 'some', 'such', 'each', 'every',
  'best', 'good', 'like', 'make', 'made', 'many', 'much', 'well',
]);

function extractSignificantWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !STOPWORDS.has(w))
    .slice(0, 6);
}

// ── Resolve task self-page ─────────────────────────────────────────

/**
 * Finds the page that the current task is about (via taskPageLinks),
 * so we can exclude it from internal link suggestions.
 */
export async function resolveTaskSelfPageId(args: {
  taskId: string;
  projectId?: number | null;
}): Promise<number | null> {
  const filters = [eq(taskPageLinks.taskId, args.taskId)];
  if (args.projectId) filters.push(eq(taskPageLinks.projectId, args.projectId));

  const [link] = await db
    .select({ pageId: taskPageLinks.pageId })
    .from(taskPageLinks)
    .where(and(...filters))
    .limit(1);

  return link?.pageId ? Number(link.pageId) : null;
}

// ── Resolve internal link candidates ───────────────────────────────

/**
 * Finds relevant internal pages based on keyword overlap and title matching.
 * Uses a tiered approach: primary keyword > secondary keyword > title match.
 * Returns deduplicated candidates ordered by relevance.
 */
export async function resolveInternalLinkCandidates(args: {
  projectId: number;
  targetKeyword: string;
  excludePageId?: number | null;
  limit?: number;
}): Promise<InternalLinkCandidate[]> {
  const { projectId, targetKeyword, excludePageId, limit = 8 } = args;
  const words = extractSignificantWords(targetKeyword);
  if (words.length === 0) return [];

  const pageEligibilityFilters = [
    eq(pages.projectId, projectId),
    eq(pages.eligibilityState, 'eligible'),
    eq(pages.isIndexable, 1),
    eq(pages.httpStatus, 200),
    eq(pages.isActive, 1),
    ...(excludePageId ? [ne(pages.id, excludePageId)] : []),
  ];

  const keywordLikeConditions = or(
    ...words.map((w) => sql`LOWER(${keywords.keyword}) LIKE ${`%${w}%`}`)
  );

  const titleLikeConditions = or(
    ...words.map((w) => sql`LOWER(${pages.title}) LIKE ${`%${w}%`}`)
  );

  // Run keyword and title queries in parallel
  const [keywordMatches, titleMatches] = await Promise.all([
    // Query 1: Pages with keyword overlap (primary + secondary)
    db
      .select({
        pageId: pages.id,
        url: pages.url,
        title: pages.title,
        matchedKeyword: keywords.keyword,
        mappingType: pageKeywordMappings.mappingType,
      })
      .from(pageKeywordMappings)
      .innerJoin(keywords, eq(keywords.id, pageKeywordMappings.keywordId))
      .innerJoin(pages, eq(pages.id, pageKeywordMappings.pageId))
      .where(
        and(
          eq(pageKeywordMappings.projectId, projectId),
          ...pageEligibilityFilters,
          keywordLikeConditions,
        )
      )
      .limit(20),

    // Query 2: Pages with title overlap (fallback)
    db
      .select({
        id: pages.id,
        url: pages.url,
        title: pages.title,
      })
      .from(pages)
      .where(
        and(
          ...pageEligibilityFilters,
          titleLikeConditions,
        )
      )
      .limit(10),
  ]);

  // Merge and deduplicate: primary keyword > secondary keyword > title match
  const seen = new Set<number>();
  const candidates: InternalLinkCandidate[] = [];

  // Tier 1: Primary keyword matches
  for (const row of keywordMatches) {
    if (row.mappingType === 'primary' && !seen.has(row.pageId)) {
      seen.add(row.pageId);
      candidates.push({
        pageId: row.pageId,
        url: row.url,
        title: row.title,
        primaryKeyword: row.matchedKeyword,
        relevanceReason: 'keyword_primary',
      });
    }
  }

  // Tier 2: Secondary keyword matches
  for (const row of keywordMatches) {
    if (row.mappingType === 'secondary' && !seen.has(row.pageId)) {
      seen.add(row.pageId);
      // Find this page's primary keyword from the results if available
      const primaryMatch = keywordMatches.find(
        (r: typeof keywordMatches[number]) => r.pageId === row.pageId && r.mappingType === 'primary'
      );
      candidates.push({
        pageId: row.pageId,
        url: row.url,
        title: row.title,
        primaryKeyword: primaryMatch?.matchedKeyword || null,
        relevanceReason: 'keyword_secondary',
      });
    }
  }

  // Tier 3: Title matches
  for (const row of titleMatches) {
    if (!seen.has(row.id)) {
      seen.add(row.id);
      candidates.push({
        pageId: row.id,
        url: row.url,
        title: row.title,
        primaryKeyword: null,
        relevanceReason: 'title_match',
      });
    }
  }

  return candidates.slice(0, limit);
}
