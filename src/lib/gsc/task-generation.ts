import { and, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { db } from '@/db';
import { gscPageDailyMetrics, pages } from '@/db/schema';
import { getConvexClient } from '@/lib/convex/server';
import { api } from '../../../convex/_generated/api';
import { linkTaskToPage } from '@/lib/pages/linking';
import { logAlertEvent } from '@/lib/observability';

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function dateOffset(days: number): string {
  return toIsoDate(new Date(Date.now() + days * 24 * 60 * 60 * 1000));
}

export interface TrafficDropTaskResult {
  analyzedPages: number;
  candidates: number;
  created: number;
  reused: number;
}

interface TrafficDropCandidate {
  pageId: number;
  previousClicks: number;
  recentClicks: number;
  absoluteDrop: number;
  dropPercent: number;
  previousImpressions: number;
  recentImpressions: number;
}

export async function createTrafficDropTasksForProject(args: {
  projectId: number;
  minDropPercent?: number;
  minBaselineClicks?: number;
  minAbsoluteDrop?: number;
}): Promise<TrafficDropTaskResult> {
  const minDropPercent = Math.max(0.1, Math.min(args.minDropPercent ?? 0.3, 0.95));
  const minBaselineClicks = Math.max(20, Math.min(args.minBaselineClicks ?? 60, 5000));
  const minAbsoluteDrop = Math.max(10, Math.min(args.minAbsoluteDrop ?? 30, 5000));

  const windowEnd = dateOffset(-1);
  const recentStart = dateOffset(-7);
  const previousStart = dateOffset(-14);
  const previousEnd = dateOffset(-8);

  const rows = await db
    .select({
      pageId: gscPageDailyMetrics.pageId,
      recentClicks: sql<number>`SUM(CASE WHEN ${gscPageDailyMetrics.date} >= ${recentStart} AND ${gscPageDailyMetrics.date} <= ${windowEnd} THEN ${gscPageDailyMetrics.clicks} ELSE 0 END)`,
      previousClicks: sql<number>`SUM(CASE WHEN ${gscPageDailyMetrics.date} >= ${previousStart} AND ${gscPageDailyMetrics.date} <= ${previousEnd} THEN ${gscPageDailyMetrics.clicks} ELSE 0 END)`,
      recentImpressions: sql<number>`SUM(CASE WHEN ${gscPageDailyMetrics.date} >= ${recentStart} AND ${gscPageDailyMetrics.date} <= ${windowEnd} THEN ${gscPageDailyMetrics.impressions} ELSE 0 END)`,
      previousImpressions: sql<number>`SUM(CASE WHEN ${gscPageDailyMetrics.date} >= ${previousStart} AND ${gscPageDailyMetrics.date} <= ${previousEnd} THEN ${gscPageDailyMetrics.impressions} ELSE 0 END)`,
    })
    .from(gscPageDailyMetrics)
    .where(
      and(
        eq(gscPageDailyMetrics.projectId, args.projectId),
        sql`${gscPageDailyMetrics.pageId} IS NOT NULL`,
        gte(gscPageDailyMetrics.date, previousStart),
        lte(gscPageDailyMetrics.date, windowEnd)
      )
    )
    .groupBy(gscPageDailyMetrics.pageId);

  const analyzedPages = rows.length;
  if (analyzedPages === 0) {
    return {
      analyzedPages,
      candidates: 0,
      created: 0,
      reused: 0,
    };
  }

  const pageMap = new Map<number, { url: string; title: string | null }>();
  const pageIds = rows
    .map((row: (typeof rows)[number]) => Number(row.pageId || 0))
    .filter((id: number) => Number.isFinite(id) && id > 0);

  if (pageIds.length > 0) {
    const pageRows = await db
      .select({
        id: pages.id,
        url: pages.url,
        title: pages.title,
      })
      .from(pages)
      .where(sql`${pages.id} IN (${sql.join(pageIds.map((id: number) => sql`${id}`), sql`, `)})`);

    for (const page of pageRows) {
      pageMap.set(page.id, {
        url: String(page.url),
        title: page.title ? String(page.title) : null,
      });
    }
  }

  const candidates: TrafficDropCandidate[] = rows
    .map((row: (typeof rows)[number]) => {
      const pageId = Number(row.pageId || 0);
      if (!pageId) return null;

      const previousClicks = Number(row.previousClicks || 0);
      const recentClicks = Number(row.recentClicks || 0);
      if (previousClicks < minBaselineClicks) return null;

      const absoluteDrop = previousClicks - recentClicks;
      if (absoluteDrop < minAbsoluteDrop) return null;

      const dropPercent = absoluteDrop / Math.max(previousClicks, 1);
      if (dropPercent < minDropPercent) return null;

      const previousImpressions = Number(row.previousImpressions || 0);
      const recentImpressions = Number(row.recentImpressions || 0);

      return {
        pageId,
        previousClicks,
        recentClicks,
        absoluteDrop,
        dropPercent,
        previousImpressions,
        recentImpressions,
      };
    })
    .filter((row: TrafficDropCandidate | null): row is TrafficDropCandidate => row !== null)
    .sort((a: TrafficDropCandidate, b: TrafficDropCandidate) => b.dropPercent - a.dropPercent);

  if (candidates.length === 0) {
    return {
      analyzedPages,
      candidates: 0,
      created: 0,
      reused: 0,
    };
  }

  const convex = getConvexClient();
  if (!convex) {
    return {
      analyzedPages,
      candidates: candidates.length,
      created: 0,
      reused: 0,
    };
  }

  let taskPool = await convex.query(api.tasks.list, {
    projectId: args.projectId,
    limit: 1000,
  });

  let created = 0;
  let reused = 0;

  for (const candidate of candidates.slice(0, 20)) {
    const pageMeta = pageMap.get(candidate.pageId);
    const pageTag = `page:${candidate.pageId}`;

    const existing = taskPool.find(
      (task) =>
        task.status !== 'COMPLETED' &&
        task.tags?.includes('traffic_drop') &&
        task.tags?.includes(pageTag)
    );

    if (existing) {
      reused += 1;
      await linkTaskToPage({
        taskId: String(existing._id),
        projectId: args.projectId,
        pageId: candidate.pageId,
        linkType: 'traffic_drop',
      });
      continue;
    }

    const dropPct = Math.round(candidate.dropPercent * 100);
    const title = pageMeta?.title?.trim()
      ? `Traffic drop: ${pageMeta.title}`
      : `Traffic drop: ${pageMeta?.url || `Page #${candidate.pageId}`}`;

    const description = [
      `Detected click decline over the last 7 days compared to the previous 7 days.`,
      `Previous clicks: ${candidate.previousClicks}`,
      `Recent clicks: ${candidate.recentClicks}`,
      `Drop: ${candidate.absoluteDrop} clicks (${dropPct}%)`,
      `Previous impressions: ${candidate.previousImpressions}`,
      `Recent impressions: ${candidate.recentImpressions}`,
      `Page: ${pageMeta?.url || `ID ${candidate.pageId}`}`,
      `Window: ${previousStart}..${previousEnd} vs ${recentStart}..${windowEnd}`,
      `Suggested next action: run page audit, review ranking losses, and open optimization subtasks.`,
    ].join('\n');

    try {
      const taskId = await convex.mutation(api.tasks.create, {
        title,
        description,
        type: 'research',
        status: 'BACKLOG',
        priority: dropPct >= 50 ? 'HIGH' : 'MEDIUM',
        projectId: args.projectId,
        tags: ['seo', 'traffic_drop', 'page', pageTag, `drop:${dropPct}`],
      });

      const taskIdString = String(taskId);
      await linkTaskToPage({
        taskId: taskIdString,
        projectId: args.projectId,
        pageId: candidate.pageId,
        linkType: 'traffic_drop',
      });

      created += 1;
      const [createdTask] = await convex.query(api.tasks.list, {
        projectId: args.projectId,
        limit: 1,
      });
      if (createdTask) taskPool = [createdTask, ...taskPool].slice(0, 1000);
    } catch (error) {
      await logAlertEvent({
        source: 'gsc',
        eventType: 'traffic_drop_task_create_failed',
        severity: 'warning',
        message: 'Traffic drop detected but failed to create Mission Control task.',
        projectId: args.projectId,
        resourceId: candidate.pageId,
        metadata: {
          error: error instanceof Error ? error.message : 'Unknown error',
          previousClicks: candidate.previousClicks,
          recentClicks: candidate.recentClicks,
          dropPercent: candidate.dropPercent,
        },
      });
    }
  }

  return {
    analyzedPages,
    candidates: candidates.length,
    created,
    reused,
  };
}

export async function listRecentTrafficDropSignals(args: {
  projectId: number;
  limit?: number;
}) {
  const limit = Math.max(1, Math.min(args.limit ?? 25, 100));
  const rows = await db
    .select({
      pageId: gscPageDailyMetrics.pageId,
      date: gscPageDailyMetrics.date,
      clicks: gscPageDailyMetrics.clicks,
      impressions: gscPageDailyMetrics.impressions,
    })
    .from(gscPageDailyMetrics)
    .where(and(eq(gscPageDailyMetrics.projectId, args.projectId), sql`${gscPageDailyMetrics.pageId} IS NOT NULL`))
    .orderBy(desc(gscPageDailyMetrics.date))
    .limit(limit);

  return rows.map((row: (typeof rows)[number]) => ({
    pageId: Number(row.pageId || 0),
    date: String(row.date),
    clicks: Number(row.clicks || 0),
    impressions: Number(row.impressions || 0),
  }));
}
