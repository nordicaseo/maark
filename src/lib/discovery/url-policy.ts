import { createHash } from 'crypto';
import type { DiscoveryExcludeReason } from '@/types/page';

const EXCLUDE_PATH_PATTERNS: Array<{ pattern: RegExp; reason: DiscoveryExcludeReason }> = [
  { pattern: /\/(privacy|terms|cookie|gdpr)(\/|$)/i, reason: 'legal_page' },
  { pattern: /\/(contact|kontakt|support|help)(\/|$)/i, reason: 'contact_page' },
  { pattern: /\/(wp-admin|admin|checkout|order-confirmation)(\/|$)/i, reason: 'system_page' },
  { pattern: /\/(search)(\/|$)/i, reason: 'search_page' },
  { pattern: /\/(cart|account|my-account|login|signin|sign-in)(\/|$)/i, reason: 'cart_or_account' },
  { pattern: /\/(tag|category|collections\/all)(\/|$)/i, reason: 'category_or_tag' },
];

const FACET_QUERY_KEYS = new Set([
  'filter',
  'sort',
  'order',
  'view',
  'variant',
  'color',
  'size',
  'price',
  'min_price',
  'max_price',
  'page',
]);

export function normalizeUrlForInventory(input: string): string {
  const url = new URL(input.trim());
  const hostname = url.hostname.toLowerCase();
  const pathname = (url.pathname.replace(/\/+$/, '') || '/').trim() || '/';
  const protocol = url.protocol.toLowerCase();
  return `${protocol}//${hostname}${pathname}`;
}

export function hashNormalizedUrl(normalizedUrl: string): string {
  return createHash('sha256').update(normalizedUrl).digest('hex');
}

export function detectStaticExcludeReason(url: URL): DiscoveryExcludeReason | null {
  if (url.search && url.search.length > 1) {
    const keys = Array.from(url.searchParams.keys()).map((key) => key.toLowerCase());
    if (keys.some((key) => FACET_QUERY_KEYS.has(key))) {
      return 'faceted_variant';
    }
    return 'query_variant';
  }

  for (const entry of EXCLUDE_PATH_PATTERNS) {
    if (entry.pattern.test(url.pathname)) return entry.reason;
  }

  return null;
}

export function resolveEligibility(args: {
  normalizedUrl: string;
  rawUrl?: string | null;
  httpStatus?: number | null;
  robots?: string | null;
  canonicalTarget?: string | null;
}): { isCandidate: boolean; excludeReason: DiscoveryExcludeReason | null } {
  const parsed = new URL(args.rawUrl || args.normalizedUrl);
  const staticReason = detectStaticExcludeReason(parsed);
  if (staticReason) {
    return { isCandidate: false, excludeReason: staticReason };
  }

  if (args.httpStatus !== undefined && args.httpStatus !== null && args.httpStatus !== 200) {
    return { isCandidate: false, excludeReason: 'non_200' };
  }

  const robots = String(args.robots || '').toLowerCase();
  if (robots.includes('noindex')) {
    return { isCandidate: false, excludeReason: 'non_indexable' };
  }

  if (args.canonicalTarget) {
    try {
      const canonicalNormalized = normalizeUrlForInventory(args.canonicalTarget);
      if (canonicalNormalized !== args.normalizedUrl) {
        return { isCandidate: false, excludeReason: 'non_canonical' };
      }
    } catch {
      return { isCandidate: false, excludeReason: 'invalid_url' };
    }
  }

  return { isCandidate: true, excludeReason: null };
}

export function classifyDiscoveredUrl(args: {
  rawUrl: string;
  httpStatus?: number | null;
  robots?: string | null;
  canonicalTarget?: string | null;
}): {
  normalizedUrl: string;
  isCandidate: boolean;
  excludeReason: DiscoveryExcludeReason | null;
} {
  const normalizedUrl = normalizeUrlForInventory(args.rawUrl);
  const eligibility = resolveEligibility({
    normalizedUrl,
    rawUrl: args.rawUrl,
    httpStatus: args.httpStatus,
    robots: args.robots,
    canonicalTarget: args.canonicalTarget,
  });

  return {
    normalizedUrl,
    isCandidate: eligibility.isCandidate,
    excludeReason: eligibility.excludeReason,
  };
}
