import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { dbNow } from '@/db/utils';
import { pages, siteDiscoveryUrls } from '@/db/schema';
import type { DiscoveryExcludeReason, DiscoverySource } from '@/types/page';
import { hashNormalizedUrl } from '@/lib/discovery/url-policy';

interface UpsertDiscoveryArgs {
  projectId: number;
  siteId?: number | null;
  pageId?: number | null;
  url: string;
  normalizedUrl: string;
  source: DiscoverySource;
  isCandidate: boolean;
  excludeReason?: DiscoveryExcludeReason | string | null;
  canonicalTarget?: string | null;
  httpStatus?: number | null;
  robots?: string | null;
  metadata?: Record<string, unknown> | null;
}

export async function upsertDiscoveryUrl(args: UpsertDiscoveryArgs) {
  const now = dbNow();
  const payload = {
    projectId: args.projectId,
    siteId: args.siteId ?? null,
    pageId: args.pageId ?? null,
    url: args.url,
    normalizedUrl: args.normalizedUrl,
    source: args.source,
    isCandidate: args.isCandidate ? 1 : 0,
    excludeReason: args.excludeReason ?? null,
    canonicalTarget: args.canonicalTarget ?? null,
    httpStatus: args.httpStatus ?? null,
    robots: args.robots ?? null,
    metadata: args.metadata ?? null,
    seenAt: now,
    lastSeenAt: now,
    updatedAt: now,
  };

  await db
    .insert(siteDiscoveryUrls)
    .values({
      ...payload,
      createdAt: now,
    })
    .onConflictDoUpdate({
      target: [siteDiscoveryUrls.projectId, siteDiscoveryUrls.normalizedUrl],
      set: payload,
    });

  const [discovery] = await db
    .select()
    .from(siteDiscoveryUrls)
    .where(
      and(
        eq(siteDiscoveryUrls.projectId, args.projectId),
        eq(siteDiscoveryUrls.normalizedUrl, args.normalizedUrl)
      )
    )
    .limit(1);

  return discovery ?? null;
}

interface UpsertInventoryPageArgs {
  projectId: number;
  siteId?: number | null;
  url: string;
  normalizedUrl: string;
  title?: string | null;
  canonicalUrl?: string | null;
  httpStatus?: number | null;
  isIndexable?: boolean;
  isVerified?: boolean;
  responseTimeMs?: number | null;
  contentHash?: string | null;
  discoverySource?: DiscoverySource;
}

export async function upsertEligiblePage(args: UpsertInventoryPageArgs) {
  const now = dbNow();
  const payload = {
    projectId: args.projectId,
    siteId: args.siteId ?? null,
    url: args.url,
    normalizedUrl: args.normalizedUrl,
    urlHash: hashNormalizedUrl(args.normalizedUrl),
    title: args.title ?? null,
    canonicalUrl: args.canonicalUrl ?? null,
    httpStatus: args.httpStatus ?? 200,
    isIndexable: args.isIndexable === false ? 0 : 1,
    isVerified: args.isVerified === false ? 0 : 1,
    discoverySource: args.discoverySource ?? 'inventory',
    eligibilityState: 'eligible',
    excludeReason: null,
    responseTimeMs: args.responseTimeMs ?? null,
    contentHash: args.contentHash ?? null,
    firstSeenAt: now,
    lastSeenAt: now,
    isActive: 1,
    updatedAt: now,
  };

  await db
    .insert(pages)
    .values({
      ...payload,
      createdAt: now,
    })
    .onConflictDoUpdate({
      target: [pages.projectId, pages.normalizedUrl],
      set: {
        siteId: payload.siteId,
        url: payload.url,
        urlHash: payload.urlHash,
        title: payload.title,
        canonicalUrl: payload.canonicalUrl,
        httpStatus: payload.httpStatus,
        isIndexable: payload.isIndexable,
        isVerified: payload.isVerified,
        discoverySource: payload.discoverySource,
        eligibilityState: 'eligible',
        excludeReason: null,
        responseTimeMs: payload.responseTimeMs,
        contentHash: payload.contentHash,
        lastSeenAt: now,
        isActive: 1,
        updatedAt: now,
      },
    });

  const [page] = await db
    .select()
    .from(pages)
    .where(and(eq(pages.projectId, args.projectId), eq(pages.normalizedUrl, args.normalizedUrl)))
    .limit(1);

  return page ?? null;
}

export async function retirePageFromInventory(args: {
  pageId: number;
  excludeReason: DiscoveryExcludeReason | string;
  httpStatus?: number | null;
  isIndexable?: boolean;
  canonicalUrl?: string | null;
}) {
  await db
    .update(pages)
    .set({
      eligibilityState: 'retired',
      excludeReason: args.excludeReason,
      isIndexable: args.isIndexable === false ? 0 : 1,
      isVerified: 0,
      httpStatus: args.httpStatus ?? null,
      canonicalUrl: args.canonicalUrl ?? null,
      isActive: 0,
      updatedAt: dbNow(),
    })
    .where(eq(pages.id, args.pageId));
}

