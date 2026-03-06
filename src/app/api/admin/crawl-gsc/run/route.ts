import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { userCanAccessProject } from '@/lib/access';
import { ensureDb } from '@/db';
import { logAuditEvent } from '@/lib/observability';
import { runDiscoveryForProject } from '@/lib/discovery/discovery-runner';
import { enqueueProjectPagesForCrawl, processDueCrawlJobs } from '@/lib/discovery/crawl-queue';

function parseProjectId(value: unknown): number | null {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parseLimit(value: unknown, fallback: number, max = 200) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
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
  const enqueueLimit = parseLimit(body.enqueueLimit, 30, 200);
  const workerLimit = parseLimit(body.workerLimit, 10, 100);

  let discoveryResult: Awaited<ReturnType<typeof runDiscoveryForProject>> | null = null;
  if (runDiscovery) {
    discoveryResult = await runDiscoveryForProject({
      projectId,
      includeInventory: true,
      gscTopPagesLimit: 2000,
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
      discoveryResult: discoveryResult
        ? {
            sources: discoveryResult.sources,
            totals: discoveryResult.totals,
            warnings: discoveryResult.warnings,
          }
        : null,
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
    discovery: discoveryResult,
    enqueue: enqueueResult,
    worker: workerResult,
  });
}

