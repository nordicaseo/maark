import { NextRequest, NextResponse } from 'next/server';
import { and, desc, eq, sql } from 'drizzle-orm';
import { db, ensureDb } from '@/db';
import { crawlQueue, projects, sites } from '@/db/schema';
import { dbNow } from '@/db/utils';
import { requireRole } from '@/lib/auth';
import { userCanAccessProject } from '@/lib/access';
import { logAuditEvent } from '@/lib/observability';

function parseProjectId(value: unknown): number | null {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function normalizeDomain(raw: string): string {
  let value = raw.trim().toLowerCase();
  value = value.replace(/^https?:\/\//, '');
  value = value.replace(/\/+$/, '');
  value = value.split('/')[0];
  return value;
}

function buildDefaultSitemapUrl(domain: string) {
  return `https://${domain}/sitemap.xml`;
}

function toIso(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

async function getProjectSite(projectId: number) {
  const [site] = await db
    .select()
    .from(sites)
    .where(eq(sites.projectId, projectId))
    .orderBy(desc(sites.isPrimary), desc(sites.updatedAt))
    .limit(1);
  return site ?? null;
}

async function getPendingQueue(projectId: number) {
  const rows = await db
    .select({ id: crawlQueue.id })
    .from(crawlQueue)
    .where(
      and(
        eq(crawlQueue.projectId, projectId),
        sql`${crawlQueue.state} IN ('queued', 'processing')`
      )
    );
  return rows.length;
}

export async function GET(req: NextRequest) {
  await ensureDb();
  const auth = await requireRole('admin');
  if (auth.error) return auth.error;

  const projectId = parseProjectId(req.nextUrl.searchParams.get('projectId'));
  if (!projectId) {
    return NextResponse.json({ error: 'projectId is required' }, { status: 400 });
  }
  if (!(await userCanAccessProject(auth.user, projectId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const [project] = await db
    .select({ id: projects.id, name: projects.name })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!project) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  }

  const site = await getProjectSite(projectId);
  const pendingQueue = await getPendingQueue(projectId);
  return NextResponse.json({
    project,
    site: site
      ? {
          id: site.id,
          domain: site.domain,
          sitemapUrl: site.sitemapUrl,
          gscProperty: site.gscProperty,
          gscConnectedAt: toIso(site.gscConnectedAt),
          gscLastSyncAt: toIso(site.gscLastSyncAt),
          gscLastSyncStatus: site.gscLastSyncStatus,
          gscLastError: site.gscLastError,
          crawlLastRunAt: toIso(site.crawlLastRunAt),
          crawlLastRunStatus: site.crawlLastRunStatus,
          crawlLastError: site.crawlLastError,
          autoCrawlEnabled: site.autoCrawlEnabled === 1 || site.autoCrawlEnabled === true,
          autoGscEnabled: site.autoGscEnabled === 1 || site.autoGscEnabled === true,
          crawlFrequencyHours: site.crawlFrequencyHours ?? 24,
          pendingQueue,
        }
      : null,
  });
}

export async function PUT(req: NextRequest) {
  await ensureDb();
  const auth = await requireRole('admin');
  if (auth.error) return auth.error;

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const projectId = parseProjectId(body.projectId);
  if (!projectId) {
    return NextResponse.json({ error: 'projectId is required' }, { status: 400 });
  }
  if (!(await userCanAccessProject(auth.user, projectId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const domainRaw = String(body.domain ?? '').trim();
  if (!domainRaw) {
    return NextResponse.json({ error: 'domain is required' }, { status: 400 });
  }
  const domain = normalizeDomain(domainRaw);
  if (!domain) {
    return NextResponse.json({ error: 'domain is invalid' }, { status: 400 });
  }

  const sitemapUrl = String(body.sitemapUrl ?? '').trim() || buildDefaultSitemapUrl(domain);
  const gscProperty = String(body.gscProperty ?? '').trim() || null;
  const autoCrawlEnabled = body.autoCrawlEnabled === false ? 0 : 1;
  const autoGscEnabled = body.autoGscEnabled === false ? 0 : 1;
  const crawlFrequencyHours = Math.max(1, Math.min(168, Number.parseInt(String(body.crawlFrequencyHours ?? 24), 10) || 24));

  const existing = await getProjectSite(projectId);
  const now = dbNow();
  const setData = {
    domain,
    sitemapUrl,
    gscProperty,
    gscConnectedAt: gscProperty ? (existing?.gscConnectedAt ?? now) : null,
    autoCrawlEnabled,
    autoGscEnabled,
    crawlFrequencyHours,
    isPrimary: 1,
    updatedAt: now,
  };

  let siteId: number | null = null;
  if (existing) {
    const [updated] = await db
      .update(sites)
      .set(setData)
      .where(eq(sites.id, existing.id))
      .returning();
    siteId = updated?.id ?? null;
  } else {
    const [created] = await db
      .insert(sites)
      .values({
        projectId,
        ...setData,
        createdAt: now,
      })
      .returning();
    siteId = created?.id ?? null;
  }

  await logAuditEvent({
    userId: auth.user.id,
    action: 'admin.crawl_gsc.update',
    resourceType: 'project',
    resourceId: projectId,
    projectId,
    metadata: {
      siteId,
      domain,
      sitemapUrl,
      hasGscProperty: Boolean(gscProperty),
      autoCrawlEnabled: autoCrawlEnabled === 1,
      autoGscEnabled: autoGscEnabled === 1,
      crawlFrequencyHours,
    },
  });

  const updatedSite = await getProjectSite(projectId);
  const pendingQueue = await getPendingQueue(projectId);
  return NextResponse.json({
    success: true,
    site: updatedSite
      ? {
          id: updatedSite.id,
          domain: updatedSite.domain,
          sitemapUrl: updatedSite.sitemapUrl,
          gscProperty: updatedSite.gscProperty,
          gscConnectedAt: toIso(updatedSite.gscConnectedAt),
          gscLastSyncAt: toIso(updatedSite.gscLastSyncAt),
          gscLastSyncStatus: updatedSite.gscLastSyncStatus,
          gscLastError: updatedSite.gscLastError,
          crawlLastRunAt: toIso(updatedSite.crawlLastRunAt),
          crawlLastRunStatus: updatedSite.crawlLastRunStatus,
          crawlLastError: updatedSite.crawlLastError,
          autoCrawlEnabled: updatedSite.autoCrawlEnabled === 1 || updatedSite.autoCrawlEnabled === true,
          autoGscEnabled: updatedSite.autoGscEnabled === 1 || updatedSite.autoGscEnabled === true,
          crawlFrequencyHours: updatedSite.crawlFrequencyHours ?? 24,
          pendingQueue,
        }
      : null,
  });
}
