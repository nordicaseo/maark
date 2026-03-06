import { NextRequest, NextResponse } from 'next/server';
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { db, ensureDb } from '@/db';
import { alertEvents, crawlQueue, crawlRuns, gscPageDailyMetrics, sites } from '@/db/schema';
import { requireRole } from '@/lib/auth';
import { userCanAccessProject } from '@/lib/access';

function parseProjectId(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function toIsoDate(date: Date) {
  return date.toISOString().slice(0, 10);
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

  const [site] = await db
    .select({
      id: sites.id,
      domain: sites.domain,
      gscProperty: sites.gscProperty,
      gscConnectedAt: sites.gscConnectedAt,
      gscLastSyncAt: sites.gscLastSyncAt,
      gscLastSyncStatus: sites.gscLastSyncStatus,
      gscLastError: sites.gscLastError,
      crawlLastRunAt: sites.crawlLastRunAt,
      crawlLastRunStatus: sites.crawlLastRunStatus,
      crawlLastError: sites.crawlLastError,
    })
    .from(sites)
    .where(eq(sites.projectId, projectId))
    .orderBy(desc(sites.isPrimary), desc(sites.updatedAt))
    .limit(1);

  const [runRows, queueStateRows, alerts, gscSummaryRows, gscLatestRows] = await Promise.all([
    db
      .select({
        id: crawlRuns.id,
        runType: crawlRuns.runType,
        status: crawlRuns.status,
        totalUrls: crawlRuns.totalUrls,
        processedUrls: crawlRuns.processedUrls,
        successUrls: crawlRuns.successUrls,
        failedUrls: crawlRuns.failedUrls,
        startedAt: crawlRuns.startedAt,
        finishedAt: crawlRuns.finishedAt,
        updatedAt: crawlRuns.updatedAt,
      })
      .from(crawlRuns)
      .where(eq(crawlRuns.projectId, projectId))
      .orderBy(desc(crawlRuns.updatedAt))
      .limit(8),
    db
      .select({
        state: crawlQueue.state,
        count: sql<number>`COUNT(*)`,
      })
      .from(crawlQueue)
      .where(eq(crawlQueue.projectId, projectId))
      .groupBy(crawlQueue.state),
    db
      .select({
        id: alertEvents.id,
        source: alertEvents.source,
        eventType: alertEvents.eventType,
        severity: alertEvents.severity,
        message: alertEvents.message,
        createdAt: alertEvents.createdAt,
      })
      .from(alertEvents)
      .where(
        and(
          eq(alertEvents.projectId, projectId),
          sql`${alertEvents.source} IN ('crawler', 'gsc')`
        )
      )
      .orderBy(desc(alertEvents.createdAt))
      .limit(15),
    db
      .select({
        totalClicks: sql<number>`COALESCE(SUM(${gscPageDailyMetrics.clicks}), 0)`,
        totalImpressions: sql<number>`COALESCE(SUM(${gscPageDailyMetrics.impressions}), 0)`,
      })
      .from(gscPageDailyMetrics)
      .where(
        and(
          eq(gscPageDailyMetrics.projectId, projectId),
          gte(gscPageDailyMetrics.date, toIsoDate(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)))
        )
      )
      .limit(1),
    db
      .select({
        date: gscPageDailyMetrics.date,
      })
      .from(gscPageDailyMetrics)
      .where(eq(gscPageDailyMetrics.projectId, projectId))
      .orderBy(desc(gscPageDailyMetrics.date))
      .limit(1),
  ]);

  const queueByState: Record<string, number> = {
    queued: 0,
    processing: 0,
    done: 0,
    failed: 0,
  };
  for (const row of queueStateRows) {
    queueByState[String(row.state || 'unknown')] = Number(row.count || 0);
  }

  const gscSummary = gscSummaryRows[0] || { totalClicks: 0, totalImpressions: 0 };

  return NextResponse.json({
    projectId,
    site: site
      ? {
          id: site.id,
          domain: site.domain,
          gscProperty: site.gscProperty,
          gscConnectedAt: site.gscConnectedAt ? String(site.gscConnectedAt) : null,
          gscLastSyncAt: site.gscLastSyncAt ? String(site.gscLastSyncAt) : null,
          gscLastSyncStatus: String(site.gscLastSyncStatus || 'never'),
          gscLastError: site.gscLastError ? String(site.gscLastError) : null,
          crawlLastRunAt: site.crawlLastRunAt ? String(site.crawlLastRunAt) : null,
          crawlLastRunStatus: String(site.crawlLastRunStatus || 'never'),
          crawlLastError: site.crawlLastError ? String(site.crawlLastError) : null,
        }
      : null,
    queue: {
      queued: queueByState.queued || 0,
      processing: queueByState.processing || 0,
      done: queueByState.done || 0,
      failed: queueByState.failed || 0,
    },
    crawlRuns: runRows.map((row: (typeof runRows)[number]) => ({
      id: Number(row.id),
      runType: String(row.runType || 'manual'),
      status: String(row.status || 'queued'),
      totalUrls: Number(row.totalUrls || 0),
      processedUrls: Number(row.processedUrls || 0),
      successUrls: Number(row.successUrls || 0),
      failedUrls: Number(row.failedUrls || 0),
      startedAt: row.startedAt ? String(row.startedAt) : null,
      finishedAt: row.finishedAt ? String(row.finishedAt) : null,
      updatedAt: row.updatedAt ? String(row.updatedAt) : null,
    })),
    gsc: {
      pointsLast30d: {
        clicks: Number(gscSummary.totalClicks || 0),
        impressions: Number(gscSummary.totalImpressions || 0),
      },
      latestMetricDate: gscLatestRows[0]?.date ? String(gscLatestRows[0].date) : null,
    },
    alerts: alerts.map((row: (typeof alerts)[number]) => ({
      id: Number(row.id),
      source: String(row.source),
      eventType: String(row.eventType),
      severity: String(row.severity || 'warning'),
      message: String(row.message),
      createdAt: row.createdAt ? String(row.createdAt) : null,
    })),
  });
}
