import { NextRequest, NextResponse } from 'next/server';
import { db, ensureDb } from '@/db';
import { projects } from '@/db/schema';
import { requireRole } from '@/lib/auth';
import {
  getAccessibleProjectIds,
  isAdminUser,
  userCanAccessProject,
} from '@/lib/access';
import { reconcileContentPipelineForProject } from '@/lib/content-pipeline/reconcile';
import { logAuditEvent } from '@/lib/observability';

function parseProjectId(value: unknown): number | null {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export async function POST(req: NextRequest) {
  await ensureDb();
  const auth = await requireRole('admin');
  if (auth.error) return auth.error;

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const projectId = parseProjectId(body.projectId);
  const autoRemediate = body.autoRemediate !== false;

  let projectIds: number[] = [];
  if (projectId) {
    if (!(await userCanAccessProject(auth.user, projectId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    projectIds = [projectId];
  } else if (isAdminUser(auth.user)) {
    const allProjects = await db.select({ id: projects.id }).from(projects);
    projectIds = allProjects.map((row: { id: number }) => row.id);
  } else {
    projectIds = await getAccessibleProjectIds(auth.user);
  }

  if (projectIds.length === 0) {
    return NextResponse.json({ ok: true, summary: [] });
  }

  const summary = [];
  for (const pid of projectIds) {
    const result = await reconcileContentPipelineForProject({
      projectId: pid,
      autoRemediate,
    });
    summary.push(result);
  }

  await logAuditEvent({
    userId: auth.user.id,
    action: 'admin.content_pipeline.reconcile',
    resourceType: 'system',
    metadata: {
      autoRemediate,
      projectCount: projectIds.length,
      summary,
    },
    severity: 'warning',
  });

  return NextResponse.json({ ok: true, summary });
}
