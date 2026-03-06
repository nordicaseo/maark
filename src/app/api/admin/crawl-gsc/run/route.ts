import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { userCanAccessProject } from '@/lib/access';
import { ensureDb } from '@/db';
import { logAlertEvent, logAuditEvent } from '@/lib/observability';
import { runDiscoveryForProject } from '@/lib/discovery/discovery-runner';
import { enqueueProjectPagesForCrawl, processDueCrawlJobs } from '@/lib/discovery/crawl-queue';
import { processDuePageArtifactJobs } from '@/lib/discovery/page-artifact-queue';
import {
  markGscSyncFailure,
  resolveGscSyncDaysBack,
  syncGscPerformanceForProject,
} from '@/lib/gsc/sync';
import { createTrafficDropTasksForProject } from '@/lib/gsc/task-generation';

function parseProjectId(value: unknown): number | null {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parseLimit(value: unknown, fallback: number, max = 200) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

function parseOptionalLimit(value: unknown, max = 550): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.min(parsed, max);
}

function parseBoolean(value: unknown, fallback: boolean) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (value === 'true' || value === '1') return true;
    if (value === 'false' || value === '0') return false;
  }
  return fallback;
}

export async function POST(req: NextRequest) {
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

  const runDiscovery = body.runDiscovery !== false;
  const runGscSync = parseBoolean(body.runGscSync, true);
  const runTrafficTasking = parseBoolean(body.runTrafficTasking, true);
  const requestedGscDaysBack = parseOptionalLimit(body.gscDaysBack, 550);
  const enqueueLimit = parseLimit(body.enqueueLimit, 30, 200);
  const workerLimit = parseLimit(body.workerLimit, 10, 100);

  let discoveryResult: Awaited<ReturnType<typeof runDiscoveryForProject>> | null = null;
  let gscResult: Awaited<ReturnType<typeof syncGscPerformanceForProject>> | null = null;
  let gscError: string | null = null;
  let trafficTaskingResult: Awaited<ReturnType<typeof createTrafficDropTasksForProject>> | null = null;
  const gscDaysBack = requestedGscDaysBack ?? await resolveGscSyncDaysBack(projectId);

  if (runGscSync) {
    try {
      gscResult = await syncGscPerformanceForProject({
        projectId,
        daysBack: gscDaysBack,
      });
    } catch (error) {
      gscError = error instanceof Error ? error.message : 'Unknown GSC sync error';
      await markGscSyncFailure(projectId, gscError);
      await logAlertEvent({
        source: 'crawl_gsc',
        eventType: 'gsc_sync_failed',
        severity: 'warning',
        projectId,
        resourceId: String(projectId),
        message: `GSC sync failed: ${gscError}`,
        metadata: {
          projectId,
          daysBack: gscDaysBack,
        },
      });
    }
  }

  if (runDiscovery) {
    discoveryResult = await runDiscoveryForProject({
      projectId,
      includeInventory: true,
      gscTopPagesLimit: 2000,
    });
  }

  if (runTrafficTasking) {
    trafficTaskingResult = await createTrafficDropTasksForProject({
      projectId,
    });
  }

  const enqueueResult = await enqueueProjectPagesForCrawl({
    projectId,
    limit: enqueueLimit,
    runType: 'manual_admin',
  });

  const workerResult = await processDueCrawlJobs({
    projectId,
    limit: workerLimit,
  });
  const artifactWorkerResult = await processDuePageArtifactJobs({
    projectId,
    limit: Math.min(workerLimit * 2, 50),
  });

  const crawlFailures = workerResult.results.filter((entry) => entry.state === 'failed');
  if (crawlFailures.length > 0) {
    await logAlertEvent({
      source: 'crawl_gsc',
      eventType: 'crawl_worker_failed_jobs',
      severity: 'warning',
      projectId,
      resourceId: String(projectId),
      message: `Crawl worker reported ${crawlFailures.length} failed jobs.`,
      metadata: {
        projectId,
        failedJobs: crawlFailures.slice(0, 10),
      },
    });
  }

  const artifactFailedJobs = artifactWorkerResult.results.filter(
    (entry) => entry.state === 'failed' || entry.state === 'dead_letter'
  );
  if (artifactWorkerResult.states.deadLetter > 0 || artifactFailedJobs.length > 0) {
    await logAlertEvent({
      source: 'crawl_gsc',
      eventType: 'artifact_worker_issues',
      severity: 'warning',
      projectId,
      resourceId: String(projectId),
      message:
        `Artifact worker issues: failed=${artifactFailedJobs.length}, ` +
        `deadLetter=${artifactWorkerResult.states.deadLetter}.`,
      metadata: {
        projectId,
        states: artifactWorkerResult.states,
        failedJobs: artifactFailedJobs.slice(0, 10),
      },
    });
  }

  await logAuditEvent({
    userId: auth.user.id,
    action: 'admin.crawl_gsc.run',
    resourceType: 'project',
    resourceId: projectId,
    projectId,
    metadata: {
      runDiscovery,
      runGscSync,
      runTrafficTasking,
      gscDaysBack,
      gscResult,
      gscError,
      discoveryResult: discoveryResult
        ? {
            sources: discoveryResult.sources,
            totals: discoveryResult.totals,
            warnings: discoveryResult.warnings,
          }
        : null,
      trafficTaskingResult,
      enqueueResult,
      workerResult: {
        requestedLimit: workerResult.requestedLimit,
        processedCount: workerResult.processedCount,
      },
      artifactWorkerResult: {
        requestedLimit: artifactWorkerResult.requestedLimit,
        processedCount: artifactWorkerResult.processedCount,
        states: artifactWorkerResult.states,
      },
    },
    severity:
      workerResult.results.some((entry) => entry.state === 'failed') ||
      artifactWorkerResult.states.deadLetter > 0
        ? 'warning'
        : 'info',
  });

  return NextResponse.json({
    success: true,
    projectId,
    runDiscovery,
    runGscSync,
    runTrafficTasking,
    gscDaysBack,
    gsc: gscResult,
    gscError,
    discovery: discoveryResult,
    trafficTasking: trafficTaskingResult,
    enqueue: enqueueResult,
    worker: workerResult,
    artifactWorker: artifactWorkerResult,
  });
}
