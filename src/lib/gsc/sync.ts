import { and, desc, eq, gte, lte } from 'drizzle-orm';
import { db } from '@/db';
import { dbNow } from '@/db/utils';
import { gscPageDailyMetrics, pages, sites } from '@/db/schema';
import { normalizeUrlForInventory } from '@/lib/discovery/url-policy';
import { refreshGoogleAccessToken } from '@/lib/gsc/oauth';

interface GscListSitesResponse {
  siteEntry?: Array<{
    siteUrl?: string;
    permissionLevel?: string;
  }>;
}

interface GscSearchAnalyticsResponse {
  rows?: Array<{
    keys?: string[];
    clicks?: number;
    impressions?: number;
    ctr?: number;
    position?: number;
  }>;
}

function toIsoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function parseTime(value: unknown): number | null {
  if (!value) return null;
  if (value instanceof Date) return value.getTime();
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function getExpiresAt(expiresInSec: number | undefined): Date | string | null {
  if (!expiresInSec || !Number.isFinite(expiresInSec)) return null;
  const ms = Date.now() + Math.max(0, Number(expiresInSec) - 60) * 1000;
  return process.env.POSTGRES_URL ? new Date(ms) : new Date(ms).toISOString();
}

function resolveOrigin() {
  return process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_PROJECT_PRODUCTION_URL || 'https://www.maark.ai';
}

export async function getPrimarySiteForProject(projectId: number) {
  const [site] = await db
    .select()
    .from(sites)
    .where(eq(sites.projectId, projectId))
    .orderBy(desc(sites.isPrimary), desc(sites.updatedAt))
    .limit(1);
  return site ?? null;
}

export async function ensureGscAccessTokenForProject(projectId: number) {
  const site = await getPrimarySiteForProject(projectId);
  if (!site) throw new Error('No site configured for project.');

  const token = site.gscAccessToken ? String(site.gscAccessToken) : null;
  const refreshToken = site.gscRefreshToken ? String(site.gscRefreshToken) : null;
  const expiresAtMs = parseTime(site.gscTokenExpiresAt);

  if (token && (expiresAtMs === null || expiresAtMs > Date.now() + 60_000)) {
    return { site, accessToken: token };
  }

  if (!refreshToken) {
    throw new Error('GSC refresh token missing. Reconnect Google Search Console.');
  }

  const refreshed = await refreshGoogleAccessToken(refreshToken);
  const now = dbNow();
  const tokenExpiresAt = getExpiresAt(refreshed.expires_in);

  await db
    .update(sites)
    .set({
      gscAccessToken: refreshed.access_token,
      gscRefreshToken: refreshToken,
      gscTokenExpiresAt: tokenExpiresAt,
      gscConnectedAt: site.gscConnectedAt ?? now,
      updatedAt: now,
    })
    .where(eq(sites.id, site.id));

  const updatedSite = await getPrimarySiteForProject(projectId);
  if (!updatedSite) throw new Error('Site disappeared while refreshing GSC token.');

  return { site: updatedSite, accessToken: refreshed.access_token };
}

export async function listGscPropertiesForProject(projectId: number) {
  const { accessToken } = await ensureGscAccessTokenForProject(projectId);

  const response = await fetch('https://www.googleapis.com/webmasters/v3/sites', {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  });

  const data = (await response.json().catch(() => ({}))) as GscListSitesResponse & { error?: { message?: string } };
  if (!response.ok) {
    throw new Error(data?.error?.message || `Failed to list GSC properties (${response.status})`);
  }

  return (data.siteEntry || [])
    .filter((entry) => entry.siteUrl)
    .map((entry) => ({
      siteUrl: String(entry.siteUrl),
      permissionLevel: String(entry.permissionLevel || 'unknown'),
    }));
}

async function fetchSearchAnalyticsRows(args: {
  property: string;
  accessToken: string;
  startDate: string;
  endDate: string;
  rowLimit?: number;
  maxRows?: number;
}) {
  const rowLimit = Math.min(Math.max(args.rowLimit ?? 25000, 1), 25000);
  const maxRows = Math.min(Math.max(args.maxRows ?? 200000, rowLimit), 250000);
  const rows: NonNullable<GscSearchAnalyticsResponse['rows']> = [];

  let startRow = 0;
  while (startRow < maxRows) {
    const response = await fetch(
      `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(args.property)}/searchAnalytics/query`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${args.accessToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          startDate: args.startDate,
          endDate: args.endDate,
          dimensions: ['page', 'date'],
          rowLimit,
          startRow,
          searchType: 'web',
          aggregationType: 'auto',
        }),
      }
    );

    const payload = (await response.json().catch(() => ({}))) as GscSearchAnalyticsResponse & { error?: { message?: string } };
    if (!response.ok) {
      throw new Error(payload?.error?.message || `Failed GSC searchAnalytics query (${response.status})`);
    }

    const chunk = payload.rows || [];
    if (chunk.length === 0) break;

    rows.push(...chunk);
    if (chunk.length < rowLimit) break;
    startRow += rowLimit;
  }

  return rows;
}

