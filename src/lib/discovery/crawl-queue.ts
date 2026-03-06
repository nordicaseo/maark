import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { dbNow } from '@/db/utils';
import { crawlPage } from '@/lib/crawler/page-crawler';
import {
  crawlQueue,
  crawlRuns,
  pageIssues,
  pages,
  pageSnapshots,
  sites,
} from '@/db/schema';
import {
  normalizeUrlForInventory,
  resolveEligibility,
} from '@/lib/discovery/url-policy';
import {
  retirePageFromInventory,
  upsertDiscoveryUrl,
  upsertEligiblePage,
} from '@/lib/discovery/ledger';
import { getConvexClient } from '@/lib/convex/server';
import { api } from '../../../convex/_generated/api';
import { logAlertEvent } from '@/lib/observability';
import { linkTaskToPage } from '@/lib/pages/linking';

const DEFAULT_MAX_ATTEMPTS = 3;

interface ConvexTaskSummary {
  _id: string;
  status: string;
  tags?: string[];
}

async function ensureCrawlerSubtasks(args: {
  convex: NonNullable<ReturnType<typeof getConvexClient>>;
  projectId: number;
  pageId: number;
  pageUrl: string;
  issueCount: number;
  parentTaskId: string;
  existingTasks: ConvexTaskSummary[];
}) {
  const parentTag = `parent_task:${args.parentTaskId}`;
  const pageTag = `page:${args.pageId}`;
  const definitions = [
    {
      key: 'crawler_triage',
      title: `Triage crawl issues (${args.issueCount})`,
      description: `Review crawler findings for ${args.pageUrl}, prioritize by impact, and confirm root causes.`,
      priority: 'HIGH',
    },
    {
      key: 'crawler_fix_plan',
      title: 'Create on-page SEO fix plan',
      description: `Define concrete fixes for technical and on-page SEO issues found on ${args.pageUrl}.`,
      priority: 'MEDIUM',
    },
    {
      key: 'crawler_verify_recrawl',
      title: 'Verify fixes with recrawl',
      description: `Run recrawl after fixes and confirm issue closure for ${args.pageUrl}.`,
      priority: 'MEDIUM',
    },
  ] as const;

  for (const subtask of definitions) {
    const existing = args.existingTasks.find(
      (task) =>
        task.status !== 'COMPLETED' &&
        task.tags?.includes(parentTag) &&
        task.tags?.includes(`subtask:${subtask.key}`)
    );
    if (existing) {
      await linkTaskToPage({
        taskId: String(existing._id),
        projectId: args.projectId,
        pageId: args.pageId,
        linkType: 'crawler_issue',
      });
      continue;
    }

    const subTaskId = await args.convex.mutation(api.tasks.create, {
      title: subtask.title,
      description: subtask.description,
      type: 'research',
      status: 'BACKLOG',
      priority: subtask.priority,
      projectId: args.projectId,
      tags: ['seo', 'crawler', 'page', 'subtask', parentTag, pageTag, `subtask:${subtask.key}`],
    });

    await linkTaskToPage({
      taskId: String(subTaskId),
      projectId: args.projectId,
      pageId: args.pageId,
      linkType: 'crawler_issue',
    });
  }
}

async function updateSiteCrawlStatus(args: {
  siteId: number | null | undefined;
  status: 'never' | 'queued' | 'running' | 'ok' | 'error';
  error?: string | null;
}) {
  if (!args.siteId) return;
  await db
    .update(sites)
    .set({
      crawlLastRunAt: dbNow(),
      crawlLastRunStatus: args.status,
      crawlLastError: args.error ?? null,
      updatedAt: dbNow(),
    })
    .where(eq(sites.id, args.siteId));
}

async function resolvePrimarySiteId(projectId: number): Promise<number | null> {
  const [site] = await db
    .select({ id: sites.id })
    .from(sites)
    .where(eq(sites.projectId, projectId))
    .orderBy(desc(sites.isPrimary), desc(sites.updatedAt))
    .limit(1);
  return site?.id ?? null;
}

function toDbTime(ms: number): Date | string {
  return process.env.POSTGRES_URL ? new Date(ms) : new Date(ms).toISOString();
}

