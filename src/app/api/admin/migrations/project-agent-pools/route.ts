import { NextRequest, NextResponse } from 'next/server';
import { db, ensureDb } from '@/db';
import { projects } from '@/db/schema';
import { requireRole } from '@/lib/auth';
import { logAuditEvent } from '@/lib/observability';
import { api } from '../../../../../../convex/_generated/api';
import {
  markLegacyGlobalAgentsNonRoutable,
  parseProjectRuntimeSettings,
  syncProjectDedicatedAgentPool,
} from '@/lib/agents/runtime-agent-pools';
import { seedProjectAgentLaneProfiles } from '@/lib/agents/project-agent-profiles';
import {
  backfillProjectTaskStagePlans,
  repairProjectWriterRoutes,
} from '@/lib/workflow/stage-routing';
import { getConvexClient } from '@/lib/convex/server';

export async function POST(_req: NextRequest) {
  await ensureDb();
  const auth = await requireRole('super_admin');
  if (auth.error) return auth.error;

  const rows = await db
    .select({
      id: projects.id,
      settings: projects.settings,
    })
    .from(projects);

  const results: Array<{
    projectId: number;
    template: string;
    seededLaneProfiles: number;
    created: number;
    updated: number;
    routesCanonicalized?: number;
    stagePlansBackfilled?: number;
    tasksRequeued?: number;
    writersDeleted?: number;
    writersRenamed?: number;
    laneBackfilled?: number;
    stagePlanBackfilled?: number;
    stagePlanScanned?: number;
    stagePlanSkipped?: number;
    writerRoutesHealthy?: number;
    writerRoutesPatched?: number;
    writerSlotsSeeded?: number;
    staleWriterLocksRecovered?: number;
  }> = [];

  const convex = getConvexClient();

  for (const row of rows) {
    const runtime = parseProjectRuntimeSettings(row.settings);
    const laneSeeded = await seedProjectAgentLaneProfiles(row.id, auth.user.id);
    const synced = await syncProjectDedicatedAgentPool({
      projectId: row.id,
      template: runtime.staffingTemplate,
      roleCounts: runtime.roleCounts,
      laneCapacity: runtime.laneCapacity,
      userId: auth.user.id,
    });
    const backfill = convex
      ? await convex.mutation(api.topicWorkflow.backfillWorkflowLanes, { projectId: row.id })
      : null;
    const stagePlanBackfill = await backfillProjectTaskStagePlans({
      projectId: row.id,
      userId: auth.user.id,
    });
    const repairedRoutes = await repairProjectWriterRoutes({
      projectId: row.id,
      userId: auth.user.id,
      canonicalizeInvalidBlog: true,
    });
    results.push({
      projectId: row.id,
      template: runtime.staffingTemplate,
      seededLaneProfiles: laneSeeded.seededLaneProfiles.length,
      created: synced.created,
      updated: synced.updated,
      routesCanonicalized: repairedRoutes.routesPatched,
      stagePlansBackfilled: stagePlanBackfill.updated,
      tasksRequeued: synced.tasksRequeued,
      writersDeleted: synced.writersDeleted,
      writersRenamed: synced.writersRenamed,
      laneBackfilled: backfill?.updated ?? 0,
      stagePlanBackfilled: stagePlanBackfill.updated,
      stagePlanScanned: stagePlanBackfill.scanned,
      stagePlanSkipped: stagePlanBackfill.skipped,
      writerRoutesHealthy: repairedRoutes.routesHealthy,
      writerRoutesPatched: repairedRoutes.routesPatched,
      writerSlotsSeeded: repairedRoutes.writersSeeded,
      staleWriterLocksRecovered: repairedRoutes.staleLocksRecovered,
    });
  }

  const legacy = await markLegacyGlobalAgentsNonRoutable();

  await logAuditEvent({
    userId: auth.user.id,
    action: 'admin.migration.project_agent_pools',
    resourceType: 'project',
    severity: 'info',
    metadata: {
      projectsProcessed: rows.length,
      legacyGlobalUpdated: legacy.updated,
      results,
    },
  });

  return NextResponse.json({
    projectsProcessed: rows.length,
    legacyGlobalUpdated: legacy.updated,
    results,
  });
}
