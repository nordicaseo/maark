import { and, desc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { pages, sites } from '@/db/schema';
import { classifyDiscoveredUrl } from '@/lib/discovery/url-policy';
import { upsertDiscoveryUrl, upsertEligiblePage } from '@/lib/discovery/ledger';
import { fetchSitemapUrls } from '@/lib/discovery/sitemap';
import { fetchGscTopPages } from '@/lib/discovery/gsc';
import { dbNow } from '@/db/utils';

export interface DiscoveryRunInput {
  projectId: number;
  sitemapUrl?: string | null;
  gscProperty?: string | null;
  gscAccessToken?: string | null;
  gscTopPagesLimit?: number;
  includeInventory?: boolean;
}

export interface DiscoveryRunResult {
  projectId: number;
  siteId: number | null;
  sources: {
    sitemap: number;
    gsc: number;
    inventory: number;
  };
  totals: {
    discovered: number;
    candidates: number;
    excluded: number;
    upsertedPages: number;
  };
  warnings: string[];
}

export async function runDiscoveryForProject(input: DiscoveryRunInput): Promise<DiscoveryRunResult> {
  const warnings: string[] = [];
  const sourceCounters = {
    sitemap: 0,
    gsc: 0,
    inventory: 0,
  };

  const [primarySite] = await db
    .select()
    .from(sites)
    .where(eq(sites.projectId, input.projectId))
    .orderBy(desc(sites.isPrimary), desc(sites.updatedAt))
    .limit(1);

  const siteId = primarySite?.id ?? null;
  const sitemapUrl = input.sitemapUrl || primarySite?.sitemapUrl || null;
  const gscProperty = input.gscProperty || primarySite?.gscProperty || null;
  const gscAccessToken = input.gscAccessToken || process.env.GOOGLE_SEARCH_CONSOLE_ACCESS_TOKEN || null;
  let gscSucceeded = false;
  let gscAttempted = false;
  let gscError: string | null = null;

  const discoveredUrls = new Map<string, { rawUrl: string; source: 'sitemap' | 'gsc' | 'inventory' }>();

  if (sitemapUrl) {
    try {
      const sitemap = await fetchSitemapUrls({ sitemapUrl, maxUrls: 30000, maxSitemaps: 100 });
      for (const raw of sitemap.urls) {
        const key = raw.trim();
        if (!key) continue;
        if (!discoveredUrls.has(key)) {
          discoveredUrls.set(key, { rawUrl: raw, source: 'sitemap' });
          sourceCounters.sitemap += 1;
        }
      }
    } catch (error) {
      warnings.push(`Sitemap discovery failed: ${error instanceof Error ? error.message : 'unknown error'}`);
    }
  } else {
    warnings.push('No sitemap URL configured; skipping sitemap discovery.');
  }

  if (gscProperty && gscAccessToken) {
    gscAttempted = true;
    try {
      const gscPages = await fetchGscTopPages({
        property: gscProperty,
        accessToken: gscAccessToken,
        maxPages: input.gscTopPagesLimit ?? 2000,
        daysBack: 90,
      });
      gscSucceeded = true;
      for (const row of gscPages) {
        const key = row.url.trim();
        if (!key) continue;
        if (!discoveredUrls.has(key)) {
          discoveredUrls.set(key, { rawUrl: row.url, source: 'gsc' });
          sourceCounters.gsc += 1;
        }
      }
    } catch (error) {
      gscError = error instanceof Error ? error.message : 'unknown error';
      warnings.push(`GSC discovery failed: ${gscError}`);
    }
  } else {
    warnings.push('GSC property or access token missing; skipping GSC discovery.');
  }

  if (input.includeInventory !== false) {
    const inventoryPages = await db
      .select({
        url: pages.url,
      })
      .from(pages)
      .where(and(eq(pages.projectId, input.projectId), eq(pages.eligibilityState, 'eligible')))
      .limit(20000);
    for (const row of inventoryPages) {
      const key = String(row.url || '').trim();
      if (!key) continue;
      if (!discoveredUrls.has(key)) {
        discoveredUrls.set(key, { rawUrl: key, source: 'inventory' });
        sourceCounters.inventory += 1;
      }
    }
  }

  let candidates = 0;
  let excluded = 0;
  let upsertedPages = 0;

  for (const item of discoveredUrls.values()) {
    let classified;
    try {
      classified = classifyDiscoveredUrl({ rawUrl: item.rawUrl });
    } catch {
      await upsertDiscoveryUrl({
        projectId: input.projectId,
        siteId,
        url: item.rawUrl,
        normalizedUrl: item.rawUrl.trim().toLowerCase(),
        source: item.source,
        isCandidate: false,
        excludeReason: 'invalid_url',
      });
      excluded += 1;
      continue;
    }

    await upsertDiscoveryUrl({
      projectId: input.projectId,
      siteId,
      url: item.rawUrl,
      normalizedUrl: classified.normalizedUrl,
      source: item.source,
      isCandidate: classified.isCandidate,
      excludeReason: classified.excludeReason,
    });

    if (!classified.isCandidate) {
      excluded += 1;
      continue;
    }

    candidates += 1;
    const page = await upsertEligiblePage({
      projectId: input.projectId,
      siteId,
      url: classified.normalizedUrl,
      normalizedUrl: classified.normalizedUrl,
      discoverySource: item.source,
    });
    if (page) upsertedPages += 1;
  }

  if (siteId) {
    const now = dbNow();
    await db
      .update(sites)
      .set({
        gscConnectedAt: gscProperty ? (primarySite?.gscConnectedAt ?? now) : null,
        gscLastSyncAt: gscAttempted ? now : primarySite?.gscLastSyncAt ?? null,
        gscLastSyncStatus: gscAttempted ? (gscSucceeded ? 'ok' : 'error') : 'never',
        gscLastError: gscAttempted ? (gscSucceeded ? null : gscError) : null,
        updatedAt: now,
      })
      .where(eq(sites.id, siteId));
  }

  return {
    projectId: input.projectId,
    siteId,
    sources: sourceCounters,
    totals: {
      discovered: discoveredUrls.size,
      candidates,
      excluded,
      upsertedPages,
    },
    warnings,
  };
}