function toEpochMs(value: unknown): number | null {
  if (!value) return null;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function isDue(nextAttemptAt: unknown): boolean {
  const epoch = toEpochMs(nextAttemptAt);
  if (epoch === null) return true;
  return epoch <= Date.now();
}

function nextBackoffMs(attempt: number): number {
  const base = 60_000;
  const cap = 30 * 60_000;
  const multiplier = Math.max(1, 2 ** (attempt - 1));
  return Math.min(cap, base * multiplier);
}

async function maybeCreateCrawlerIssueTask(args: {
  projectId: number;
  pageId: number;
  pageUrl: string;
  issueCount: number;
  severities: Array<'low' | 'medium' | 'high' | 'critical'>;
}) {
  if (args.issueCount <= 0) return null;

  try {
    const convex = getConvexClient();
    if (!convex) return null;

    const existingTasks = await convex.query(api.tasks.list, {
      projectId: args.projectId,
      limit: 500,
    });

    const existingOpenIssueTask = existingTasks.find(
      (task) =>
        task.status !== 'COMPLETED' &&
        task.tags?.includes('crawler_issue') &&
        task.tags?.includes(`page:${args.pageId}`)
    );

    if (existingOpenIssueTask) {
      const taskId = String(existingOpenIssueTask._id);
      await linkTaskToPage({
        taskId,
        projectId: args.projectId,
        pageId: args.pageId,
        linkType: 'crawler_issue',
      });
      await ensureCrawlerSubtasks({
        convex,
        projectId: args.projectId,
        pageId: args.pageId,
        pageUrl: args.pageUrl,
        issueCount: args.issueCount,
        parentTaskId: taskId,
        existingTasks: existingTasks as ConvexTaskSummary[],
      });
      return taskId;
    }

    const taskId = await convex.mutation(api.tasks.create, {
      title: `Fix SEO issues: ${args.pageUrl}`,
      description: `${args.issueCount} crawl issue(s) detected.`,
      type: 'research',
      status: 'BACKLOG',
      priority: args.severities.some((severity) => severity === 'critical' || severity === 'high')
        ? 'HIGH'
        : 'MEDIUM',
      projectId: args.projectId,
      tags: ['seo', 'crawler', 'page', 'crawler_issue', `page:${args.pageId}`],
    });

    const linkedTaskId = String(taskId);
    await linkTaskToPage({
      taskId: linkedTaskId,
      projectId: args.projectId,
      pageId: args.pageId,
      linkType: 'crawler_issue',
    });
    await ensureCrawlerSubtasks({
      convex,
      projectId: args.projectId,
      pageId: args.pageId,
      pageUrl: args.pageUrl,
      issueCount: args.issueCount,
      parentTaskId: linkedTaskId,
      existingTasks: existingTasks as ConvexTaskSummary[],
    });
    return linkedTaskId;
  } catch (error) {
    await logAlertEvent({
      source: 'crawler',
      eventType: 'mission_control_task_create_failed',
      severity: 'warning',
      message: 'Crawler detected issues but failed to create a Mission Control task.',
      projectId: args.projectId,
      resourceId: args.pageId,
      metadata: { error: error instanceof Error ? error.message : 'Unknown error' },
    });
    return null;
  }
}

async function runSingleQueuedCrawl(queueItem: typeof crawlQueue.$inferSelect) {
  const crawl = await crawlPage(queueItem.url);
  const finalNormalizedUrl = normalizeUrlForInventory(crawl.finalUrl);
  const eligibility = resolveEligibility({
    normalizedUrl: finalNormalizedUrl,
    rawUrl: crawl.finalUrl,
    httpStatus: crawl.httpStatus,
    robots: crawl.metaRobots,
    canonicalTarget: crawl.canonicalUrl,
  });

  const trackedPage = await upsertEligiblePage({
    projectId: queueItem.projectId,
    siteId: queueItem.siteId ?? null,
    url: finalNormalizedUrl,
    normalizedUrl: finalNormalizedUrl,
    title: crawl.title,
    canonicalUrl: crawl.canonicalUrl,
    httpStatus: crawl.httpStatus,
    isIndexable: crawl.isIndexable,
    isVerified: crawl.isVerified,
    responseTimeMs: crawl.responseTimeMs,
    contentHash: crawl.contentHash,
    discoverySource: 'crawl',
  });

  if (!trackedPage) {
    throw new Error('Unable to resolve inventory page after crawl result.');
  }

  await upsertDiscoveryUrl({
    projectId: queueItem.projectId,
    siteId: queueItem.siteId ?? null,
    pageId: trackedPage.id,
    url: crawl.finalUrl,
    normalizedUrl: finalNormalizedUrl,
    source: 'crawl',
    isCandidate: eligibility.isCandidate,
    excludeReason: eligibility.excludeReason,
    canonicalTarget: crawl.canonicalUrl,
    httpStatus: crawl.httpStatus,
    robots: crawl.metaRobots,
    metadata: {
      seoScore: crawl.seoScore,
      issuesCount: crawl.issues.length,
      runId: queueItem.runId,
      queueId: queueItem.id,
    },
  });

  const [snapshot] = await db
    .insert(pageSnapshots)
    .values({
      pageId: trackedPage.id,
      runId: queueItem.runId,
      httpStatus: crawl.httpStatus,
      canonicalUrl: crawl.canonicalUrl,
      metaRobots: crawl.metaRobots,
      isIndexable: crawl.isIndexable ? 1 : 0,
      isVerified: crawl.isVerified ? 1 : 0,
      responseTimeMs: crawl.responseTimeMs,
      seoScore: crawl.seoScore,
      issuesCount: crawl.issues.length,
      snapshotData: crawl.snapshotData,
    })
    .returning();

  const openIssues = await db
    .select()
    .from(pageIssues)
    .where(and(eq(pageIssues.pageId, trackedPage.id), eq(pageIssues.isOpen, 1)));

  if (openIssues.length > 0) {
    await db
      .update(pageIssues)
      .set({
        isOpen: 0,
        resolvedAt: dbNow(),
        lastSeenAt: dbNow(),
      })
      .where(and(eq(pageIssues.pageId, trackedPage.id), eq(pageIssues.isOpen, 1)));
  }

  for (const issue of crawl.issues) {
    await db.insert(pageIssues).values({
      pageId: trackedPage.id,
      snapshotId: snapshot?.id ?? null,
      issueType: issue.issueType,
      severity: issue.severity,
      message: issue.message,
      isOpen: 1,
      metadata: issue.metadata || null,
      firstSeenAt: dbNow(),
      lastSeenAt: dbNow(),
    });
  }

  if (!eligibility.isCandidate && eligibility.excludeReason) {
    await retirePageFromInventory({
      pageId: trackedPage.id,
      excludeReason: eligibility.excludeReason,
      httpStatus: crawl.httpStatus,
      isIndexable: crawl.isIndexable,
      canonicalUrl: crawl.canonicalUrl,
    });
  }

  const linkedTaskId = await maybeCreateCrawlerIssueTask({
    projectId: queueItem.projectId,
    pageId: trackedPage.id,
    pageUrl: crawl.finalUrl,
    issueCount: crawl.issues.length,
    severities: crawl.issues.map((issue) => issue.severity),
  });

  return {
    pageId: trackedPage.id,
    normalizedUrl: finalNormalizedUrl,
    candidate: eligibility.isCandidate,
    excludeReason: eligibility.excludeReason,
    linkedTaskId,
    crawl,
  };
}

async function updateRunStatus(args: {
  runId: number;
  status: 'queued' | 'running' | 'completed' | 'failed';
  processedDelta?: number;
  successDelta?: number;
  failedDelta?: number;
  finish?: boolean;
}) {
  const [run] = await db
    .select()
    .from(crawlRuns)
    .where(eq(crawlRuns.id, args.runId))
    .limit(1);
  if (!run) return;

  const processedUrls = Math.max(0, (run.processedUrls ?? 0) + (args.processedDelta ?? 0));
  const successUrls = Math.max(0, (run.successUrls ?? 0) + (args.successDelta ?? 0));
  const failedUrls = Math.max(0, (run.failedUrls ?? 0) + (args.failedDelta ?? 0));

  await db
    .update(crawlRuns)
    .set({
      status: args.status,
      processedUrls,
      successUrls,
      failedUrls,
      startedAt: run.startedAt ?? dbNow(),
      finishedAt: args.finish ? dbNow() : run.finishedAt ?? null,
      updatedAt: dbNow(),
    })
    .where(eq(crawlRuns.id, args.runId));
}

export async function enqueueCrawlJob(args: {
  projectId: number;
  siteId?: number | null;
  pageId: number;
  url: string;
  normalizedUrl: string;
  priority?: number;
  runType?: string;
  maxAttempts?: number;
}) {
  const [existingQueue] = await db
    .select()
    .from(crawlQueue)
    .where(
      and(
        eq(crawlQueue.projectId, args.projectId),
        eq(crawlQueue.normalizedUrl, args.normalizedUrl),
        sql`${crawlQueue.state} IN ('queued', 'processing')`
      )
    )
    .orderBy(desc(crawlQueue.updatedAt))
    .limit(1);

  if (existingQueue) {
    let [existingRun] = await db
      .select()
      .from(crawlRuns)
      .where(eq(crawlRuns.id, existingQueue.runId))
      .limit(1);
    if (!existingRun) {
      [existingRun] = await db
        .insert(crawlRuns)
        .values({
          projectId: args.projectId,
          siteId: args.siteId ?? null,
          runType: args.runType || 'manual',
          status: 'queued',
          totalUrls: 1,
          processedUrls: 0,
          successUrls: 0,
          failedUrls: 0,
          createdAt: dbNow(),
          updatedAt: dbNow(),
        })
        .returning();
    }
    return {
      run: existingRun,
      queue: existingQueue,
      reused: true,
    };
  }

  const [run] = await db
    .insert(crawlRuns)
    .values({
      projectId: args.projectId,
      siteId: args.siteId ?? null,
      runType: args.runType || 'manual',
      status: 'queued',
      totalUrls: 1,
      processedUrls: 0,
      successUrls: 0,
      failedUrls: 0,
      createdAt: dbNow(),
      updatedAt: dbNow(),
    })
    .returning();

  const [queue] = await db
    .insert(crawlQueue)
    .values({
      runId: run.id,
      projectId: args.projectId,
      siteId: args.siteId ?? null,
      pageId: args.pageId,
      url: args.url,
      normalizedUrl: args.normalizedUrl,
      priority: args.priority ?? 50,
      state: 'queued',
      attempts: 0,
      maxAttempts: args.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
      nextAttemptAt: null,
      leaseUntil: null,
      lastError: null,
      createdAt: dbNow(),
      updatedAt: dbNow(),
    })
    .returning();

  await updateSiteCrawlStatus({
    siteId: args.siteId ?? null,
    status: 'queued',
  });

  return {
    run,
    queue,
    reused: false,
  };
}

export async function enqueueProjectPagesForCrawl(args: {
  projectId: number;
  limit?: number;
  runType?: string;
}) {
  const limit = Math.max(1, Math.min(200, args.limit ?? 30));
  const primarySiteId = await resolvePrimarySiteId(args.projectId);

  const stalePages = await db
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
        eq(pages.projectId, args.projectId),
        eq(pages.eligibilityState, 'eligible'),
        eq(pages.isActive, 1),
        eq(pages.isIndexable, 1)
      )
    )
    .orderBy(asc(pages.lastCrawledAt), desc(pages.updatedAt))
    .limit(limit);

  let enqueued = 0;
  let reused = 0;
  for (const page of stalePages) {
    const result = await enqueueCrawlJob({
      projectId: args.projectId,
      siteId: page.siteId ?? primarySiteId,
      pageId: page.id,
      url: page.url,
      normalizedUrl: page.normalizedUrl || normalizeUrlForInventory(page.url),
      runType: args.runType || 'scheduled',
      priority: 40,
    });
    if (result.reused) reused += 1;
    else enqueued += 1;
  }

  return {
    requestedLimit: limit,
    discoveredPages: stalePages.length,
    enqueued,
    reused,
  };
}

