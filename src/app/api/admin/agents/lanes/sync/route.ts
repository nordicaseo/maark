import { NextRequest, NextResponse } from 'next/server';
import { db, ensureDb } from '@/db';
import { projects } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { dbNow } from '@/db/utils';
import { requireRole } from '@/lib/auth';
import { userCanAccessProject } from '@/lib/access';
import { logAlertEvent, logAuditEvent } from '@/lib/observability';
import {
  getProjectAgentPoolHealth,
  parseProjectRuntimeSettings,
  syncProjectDedicatedAgentPool,
} from '@/lib/agents/runtime-agent-pools';
import { seedProjectAgentLaneProfiles } from '@/lib/agents/project-agent-profiles';
import type { AgentRoleCounts, ProjectLaneCapacitySettings } from '@/types/agent-runtime';
import { DEFAULT_LANE_CAPACITY_SETTINGS } from '@/types/agent-runtime';

function parseProjectId(value: unknown): number | null {
  const n = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function normalizeStaffingTemplate(input: unknown): 'small' | 'standard' | 'premium' {
  const value = String(input ?? '')
    .trim()
    .toLowerCase();
  if (value === 'small' || value === 'standard' || value === 'premium') return value;
  return 'small';
}

function sanitizeRoleCounts(input: unknown): AgentRoleCounts | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const source = input as Record<string, unknown>;
  const out: AgentRoleCounts = {};
  for (const role of [
    'researcher',
    'outliner',
    'writer',
    'seo-reviewer',
    'project-manager',
    'seo',
    'content',
    'lead',
  ] as const) {
    const raw = source[role];
    if (raw === undefined || raw === null) continue;
    out[role] = Math.max(1, Math.min(10, Number.parseInt(String(raw), 10) || 1));
  }
  return out;
}

function sanitizeLaneCapacity(input: unknown): ProjectLaneCapacitySettings | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const source = input as Record<string, unknown>;
  const minWritersPerLane = Math.max(
    1,
    Math.min(
      5,
      Number.parseInt(
        String(source.minWritersPerLane ?? DEFAULT_LANE_CAPACITY_SETTINGS.minWritersPerLane),
        10
      ) || DEFAULT_LANE_CAPACITY_SETTINGS.minWritersPerLane
    )
  );
  const maxRaw =
    Number.parseInt(
      String(source.maxWritersPerLane ?? DEFAULT_LANE_CAPACITY_SETTINGS.maxWritersPerLane),
      10
    ) || DEFAULT_LANE_CAPACITY_SETTINGS.maxWritersPerLane;
  const maxWritersPerLane = Math.max(minWritersPerLane, Math.min(8, maxRaw));
  const scaleUpQueueAgeSec = Math.max(
    30,
    Math.min(
      3600,
      Number.parseInt(
        String(source.scaleUpQueueAgeSec ?? DEFAULT_LANE_CAPACITY_SETTINGS.scaleUpQueueAgeSec),
        10
      ) || DEFAULT_LANE_CAPACITY_SETTINGS.scaleUpQueueAgeSec
    )
  );
  const scaleDownIdleSec = Math.max(
    300,
    Math.min(
      86400,
      Number.parseInt(
        String(source.scaleDownIdleSec ?? DEFAULT_LANE_CAPACITY_SETTINGS.scaleDownIdleSec),
        10
      ) || DEFAULT_LANE_CAPACITY_SETTINGS.scaleDownIdleSec
    )
  );
  return {
    minWritersPerLane,
    maxWritersPerLane,
    scaleUpQueueAgeSec,
    scaleDownIdleSec,
  };
}

export async function POST(req: NextRequest) {
  await ensureDb();
  const auth = await requireRole('super_admin');
  if (auth.error) return auth.error;

  try {
    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const projectId = parseProjectId(body.projectId);
    if (!projectId) {
      return NextResponse.json({ error: 'projectId is required' }, { status: 400 });
    }
    if (!(await userCanAccessProject(auth.user, projectId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const [project] = await db
      .select({ settings: projects.settings })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const runtime = parseProjectRuntimeSettings(project.settings);
    const template = normalizeStaffingTemplate(body.staffingTemplate ?? runtime.staffingTemplate);
    const roleCounts = sanitizeRoleCounts(body.roleCounts) ?? runtime.roleCounts;
    const laneCapacity = sanitizeLaneCapacity(body.laneCapacity) ?? runtime.laneCapacity;

    const baseSettings =
      project.settings && typeof project.settings === 'object'
        ? (project.settings as Record<string, unknown>)
        : {};
    await db
      .update(projects)
      .set({
        settings: {
          ...baseSettings,
          agentRuntime: {
            staffingTemplate: template,
            roleCounts,
            strictIsolation: true,
            laneCapacity,
          },
        },
        updatedAt: dbNow(),
      })
      .where(eq(projects.id, projectId));

    const seeded = await seedProjectAgentLaneProfiles(projectId, auth.user.id);
    const synced = await syncProjectDedicatedAgentPool({
      projectId,
      template,
      roleCounts,
      laneCapacity,
    });
    const health = await getProjectAgentPoolHealth(projectId);

    await logAuditEvent({
      userId: auth.user.id,
      action: 'admin.agent_lane.sync',
      resourceType: 'project',
      resourceId: projectId,
      projectId,
      metadata: {
        template,
        roleCounts,
        laneCapacity,
        seededLaneProfiles: seeded.seededLaneProfiles,
        created: synced.created,
        updated: synced.updated,
      },
    });

    return NextResponse.json({
      ok: true,
      projectId,
      template,
      roleCounts,
      laneCapacity,
      seededLaneProfiles: seeded.seededLaneProfiles,
      synced,
      health,
    });
  } catch (error) {
    await logAlertEvent({
      source: 'admin',
      eventType: 'agent_lane_sync_failed',
      severity: 'error',
      message: 'Failed to sync project lane writers.',
      metadata: { error: error instanceof Error ? error.message : 'Unknown error' },
    });
    return NextResponse.json({ error: 'Failed to sync lane runtime' }, { status: 500 });
  }
}
