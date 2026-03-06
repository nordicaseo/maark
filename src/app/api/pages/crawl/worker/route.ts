import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { userCanAccessProject } from '@/lib/access';
import { ensureDb } from '@/db';
import { processDueCrawlJobs } from '@/lib/discovery/crawl-queue';
import { logAuditEvent } from '@/lib/observability';

function parseOptionalProjectId(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parseLimit(value: unknown): number {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 5;
  return Math.min(parsed, 50);
}

export async function POST(req: NextRequest) {
  await ensureDb();
  const auth = await requireRole('editor');
  if (auth.error) return auth.error;

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const projectId = parseOptionalProjectId(body.projectId);
  const limit = parseLimit(body.limit);

  if (projectId !== null && !(await userCanAccessProject(auth.user, projectId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const result = await processDueCrawlJobs({ projectId: projectId ?? undefined, limit });

  await logAuditEvent({
    userId: auth.user.id,
    action: 'page.crawl.worker_run',
    resourceType: 'project',
    resourceId: projectId,
    projectId: projectId ?? undefined,
    metadata: {
      limit,
      processedCount: result.processedCount,
      queueIds: result.results.map((entry) => entry.queueId),
      states: result.results.map((entry) => entry.state),
    },
  });

  return NextResponse.json({
    success: true,
    projectId,
    ...result,
  });
}

