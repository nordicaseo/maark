import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { userCanAccessProject } from '@/lib/access';
import { ensureDb } from '@/db';
import { logAuditEvent } from '@/lib/observability';
import { runDiscoveryForProject } from '@/lib/discovery/discovery-runner';
import { enqueueProjectPagesForCrawl, processDueCrawlJobs } from '@/lib/discovery/crawl-queue';
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
    },
    severity: workerResult.results.some((entry) => entry.state === 'failed') ? 'warning' : 'info',
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
  });
}
