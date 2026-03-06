import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { userCanAccessProject } from '@/lib/access';
import { ensureDb } from '@/db';
import { logAlertEvent, logAuditEvent } from '@/lib/observability';
import { runDiscoveryForProject } from '@/lib/discovery/discovery-runner';

function parseOptionalNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export async function POST(req: NextRequest) {
  await ensureDb();
  const auth = await requireRole('editor');
  if (auth.error) return auth.error;

  try {
    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const projectId = parseOptionalNumber(body.projectId);
    if (!projectId) {
      return NextResponse.json({ error: 'projectId is required' }, { status: 400 });
    }
    if (!(await userCanAccessProject(auth.user, projectId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const result = await runDiscoveryForProject({
      projectId,
      sitemapUrl: typeof body.sitemapUrl === 'string' ? body.sitemapUrl : null,
      gscProperty: typeof body.gscProperty === 'string' ? body.gscProperty : null,
      gscAccessToken: typeof body.gscAccessToken === 'string' ? body.gscAccessToken : null,
      gscTopPagesLimit: parseOptionalNumber(body.gscTopPagesLimit) ?? 2000,
      includeInventory: body.includeInventory !== false,
    });

    await logAuditEvent({
      userId: auth.user.id,
      action: 'discovery.run',
      resourceType: 'project',
      resourceId: projectId,
      projectId,
      metadata: {
        ...result,
      },
      severity: result.warnings.length > 0 ? 'warning' : 'info',
    });

    return NextResponse.json(result);
  } catch (error) {
    await logAlertEvent({
      source: 'discovery',
      eventType: 'run_failed',
      severity: 'error',
      message: 'Discovery run failed.',
      metadata: { error: error instanceof Error ? error.message : 'Unknown error' },
    });
    console.error('Discovery run failed:', error);
    return NextResponse.json({ error: 'Failed to run discovery' }, { status: 500 });
  }
}
