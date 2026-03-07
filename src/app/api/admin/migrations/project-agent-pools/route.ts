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
    laneBackfilled?: number;
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
    });
    const backfill = convex
      ? await convex.mutation(api.topicWorkflow.backfillWorkflowLanes, { projectId: row.id })
      : null;
    results.push({
      projectId: row.id,
      template: runtime.staffingTemplate,
      seededLaneProfiles: laneSeeded.seededLaneProfiles.length,
      created: synced.created,
      updated: synced.updated,
      laneBackfilled: backfill?.updated ?? 0,
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
