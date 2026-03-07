import { NextRequest, NextResponse } from 'next/server';
import { db, ensureDb } from '@/db';
import { projects } from '@/db/schema';
import { requireRole } from '@/lib/auth';
import { logAuditEvent } from '@/lib/observability';
import {
  markLegacyGlobalAgentsNonRoutable,
  parseProjectRuntimeSettings,
  syncProjectDedicatedAgentPool,
} from '@/lib/agents/runtime-agent-pools';

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
    created: number;
    updated: number;
  }> = [];

  for (const row of rows) {
    const runtime = parseProjectRuntimeSettings(row.settings);
    const synced = await syncProjectDedicatedAgentPool({
      projectId: row.id,
      template: runtime.staffingTemplate,
      roleCounts: runtime.roleCounts,
    });
    results.push({
      projectId: row.id,
      template: runtime.staffingTemplate,
      created: synced.created,
      updated: synced.updated,
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
