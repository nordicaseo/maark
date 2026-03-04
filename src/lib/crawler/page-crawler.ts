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

export async function crawlPage(url: string): Promise<CrawlResult> {
  const start = Date.now();
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'MaarkCrawler/1.0 (+https://maark.ai)',
      Accept: 'text/html,application/xhtml+xml',
    },
    redirect: 'follow',
  });
  const responseTimeMs = Date.now() - start;
  const finalUrl = response.url || url;
  const html = await response.text();
  const $ = cheerio.load(html);

  const title = $('title').first().text()?.trim() || null;
  const canonicalUrl = $('link[rel="canonical"]').attr('href')?.trim() || null;
  const metaRobots = $('meta[name="robots"]').attr('content')?.trim() || null;

  const isCanonical = canonicalMatches(finalUrl, canonicalUrl);
  const isIndexable = response.status >= 200 && response.status < 300 && !String(metaRobots || '').toLowerCase().includes('noindex');
  const isVerified = response.status === 200 && isIndexable && isCanonical;

  const issues = buildIssues({
    httpStatus: response.status,
    canonicalUrl,
    metaRobots,
    finalUrl,
    title,
  });
  const seoScore = computeSeoScore(issues);

  const contentHash = html
    ? createHash('sha256').update(html).digest('hex')
    : null;

  return {
    requestedUrl: url,
    finalUrl,
    title,
    canonicalUrl,
    metaRobots,
    httpStatus: response.status,
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
    },
  };
}
