import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db, ensureDb } from '@/db';
import { pages, sites } from '@/db/schema';
import { runDiscoveryForProject } from '@/lib/discovery/discovery-runner';
import { enqueueCrawlJob, processDueCrawlJobs } from '@/lib/discovery/crawl-queue';
import { normalizeUrlForInventory } from '@/lib/discovery/url-policy';
import { logAlertEvent, logAuditEvent } from '@/lib/observability';

function isCronAuthorized(req: NextRequest): boolean {
  if (req.headers.get('x-vercel-cron')) return true;
  const secret = process.env.CRAWL_CRON_SECRET;
  if (!secret) return false;
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim();
  return Boolean(token && token === secret);
}

function toMillis(value: unknown): number | null {
  if (!value) return null;
  if (value instanceof Date) return value.getTime();
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

export async function POST(req: NextRequest) {
  await ensureDb();
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized cron' }, { status: 401 });
  }

  const allSites = await db
    .select()
    .from(sites)
    .where(and(eq(sites.isPrimary, 1)));

  const summary: Array<{
    projectId: number;
    siteId: number;
    discoveryRun: boolean;
    discoveryWarnings: number;
    queued: number;
    processed: number;
  }> = [];

  for (const site of allSites) {
    try {
      let discoveryWarnings = 0;
      if (site.autoGscEnabled === 1 || site.autoGscEnabled === true || site.autoCrawlEnabled === 1 || site.autoCrawlEnabled === true) {
        const discovery = await runDiscoveryForProject({
          projectId: site.projectId,
          includeInventory: true,
          gscTopPagesLimit: 2000,
        });
        discoveryWarnings = discovery.warnings.length;
      }

      let queued = 0;
      const autoCrawl = site.autoCrawlEnabled === 1 || site.autoCrawlEnabled === true;
      const frequencyHours = Math.max(1, Number(site.crawlFrequencyHours || 24));
      if (autoCrawl) {
        const pagesToCrawl = (await db
          .select({
            id: pages.id,
            siteId: pages.siteId,
            url: pages.url,
            normalizedUrl: pages.normalizedUrl,
            lastCrawledAt: pages.lastCrawledAt,
          })
          .from(pages)
          .where(
            and(
              eq(pages.projectId, site.projectId),
              eq(pages.eligibilityState, 'eligible'),
              eq(pages.isActive, 1),
              eq(pages.isIndexable, 1)
            )
          )
          .limit(100)) as Array<{
          id: number;
          siteId: number | null;
          url: string;
          normalizedUrl: string;
          lastCrawledAt: string | Date | null;
        }>;

        const thresholdMs = frequencyHours * 60 * 60 * 1000;
        const duePages = pagesToCrawl.filter((row) => {
          const lastMs = toMillis(row.lastCrawledAt);
          if (lastMs === null) return true;
          return Date.now() - lastMs >= thresholdMs;
        }).slice(0, 30);

        for (const page of duePages) {
          const enqueued = await enqueueCrawlJob({
            projectId: site.projectId,
            siteId: page.siteId ?? site.id,
            pageId: page.id,
            url: page.url,
            normalizedUrl: page.normalizedUrl || normalizeUrlForInventory(page.url),
            runType: 'scheduled',
            priority: 35,
          });
          if (!enqueued.reused) queued += 1;
        }
      }

      const worker = await processDueCrawlJobs({
        projectId: site.projectId,
        limit: 10,
      });

      summary.push({
        projectId: site.projectId,
        siteId: site.id,
        discoveryRun: true,
        discoveryWarnings,
        queued,
        processed: worker.processedCount,
      });
    } catch (error) {
      await logAlertEvent({
        source: 'crawler',
        eventType: 'scheduled_run_failed',
        severity: 'error',
        message: 'Scheduled crawl/GSC run failed for project.',
        projectId: site.projectId,
        resourceId: site.id,
        metadata: {
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      });
    }
  }

  await logAuditEvent({
    userId: null,
    action: 'admin.crawl_gsc.cron_run',
    resourceType: 'system',
    metadata: {
      projects: summary.length,
      summary,
    },
    severity: 'info',
  });

  return NextResponse.json({
    success: true,
    processedProjects: summary.length,
    summary,
  });
}
