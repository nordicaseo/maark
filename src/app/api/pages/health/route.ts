import { NextRequest, NextResponse } from 'next/server';
import { and, desc, eq, sql } from 'drizzle-orm';
import { db, ensureDb } from '@/db';
import { crawlQueue, pageArtifactJobs, pageArtifacts, sites } from '@/db/schema';
import { getAuthUser } from '@/lib/auth';
import { userCanAccessProject } from '@/lib/access';
import type { PageDataHealth } from '@/types/page';

function parseProjectId(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function toMillis(value: unknown): number | null {
  if (!value) return null;
  if (value instanceof Date) return value.getTime();
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

export async function GET(req: NextRequest) {
  await ensureDb();
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const projectId = parseProjectId(req.nextUrl.searchParams.get('projectId'));
  if (!projectId) {
    return NextResponse.json({ error: 'projectId is required' }, { status: 400 });
  }
  if (!(await userCanAccessProject(user, projectId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const [site] = await db
    .select()
    .from(sites)
    .where(eq(sites.projectId, projectId))
    .orderBy(desc(sites.isPrimary), desc(sites.updatedAt))
    .limit(1);

  if (!site) {
    const empty: PageDataHealth = {
      projectId,
      siteId: null,
      siteDomain: null,
      gsc: {
        configured: false,
        connected: false,
        healthy: false,
        status: 'missing_site',
        lastSyncAt: null,
        error: 'No site configured.',
      },
      crawl: {
        healthy: false,
        status: 'missing_site',
        lastRunAt: null,
        error: 'No site configured.',
        pendingQueue: 0,
      },
    };
    return NextResponse.json(empty);
  }

  const [pending, artifactPending, artifactFailed, latestArtifactReady] = await Promise.all([
    db
      .select({ id: crawlQueue.id })
      .from(crawlQueue)
      .where(
        and(
          eq(crawlQueue.projectId, projectId),
          sql`${crawlQueue.state} IN ('queued', 'processing')`
        )
      ),
    db
      .select({ id: pageArtifactJobs.id })
      .from(pageArtifactJobs)
      .where(
        and(
          eq(pageArtifactJobs.projectId, projectId),
          sql`${pageArtifactJobs.state} IN ('queued', 'processing')`
        )
      ),
    db
      .select({ id: pageArtifactJobs.id })
      .from(pageArtifactJobs)
      .where(
        and(
          eq(pageArtifactJobs.projectId, projectId),
          sql`${pageArtifactJobs.state} IN ('dead_letter', 'failed')`
        )
      ),
    db
      .select({
        readyAt: pageArtifacts.readyAt,
        createdAt: pageArtifacts.createdAt,
      })
      .from(pageArtifacts)
      .where(and(eq(pageArtifacts.projectId, projectId), eq(pageArtifacts.status, 'ready')))
      .orderBy(desc(pageArtifacts.readyAt), desc(pageArtifacts.createdAt))
      .limit(1),
  ]);

  const gscConfigured = Boolean(site.gscProperty && String(site.gscProperty).trim().length > 0);
  const gscConnected = gscConfigured && Boolean(site.gscConnectedAt);
  const gscHealthy = gscConnected && site.gscLastSyncStatus === 'ok';

  const crawlLastRunAtMillis = toMillis(site.crawlLastRunAt);
  const recentWindowMs = 48 * 60 * 60 * 1000;
  const crawlHealthy =
    site.crawlLastRunStatus === 'ok' &&
    crawlLastRunAtMillis !== null &&
    Date.now() - crawlLastRunAtMillis < recentWindowMs;

  const result: PageDataHealth = {
    projectId,
    siteId: site.id,
    siteDomain: site.domain,
    gsc: {
      configured: gscConfigured,
      connected: gscConnected,
      healthy: gscHealthy,
      status: site.gscLastSyncStatus || 'never',
      lastSyncAt: site.gscLastSyncAt ? String(site.gscLastSyncAt) : null,
      error: site.gscLastError ? String(site.gscLastError) : null,
    },
    crawl: {
      healthy: crawlHealthy,
      status: site.crawlLastRunStatus || 'never',
      lastRunAt: site.crawlLastRunAt ? String(site.crawlLastRunAt) : null,
      error: site.crawlLastError ? String(site.crawlLastError) : null,
      pendingQueue: pending.length,
    },
    artifacts: {
      healthy: artifactFailed.length === 0,
      status:
        artifactFailed.length > 0
          ? 'error'
          : artifactPending.length > 0
            ? 'processing'
            : latestArtifactReady.length > 0
              ? 'ready'
              : 'never',
      pendingQueue: artifactPending.length,
      failedQueue: artifactFailed.length,
      lastReadyAt:
        latestArtifactReady[0]?.readyAt
          ? String(latestArtifactReady[0].readyAt)
          : latestArtifactReady[0]?.createdAt
            ? String(latestArtifactReady[0].createdAt)
            : null,
      error:
        artifactFailed.length > 0
          ? `${artifactFailed.length} artifact jobs failed`
          : null,
    },
  };

  return NextResponse.json(result);
}
