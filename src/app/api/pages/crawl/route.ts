import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db, ensureDb } from '@/db';
import { pages } from '@/db/schema';
import { requireRole } from '@/lib/auth';
import { userCanAccessPage, userCanAccessProject } from '@/lib/access';
import { logAuditEvent } from '@/lib/observability';
import { classifyDiscoveredUrl, normalizeUrlForInventory } from '@/lib/discovery/url-policy';
import { upsertDiscoveryUrl, upsertEligiblePage } from '@/lib/discovery/ledger';
import { enqueueCrawlJob, processQueuedCrawlJob } from '@/lib/discovery/crawl-queue';

function parsePositiveInt(value: unknown): number | null {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parseBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (value === 'true' || value === '1') return true;
    if (value === 'false' || value === '0') return false;
  }
  return fallback;
}

export async function POST(req: NextRequest) {
  await ensureDb();
  const auth = await requireRole('editor');
  if (auth.error) return auth.error;

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const processImmediately = parseBoolean(body.processImmediately, true);

  try {
    const pageIdInput = parsePositiveInt(body.pageId);
    let resolvedPageId: number;
    let projectId: number;
    let siteId: number | null;
    let targetUrl: string;
    let normalizedTargetUrl: string;

    if (pageIdInput) {
      if (!(await userCanAccessPage(auth.user, pageIdInput))) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }

      const [existingPage] = await db
        .select({
          id: pages.id,
          projectId: pages.projectId,
          siteId: pages.siteId,
          url: pages.url,
          normalizedUrl: pages.normalizedUrl,
        })
        .from(pages)
        .where(eq(pages.id, pageIdInput))
        .limit(1);

      if (!existingPage) {
        return NextResponse.json({ error: 'Page not found' }, { status: 404 });
      }

      resolvedPageId = existingPage.id;
      projectId = existingPage.projectId;
      siteId = existingPage.siteId ?? null;
      targetUrl = existingPage.url;
      normalizedTargetUrl = existingPage.normalizedUrl || normalizeUrlForInventory(existingPage.url);
    } else {
      const requestedProjectId = parsePositiveInt(body.projectId);
      if (!requestedProjectId) {
        return NextResponse.json({ error: 'projectId is required when pageId is missing' }, { status: 400 });
      }
      if (!(await userCanAccessProject(auth.user, requestedProjectId))) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
      if (!body.url || typeof body.url !== 'string') {
        return NextResponse.json({ error: 'url is required when pageId is missing' }, { status: 400 });
      }

      let classified;
      try {
        classified = classifyDiscoveredUrl({ rawUrl: body.url });
      } catch {
        return NextResponse.json({ error: 'Invalid url' }, { status: 400 });
      }

      projectId = requestedProjectId;
      siteId = null;
      targetUrl = body.url.trim();
      normalizedTargetUrl = classified.normalizedUrl;

      await upsertDiscoveryUrl({
        projectId,
        url: targetUrl,
        normalizedUrl: normalizedTargetUrl,
        source: 'crawl',
        isCandidate: classified.isCandidate,
        excludeReason: classified.excludeReason,
        metadata: { trigger: 'crawl_by_url' },
      });

      if (!classified.isCandidate) {
        return NextResponse.json(
          {
            excluded: true,
            reason: classified.excludeReason,
            normalizedUrl: normalizedTargetUrl,
          },
          { status: 202 }
        );
      }

      const [existingByUrl] = await db
        .select({
          id: pages.id,
          projectId: pages.projectId,
          siteId: pages.siteId,
          url: pages.url,
          normalizedUrl: pages.normalizedUrl,
        })
        .from(pages)
        .where(and(eq(pages.projectId, projectId), eq(pages.normalizedUrl, normalizedTargetUrl)))
        .limit(1);

      if (existingByUrl) {
        resolvedPageId = existingByUrl.id;
        siteId = existingByUrl.siteId ?? null;
        targetUrl = existingByUrl.url;
        normalizedTargetUrl = existingByUrl.normalizedUrl;
      } else {
        const createdPage = await upsertEligiblePage({
          projectId,
          url: normalizedTargetUrl,
          normalizedUrl: normalizedTargetUrl,
          discoverySource: 'crawl',
        });
        if (!createdPage) {
          return NextResponse.json({ error: 'Could not create page inventory row' }, { status: 500 });
        }
        resolvedPageId = createdPage.id;
        siteId = createdPage.siteId ?? null;
        targetUrl = createdPage.url;
        normalizedTargetUrl = createdPage.normalizedUrl;
      }
    }

    const enqueued = await enqueueCrawlJob({
      projectId,
      siteId,
      pageId: resolvedPageId,
      url: targetUrl,
      normalizedUrl: normalizedTargetUrl,
      runType: 'manual',
      priority: 50,
    });

    const queueMetadata = {
      runId: enqueued.run.id,
      queueId: enqueued.queue.id,
      processImmediately,
      pageId: resolvedPageId,
      normalizedUrl: normalizedTargetUrl,
    };

    if (!processImmediately) {
      await logAuditEvent({
        userId: auth.user.id,
        action: 'page.crawl.enqueued',
        resourceType: 'page',
        resourceId: resolvedPageId,
        projectId,
        metadata: queueMetadata,
      });

      return NextResponse.json({
        success: true,
        queued: true,
        ...queueMetadata,
      });
    }

    const processed = await processQueuedCrawlJob(enqueued.queue.id);

    await logAuditEvent({
      userId: auth.user.id,
      action: 'page.crawl.enqueued',
      resourceType: 'page',
      resourceId: resolvedPageId,
      projectId,
      metadata: {
        ...queueMetadata,
        state: processed.state,
      },
      severity: processed.state === 'failed' ? 'error' : 'info',
    });

    if (processed.state === 'done') {
      return NextResponse.json({
        success: true,
        queued: true,
        ...queueMetadata,
        state: processed.state,
        result: processed.result,
      });
    }

    if (processed.state === 'queued' || processed.state === 'deferred') {
      return NextResponse.json(
        {
          success: true,
          queued: true,
          ...queueMetadata,
          state: processed.state,
          detail: processed.message,
        },
        { status: 202 }
      );
    }

    if (processed.state === 'missing') {
      return NextResponse.json(
        {
          error: 'Queued crawl item not found',
          ...queueMetadata,
        },
        { status: 500 }
      );
    }

    return NextResponse.json(
      {
        error: 'Crawler failed',
        ...queueMetadata,
        state: processed.state,
        detail: processed.message,
      },
      { status: 500 }
    );
  } catch (error) {
    console.error('Crawler enqueue/process error:', error);
    return NextResponse.json({
      error: 'Crawler failed',
      detail: error instanceof Error ? error.message : 'Unknown crawler error',
    }, { status: 500 });
  }
}
