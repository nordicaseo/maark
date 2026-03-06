import * as cheerio from 'cheerio';
import { createHash } from 'crypto';

export type CrawlIssue = {
  issueType: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
  metadata?: Record<string, unknown>;
};

export type CrawlResult = {
  requestedUrl: string;
  finalUrl: string;
  rawHtml: string;
  rawMarkdown: string | null;
  title: string | null;
  canonicalUrl: string | null;
  metaRobots: string | null;
  httpStatus: number;
  responseTimeMs: number;
  contentHash: string | null;
  isIndexable: boolean;
  isCanonical: boolean;
  isVerified: boolean;
  seoScore: number;
  issues: CrawlIssue[];
  snapshotData: Record<string, unknown>;
};

type FirecrawlScrapeResponse = {
  success?: boolean;
  data?: {
    html?: string;
    markdown?: string;
    metadata?: {
      title?: string;
      sourceURL?: string;
      statusCode?: number;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  error?: string;
  [key: string]: unknown;
};

function normalizeUrl(input: string): string {
  try {
    const u = new URL(input);
    const path = u.pathname.replace(/\/+$/, '') || '/';
    return `${u.origin}${path}${u.search}`;
  } catch {
    return input.trim();
  }
}

function canonicalMatches(finalUrl: string, canonicalUrl: string | null): boolean {
  if (!canonicalUrl) return true;
  return normalizeUrl(finalUrl) === normalizeUrl(canonicalUrl);
}

function buildIssues(ctx: {
  httpStatus: number;
  canonicalUrl: string | null;
  metaRobots: string | null;
  finalUrl: string;
  title: string | null;
}): CrawlIssue[] {
  const issues: CrawlIssue[] = [];

  if (ctx.httpStatus >= 400) {
    issues.push({
      issueType: 'http_error',
      severity: ctx.httpStatus >= 500 ? 'critical' : 'high',
      message: `Page returned HTTP ${ctx.httpStatus}.`,
      metadata: { status: ctx.httpStatus },
    });
  } else if (ctx.httpStatus >= 300) {
    issues.push({
      issueType: 'redirect',
      severity: 'medium',
      message: `Page resolves with redirect status HTTP ${ctx.httpStatus}.`,
      metadata: { status: ctx.httpStatus },
    });
  }

  if (!ctx.title || ctx.title.trim().length < 10) {
    issues.push({
      issueType: 'title_missing_or_short',
      severity: 'medium',
      message: 'Title tag is missing or too short.',
      metadata: { titleLength: ctx.title?.length ?? 0 },
    });
  }

  const robots = (ctx.metaRobots || '').toLowerCase();
  if (robots.includes('noindex')) {
    issues.push({
      issueType: 'meta_noindex',
      severity: 'high',
      message: 'Meta robots contains noindex.',
      metadata: { metaRobots: ctx.metaRobots },
    });
  }

  if (!ctx.canonicalUrl) {
    issues.push({
      issueType: 'canonical_missing',
      severity: 'medium',
      message: 'Canonical tag is missing.',
    });
  } else if (!canonicalMatches(ctx.finalUrl, ctx.canonicalUrl)) {
    issues.push({
      issueType: 'canonical_mismatch',
      severity: 'high',
      message: 'Canonical URL does not match crawled URL.',
      metadata: { canonicalUrl: ctx.canonicalUrl, finalUrl: ctx.finalUrl },
    });
  }

  return issues;
}

function computeSeoScore(issues: CrawlIssue[]): number {
  let score = 100;
  for (const issue of issues) {
    if (issue.severity === 'critical') score -= 35;
    else if (issue.severity === 'high') score -= 20;
    else if (issue.severity === 'medium') score -= 10;
    else score -= 4;
  }
  return Math.max(0, score);
}

async function scrapeWithFirecrawl(url: string): Promise<{
  html: string;
  markdown: string | null;
  finalUrl: string;
  statusCode: number;
  titleFromMetadata: string | null;
}> {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) {
    throw new Error('FIRECRAWL_API_KEY is not configured.');
  }

  const response = await fetch('https://api.firecrawl.dev/v1/scrape', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      url,
      formats: ['html', 'markdown'],
      onlyMainContent: false,
      timeout: 30000,
    }),
  });

  const json = (await response.json().catch(() => ({}))) as FirecrawlScrapeResponse;
  if (!response.ok || !json.success) {
    const reason = json.error || `HTTP ${response.status}`;
    throw new Error(`Firecrawl scrape failed: ${reason}`);
  }

  const html = String(json.data?.html || '').trim();
  if (!html) {
    throw new Error('Firecrawl scrape returned empty HTML.');
  }
  const markdown = String(json.data?.markdown || '').trim() || null;

  const finalUrl = String(json.data?.metadata?.sourceURL || url).trim() || url;
  const statusCode = Number(json.data?.metadata?.statusCode || 200);
  const titleFromMetadata = String(json.data?.metadata?.title || '').trim() || null;

  return {
    html,
    markdown,
    finalUrl,
    statusCode: Number.isFinite(statusCode) ? statusCode : 200,
    titleFromMetadata,
  };
}

export async function crawlPage(url: string): Promise<CrawlResult> {
  const start = Date.now();
  const scraped = await scrapeWithFirecrawl(url);
  const responseTimeMs = Date.now() - start;

  const $ = cheerio.load(scraped.html);
  const title = $('title').first().text()?.trim() || scraped.titleFromMetadata || null;
  const canonicalUrl = $('link[rel="canonical"]').attr('href')?.trim() || null;
  const metaRobots = $('meta[name="robots"]').attr('content')?.trim() || null;
  const finalUrl = scraped.finalUrl;

  const isCanonical = canonicalMatches(finalUrl, canonicalUrl);
  const isIndexable =
    scraped.statusCode >= 200 &&
    scraped.statusCode < 300 &&
    !String(metaRobots || '').toLowerCase().includes('noindex');
  const isVerified = scraped.statusCode === 200 && isIndexable && isCanonical;

  const issues = buildIssues({
    httpStatus: scraped.statusCode,
    canonicalUrl,
    metaRobots,
    finalUrl,
    title,
  });
  const seoScore = computeSeoScore(issues);

  const contentHash = scraped.html
    ? createHash('sha256').update(scraped.html).digest('hex')
    : null;

  return {
    requestedUrl: url,
    finalUrl,
    rawHtml: scraped.html,
    rawMarkdown: scraped.markdown,
    title,
    canonicalUrl,
    metaRobots,
    httpStatus: scraped.statusCode,
    responseTimeMs,
    contentHash,
    isIndexable,
    isCanonical,
    isVerified,
    seoScore,
    issues,
    snapshotData: {
      h1: $('h1').first().text()?.trim() || null,
      title,
      canonicalUrl,
      metaRobots,
      wordCountApprox: $('body').text().trim().split(/\s+/).filter(Boolean).length,
      provider: 'firecrawl',
    },
  };
}