export async function syncGscPerformanceForProject(args: {
  projectId: number;
  daysBack?: number;
  endDate?: Date;
}) {
  const daysBack = Math.max(1, Math.min(args.daysBack ?? 480, 550));
  const endDate = args.endDate || new Date();
  const startDate = new Date(endDate.getTime() - (daysBack - 1) * 24 * 60 * 60 * 1000);

  const { site, accessToken } = await ensureGscAccessTokenForProject(args.projectId);
  if (!site.gscProperty) {
    throw new Error('GSC property is not set for this project.');
  }

  const property = String(site.gscProperty);

  const rows = await fetchSearchAnalyticsRows({
    property,
    accessToken,
    startDate: toIsoDate(startDate),
    endDate: toIsoDate(endDate),
  });

  const inventoryPages = await db
    .select({
      id: pages.id,
      normalizedUrl: pages.normalizedUrl,
    })
    .from(pages)
    .where(and(eq(pages.projectId, args.projectId), eq(pages.isActive, 1)));

  const pageByNormalized = new Map<string, number>();
  for (const row of inventoryPages) {
    if (row.normalizedUrl) pageByNormalized.set(String(row.normalizedUrl), row.id);
  }

  let upserted = 0;
  const now = dbNow();
  for (const row of rows) {
    const keys = row.keys || [];
    if (keys.length < 2) continue;

    const rawUrl = String(keys[0] || '').trim();
    const date = String(keys[1] || '').trim();
    if (!rawUrl || !date) continue;

    let normalizedUrl: string;
    try {
      normalizedUrl = normalizeUrlForInventory(rawUrl);
    } catch {
      continue;
    }

    const pageId = pageByNormalized.get(normalizedUrl) ?? null;

    await db
      .insert(gscPageDailyMetrics)
      .values({
        projectId: args.projectId,
        siteId: site.id,
        pageId,
        date,
        url: rawUrl,
        normalizedUrl,
        clicks: Number(row.clicks || 0),
        impressions: Number(row.impressions || 0),
        ctr: Number(row.ctr || 0),
        position: Number(row.position || 0),
        source: 'gsc',
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [gscPageDailyMetrics.projectId, gscPageDailyMetrics.date, gscPageDailyMetrics.normalizedUrl],
        set: {
          siteId: site.id,
          pageId,
          url: rawUrl,
          clicks: Number(row.clicks || 0),
          impressions: Number(row.impressions || 0),
          ctr: Number(row.ctr || 0),
          position: Number(row.position || 0),
          source: 'gsc',
          updatedAt: now,
        },
      });

    upserted += 1;
  }

  await db
    .update(sites)
    .set({
      gscConnectedAt: site.gscConnectedAt ?? now,
      gscLastSyncAt: now,
      gscLastSyncStatus: 'ok',
      gscLastError: null,
      updatedAt: now,
    })
    .where(eq(sites.id, site.id));

  return {
    projectId: args.projectId,
    siteId: site.id,
    property,
    origin: resolveOrigin(),
    window: {
      startDate: toIsoDate(startDate),
      endDate: toIsoDate(endDate),
      daysBack,
    },
    rowsFetched: rows.length,
    rowsUpserted: upserted,
  };
}

export async function markGscSyncFailure(projectId: number, errorMessage: string) {
  const site = await getPrimarySiteForProject(projectId);
  if (!site) return;
  await db
    .update(sites)
    .set({
      gscLastSyncAt: dbNow(),
      gscLastSyncStatus: 'error',
      gscLastError: errorMessage,
      updatedAt: dbNow(),
    })
    .where(eq(sites.id, site.id));
}

export async function getPagePerformanceSeries(args: {
  projectId: number;
  pageId: number;
  days?: number;
}) {
  const days = Math.max(7, Math.min(args.days ?? 120, 540));
  const endDate = toIsoDate(new Date());
  const startDate = toIsoDate(new Date(Date.now() - (days - 1) * 24 * 60 * 60 * 1000));

  const rows = await db
    .select({
      date: gscPageDailyMetrics.date,
      clicks: gscPageDailyMetrics.clicks,
      impressions: gscPageDailyMetrics.impressions,
      ctr: gscPageDailyMetrics.ctr,
      position: gscPageDailyMetrics.position,
    })
    .from(gscPageDailyMetrics)
    .where(
      and(
        eq(gscPageDailyMetrics.projectId, args.projectId),
        eq(gscPageDailyMetrics.pageId, args.pageId),
        gte(gscPageDailyMetrics.date, startDate),
        lte(gscPageDailyMetrics.date, endDate)
      )
    )
    .orderBy(gscPageDailyMetrics.date);

  return rows.map((row: (typeof rows)[number]) => ({
    date: String(row.date),
    clicks: Number(row.clicks || 0),
    impressions: Number(row.impressions || 0),
    ctr: Number(row.ctr || 0),
    position: Number(row.position || 0),
  }));
}

export async function resolveGscSyncDaysBack(
  projectId: number,
  fullBackfillDays = 480,
  incrementalDays = 35
) {
  const [latest] = await db
    .select({
      date: gscPageDailyMetrics.date,
    })
    .from(gscPageDailyMetrics)
    .where(eq(gscPageDailyMetrics.projectId, projectId))
    .orderBy(desc(gscPageDailyMetrics.date))
    .limit(1);

  if (!latest?.date) {
    return fullBackfillDays;
  }
  return incrementalDays;
}