export async function processQueuedCrawlJob(queueId: number) {
  const [queueItem] = await db
    .select()
    .from(crawlQueue)
    .where(eq(crawlQueue.id, queueId))
    .limit(1);

  if (!queueItem) {
    return {
      queueId,
      state: 'missing' as const,
      message: 'Queue item not found',
    };
  }

  if (queueItem.state === 'done' || queueItem.state === 'failed') {
    return {
      queueId,
      state: queueItem.state,
      message: 'Queue item already finalized',
    };
  }

  if (!isDue(queueItem.nextAttemptAt)) {
    return {
      queueId,
      state: 'deferred' as const,
      message: 'Queue item is not due yet',
    };
  }
  const effectiveSiteId = queueItem.siteId ?? (await resolvePrimarySiteId(queueItem.projectId));

  const nextAttempt = (queueItem.attempts ?? 0) + 1;
  await db
    .update(crawlQueue)
    .set({
      state: 'processing',
      attempts: nextAttempt,
      leaseUntil: toDbTime(Date.now() + 2 * 60_000),
      updatedAt: dbNow(),
    })
    .where(eq(crawlQueue.id, queueId));

  await updateRunStatus({
    runId: queueItem.runId,
    status: 'running',
  });
  await updateSiteCrawlStatus({
    siteId: effectiveSiteId,
    status: 'running',
  });

  try {
    const result = await runSingleQueuedCrawl(queueItem);

    await db
      .update(crawlQueue)
      .set({
        state: 'done',
        leaseUntil: null,
        lastError: null,
        nextAttemptAt: null,
        updatedAt: dbNow(),
      })
      .where(eq(crawlQueue.id, queueId));

    await updateRunStatus({
      runId: queueItem.runId,
      status: 'completed',
      processedDelta: 1,
      successDelta: 1,
      finish: true,
    });
    await updateSiteCrawlStatus({
      siteId: effectiveSiteId,
      status: 'ok',
      error: null,
    });

    return {
      queueId,
      runId: queueItem.runId,
      state: 'done' as const,
      result,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown crawl error';
    const willRetry = nextAttempt < (queueItem.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);

    if (willRetry) {
      await db
        .update(crawlQueue)
        .set({
          state: 'queued',
          leaseUntil: null,
          lastError: errorMessage,
          nextAttemptAt: toDbTime(Date.now() + nextBackoffMs(nextAttempt)),
          updatedAt: dbNow(),
        })
        .where(eq(crawlQueue.id, queueId));

      await updateRunStatus({
        runId: queueItem.runId,
        status: 'running',
      });
      await updateSiteCrawlStatus({
        siteId: effectiveSiteId,
        status: 'running',
        error: errorMessage,
      });

      await logAlertEvent({
        source: 'crawler',
        eventType: 'crawl_attempt_failed_retrying',
        severity: 'warning',
        message: 'Crawl attempt failed. Job has been re-queued.',
        projectId: queueItem.projectId,
        resourceId: queueItem.pageId ?? undefined,
        metadata: {
          queueId,
          runId: queueItem.runId,
          attempts: nextAttempt,
          maxAttempts: queueItem.maxAttempts,
          error: errorMessage,
        },
      });

      return {
        queueId,
        runId: queueItem.runId,
        state: 'queued' as const,
        message: errorMessage,
        attempts: nextAttempt,
      };
    }

    await db
      .update(crawlQueue)
      .set({
        state: 'failed',
        leaseUntil: null,
        lastError: errorMessage,
        nextAttemptAt: null,
        updatedAt: dbNow(),
      })
      .where(eq(crawlQueue.id, queueId));

    await updateRunStatus({
      runId: queueItem.runId,
      status: 'failed',
      processedDelta: 1,
      failedDelta: 1,
      finish: true,
    });
    await updateSiteCrawlStatus({
      siteId: effectiveSiteId,
      status: 'error',
      error: errorMessage,
    });

    await logAlertEvent({
      source: 'crawler',
      eventType: 'crawl_failed',
      severity: 'error',
      message: 'Crawl run failed after maximum retry attempts.',
      projectId: queueItem.projectId,
      resourceId: queueItem.pageId ?? undefined,
      metadata: {
        queueId,
        runId: queueItem.runId,
        attempts: nextAttempt,
        maxAttempts: queueItem.maxAttempts,
        error: errorMessage,
      },
    });

    return {
      queueId,
      runId: queueItem.runId,
      state: 'failed' as const,
      message: errorMessage,
      attempts: nextAttempt,
    };
  }
}

export async function processDueCrawlJobs(args?: { projectId?: number; limit?: number }) {
  const limit = Math.max(1, Math.min(50, args?.limit ?? 5));

  const queuedRows = (await db
    .select()
    .from(crawlQueue)
    .where(
      and(
        eq(crawlQueue.state, 'queued'),
        ...(args?.projectId ? [eq(crawlQueue.projectId, args.projectId)] : [])
      )
    )
    .orderBy(desc(crawlQueue.priority), desc(crawlQueue.createdAt))
    .limit(limit * 5)) as Array<typeof crawlQueue.$inferSelect>;

  const dueRows = queuedRows.filter((row) => isDue(row.nextAttemptAt)).slice(0, limit);
  const results = [] as Array<Awaited<ReturnType<typeof processQueuedCrawlJob>>>;

  for (const row of dueRows) {
    results.push(await processQueuedCrawlJob(row.id));
  }

  return {
    requestedLimit: limit,
    processedCount: results.length,
    results,
  };
}
