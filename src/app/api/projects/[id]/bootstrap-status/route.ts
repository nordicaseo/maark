import { NextRequest, NextResponse } from 'next/server';
import { and, desc, eq } from 'drizzle-orm';
import { db, ensureDb } from '@/db';
import { auditLogs, sites } from '@/db/schema';
import { getAuthUser } from '@/lib/auth';
import { userCanAccessProject } from '@/lib/access';
import type { ProjectBootstrapStageState } from '@/types/agent-runtime';

const STAGES: Array<ProjectBootstrapStageState> = [
  { stage: 'seeding_agents', label: 'Seeding Agents', status: 'pending' },
  { stage: 'creating_mission_control', label: 'Creating Mission Control', status: 'pending' },
  { stage: 'fetching_pages', label: 'Fetching Pages', status: 'pending' },
  {
    stage: 'connect_gsc',
    label: 'Connect your GSC',
    status: 'pending',
    message: 'Connect Google Search Console to unlock richer data.',
  },
];

function copyStages() {
  return STAGES.map((stage) => ({ ...stage }));
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await ensureDb();
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const projectId = Number.parseInt(id, 10);
  if (!Number.isFinite(projectId) || projectId <= 0) {
    return NextResponse.json({ error: 'Invalid project id' }, { status: 400 });
  }

  if (!(await userCanAccessProject(user, projectId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const stages = copyStages();
  const index = new Map(stages.map((stage, idx) => [stage.stage, idx]));

  const logs = await db
    .select({
      action: auditLogs.action,
      metadata: auditLogs.metadata,
      createdAt: auditLogs.createdAt,
    })
    .from(auditLogs)
    .where(
      and(eq(auditLogs.projectId, projectId), eq(auditLogs.action, 'project.bootstrap.stage'))
    )
    .orderBy(desc(auditLogs.id))
    .limit(40);

  for (const log of logs.reverse()) {
    const metadata =
      log.metadata && typeof log.metadata === 'object'
        ? (log.metadata as Record<string, unknown>)
        : {};
    const stageKey = String(metadata.stage || '').trim();
    const idx = index.get(stageKey as ProjectBootstrapStageState['stage']);
    if (idx === undefined) continue;
    const status = String(metadata.status || '').trim();
    if (!['pending', 'running', 'done', 'failed'].includes(status)) continue;
    stages[idx] = {
      ...stages[idx],
      status: status as ProjectBootstrapStageState['status'],
      message: metadata.message ? String(metadata.message) : null,
      updatedAt: log.createdAt ? String(log.createdAt) : null,
    };
  }

  const [site] = await db
    .select({
      gscProperty: sites.gscProperty,
      gscConnectedAt: sites.gscConnectedAt,
    })
    .from(sites)
    .where(and(eq(sites.projectId, projectId), eq(sites.isPrimary, 1)))
    .limit(1);
  const gscIdx = index.get('connect_gsc');
  if (gscIdx !== undefined && site?.gscProperty) {
    stages[gscIdx] = {
      ...stages[gscIdx],
      status: 'done',
      message: site.gscConnectedAt
        ? 'Google Search Console connected.'
        : 'GSC property configured.',
      updatedAt: site.gscConnectedAt ? String(site.gscConnectedAt) : stages[gscIdx].updatedAt,
    };
  }

  const hasFailure = stages.some((stage) => stage.status === 'failed');
  const hasRunning = stages.some((stage) => stage.status === 'running');
  const requiredDone = stages
    .filter((stage) => stage.stage !== 'connect_gsc')
    .every((stage) => stage.status === 'done');
  const ready = requiredDone && !hasFailure;

  return NextResponse.json({
    projectId,
    ready,
    hasRunning,
    stages,
  });
}
