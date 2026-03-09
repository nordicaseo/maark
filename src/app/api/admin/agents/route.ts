import { NextRequest, NextResponse } from 'next/server';
import { api } from '../../../../../convex/_generated/api';
import { requireRole } from '@/lib/auth';
import { userCanAccessProject } from '@/lib/access';
import { getConvexClient } from '@/lib/convex/server';
import { logAlertEvent, logAuditEvent } from '@/lib/observability';
import {
  seedProjectAgentProfiles,
  upsertProjectAgentProfile,
} from '@/lib/agents/project-agent-profiles';
import {
  AGENT_FILE_KEYS,
  AGENT_KNOWLEDGE_PART_TYPES,
  FIXED_AGENT_ROLES,
  type AgentRole,
} from '@/types/agent-profile';
import {
  backfillProjectTaskStagePlans,
  repairProjectWriterRoutes,
} from '@/lib/workflow/stage-routing';
import {
  getProjectAgentPoolHealth,
  parseProjectRuntimeSettings,
  syncProjectDedicatedAgentPool,
} from '@/lib/agents/runtime-agent-pools';
import type { AgentRoleCounts, ProjectLaneCapacitySettings } from '@/types/agent-runtime';
import { DEFAULT_LANE_CAPACITY_SETTINGS } from '@/types/agent-runtime';

function parseProjectId(value: unknown): number | null {
  const n = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function isAgentRole(value: unknown): value is AgentRole {
  return typeof value === 'string' && FIXED_AGENT_ROLES.includes(value as AgentRole);
}

function sanitizeFileBundle(
  input: unknown
): Record<string, string> | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const out: Record<string, string> = {};
  for (const key of AGENT_FILE_KEYS) {
    const raw = (input as Record<string, unknown>)[key];
    if (typeof raw === 'string') out[key] = raw;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function sanitizeKnowledgeParts(input: unknown) {
  if (!Array.isArray(input)) return undefined;
  const out: Array<{
    id: string;
    partType: (typeof AGENT_KNOWLEDGE_PART_TYPES)[number];
    label: string;
    content: string;
    sortOrder: number;
  }> = [];
  for (const item of input) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const rawPartType = String(row.partType || '').trim();
    const partType = AGENT_KNOWLEDGE_PART_TYPES.includes(rawPartType as (typeof AGENT_KNOWLEDGE_PART_TYPES)[number])
      ? (rawPartType as (typeof AGENT_KNOWLEDGE_PART_TYPES)[number])
      : 'custom';
    const content = typeof row.content === 'string' ? row.content.trim() : '';
    if (!content) continue;
    const label = typeof row.label === 'string' && row.label.trim()
      ? row.label.trim()
      : partType.replace(/_/g, ' ');
    const id = typeof row.id === 'string' && row.id.trim()
      ? row.id.trim()
      : `${partType}:${out.length}`;
    const sortOrder = Number.isFinite(Number(row.sortOrder))
      ? Math.max(0, Math.trunc(Number(row.sortOrder)))
      : out.length;
    out.push({ id, partType, label, content, sortOrder });
  }
  return out;
}

function sanitizeModelOverrides(input: unknown) {
  if (!input || typeof input !== 'object') return undefined;
  const out: Record<string, { provider?: string; modelId?: string; temperature?: number }> = {};
  for (const [key, raw] of Object.entries(input as Record<string, unknown>)) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const provider = typeof r.provider === 'string' ? r.provider.trim() : undefined;
    const modelId = typeof r.modelId === 'string' ? r.modelId.trim() : undefined;
    const temperature =
      typeof r.temperature === 'number' && Number.isFinite(r.temperature)
        ? r.temperature
        : undefined;
    out[key] = {
      ...(provider ? { provider } : {}),
      ...(modelId ? { modelId } : {}),
      ...(temperature !== undefined ? { temperature } : {}),
    };
  }
  return out;
}

function sanitizeAvatarUrl(input: unknown): string | undefined {
  if (typeof input !== 'string') return undefined;
  const value = input.trim();
  if (!value) return '';
  if (/^https?:\/\//i.test(value) || value.startsWith('/')) {
    return value;
  }
  return undefined;
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
  for (const role of FIXED_AGENT_ROLES) {
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

export async function GET(req: NextRequest) {
  const auth = await requireRole('super_admin');
  if (auth.error) return auth.error;

  try {
    const projectId = parseProjectId(req.nextUrl.searchParams.get('projectId'));
    if (!projectId) {
      return NextResponse.json({ error: 'projectId is required' }, { status: 400 });
    }

    if (!(await userCanAccessProject(auth.user, projectId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { seededRoles, profiles } = await seedProjectAgentProfiles(projectId, auth.user.id);
    return NextResponse.json({
      projectId,
      seededRoles,
      profiles,
    });
  } catch (error) {
    await logAlertEvent({
      source: 'admin',
      eventType: 'agent_profiles_list_failed',
      severity: 'error',
      message: 'Failed to list project agent profiles.',
      metadata: { error: error instanceof Error ? error.message : 'Unknown error' },
    });
    console.error('Admin agents GET failed:', error);
    return NextResponse.json({ error: 'Failed to load agent profiles' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  const auth = await requireRole('super_admin');
  if (auth.error) return auth.error;

  try {
    const body = await req.json();
    const projectId = parseProjectId(body.projectId);
    if (!projectId) {
      return NextResponse.json({ error: 'projectId is required' }, { status: 400 });
    }
    if (!isAgentRole(body.role)) {
      return NextResponse.json({ error: 'Invalid role' }, { status: 400 });
    }
    if (!(await userCanAccessProject(auth.user, projectId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const profile = await upsertProjectAgentProfile({
      projectId,
      role: body.role,
      displayName: typeof body.displayName === 'string' ? body.displayName : undefined,
      emoji: typeof body.emoji === 'string' ? body.emoji : undefined,
      avatarUrl: sanitizeAvatarUrl(body.avatarUrl),
      shortDescription:
        typeof body.shortDescription === 'string' ? body.shortDescription : undefined,
      mission: typeof body.mission === 'string' ? body.mission : undefined,
      isEnabled: typeof body.isEnabled === 'boolean' ? body.isEnabled : undefined,
      fileBundle: sanitizeFileBundle(body.fileBundle),
      knowledgeParts: sanitizeKnowledgeParts(body.knowledgeParts),
      skillIds: [],
      modelOverrides: sanitizeModelOverrides(body.modelOverrides),
      heartbeatMeta:
        body.heartbeatMeta && typeof body.heartbeatMeta === 'object'
          ? body.heartbeatMeta
          : undefined,
      userId: auth.user.id,
    });

    await logAuditEvent({
      userId: auth.user.id,
      action: 'admin.agent_profile.update',
      resourceType: 'project_agent_profile',
      resourceId: `${projectId}:${body.role}`,
      projectId,
      metadata: {
        role: body.role,
        isEnabled: profile.isEnabled,
        knowledgeParts: profile.knowledgeParts.length,
      },
    });

    return NextResponse.json(profile);
  } catch (error) {
    await logAlertEvent({
      source: 'admin',
      eventType: 'agent_profile_update_failed',
      severity: 'error',
      message: 'Failed to update project agent profile.',
      metadata: { error: error instanceof Error ? error.message : 'Unknown error' },
    });
    console.error('Admin agents PUT failed:', error);
    return NextResponse.json({ error: 'Failed to update agent profile' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireRole('super_admin');
  if (auth.error) return auth.error;

  try {
    const body = await req.json();
    const projectId = parseProjectId(body.projectId);
    if (!projectId) {
      return NextResponse.json({ error: 'projectId is required' }, { status: 400 });
    }
    if (!(await userCanAccessProject(auth.user, projectId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const action = String(body.action || 'runtime_health');
    if (action === 'runtime_health') {
      const health = await getProjectAgentPoolHealth(projectId);
      return NextResponse.json({ projectId, health });
    }

    if (action === 'sync_runtime') {
      const runtime = parseProjectRuntimeSettings(body.settings);
      const template = normalizeStaffingTemplate(
        body.staffingTemplate ?? runtime.staffingTemplate
      );
      const roleCounts = sanitizeRoleCounts(body.roleCounts) ?? runtime.roleCounts;
      const laneCapacity = sanitizeLaneCapacity(body.laneCapacity) ?? runtime.laneCapacity;
      const synced = await syncProjectDedicatedAgentPool({
        projectId,
        template,
        roleCounts,
        laneCapacity,
        userId: auth.user.id,
      });
      const repairedRoutes = await repairProjectWriterRoutes({
        projectId,
        userId: auth.user.id,
        canonicalizeInvalidBlog: true,
      });
      const stagePlanBackfill = await backfillProjectTaskStagePlans({
        projectId,
        userId: auth.user.id,
        force: true,
      });
      const health = await getProjectAgentPoolHealth(projectId);
      await logAuditEvent({
        userId: auth.user.id,
        action: 'admin.agent_runtime.sync',
        resourceType: 'project',
        resourceId: projectId,
        projectId,
        metadata: {
          template,
          roleCounts,
          laneCapacity,
          created: synced.created,
          updated: synced.updated,
          routesCanonicalized: repairedRoutes.routesPatched,
          stagePlansBackfilled: stagePlanBackfill.updated,
          tasksRequeued: synced.tasksRequeued,
          writersDeleted: synced.writersDeleted,
          writersRenamed: synced.writersRenamed,
        },
      });
      return NextResponse.json({
        projectId,
        template,
        roleCounts,
        laneCapacity,
        synced,
        routesCanonicalized: repairedRoutes.routesPatched,
        stagePlansBackfilled: stagePlanBackfill.updated,
        stagePlanScanned: stagePlanBackfill.scanned,
        stagePlanSkipped: stagePlanBackfill.skipped,
        tasksRequeued: synced.tasksRequeued,
        writersDeleted: synced.writersDeleted,
        writersRenamed: synced.writersRenamed,
        health,
      });
    }

    if (action === 'reset_runtime_agents') {
      const convex = getConvexClient();
      if (!convex) {
        return NextResponse.json({ error: 'Convex client unavailable' }, { status: 503 });
      }
      const agents = await convex.query(api.agents.list, {
        projectId,
        limit: 200,
      });
      let resetCount = 0;
      for (const agent of agents || []) {
        const status = String(agent.status || '').toUpperCase();
        if (status === 'WORKING' || status === 'OFFLINE') {
          try {
            await convex.mutation(api.topicWorkflow.forceReleaseStaleAgent, {
              agentId: agent._id,
              taskId: agent.currentTaskId ?? undefined,
              reason: 'admin_reset_runtime_agents',
            });
            resetCount++;
          } catch (resetErr) {
            console.error(`Failed to reset agent ${agent._id}:`, resetErr);
          }
        }
      }
      await logAuditEvent({
        userId: auth.user.id,
        action: 'admin.agent_runtime.reset',
        resourceType: 'project',
        resourceId: projectId,
        projectId,
        metadata: { resetCount, totalAgents: (agents || []).length },
      });
      return NextResponse.json({ projectId, resetCount, totalAgents: (agents || []).length });
    }

    return NextResponse.json({ error: 'Unsupported action' }, { status: 400 });
  } catch (error) {
    await logAlertEvent({
      source: 'admin',
      eventType: 'agent_runtime_action_failed',
      severity: 'error',
      message: 'Failed to run agent runtime action.',
      metadata: { error: error instanceof Error ? error.message : 'Unknown error' },
    });
    return NextResponse.json({ error: 'Failed to process runtime action' }, { status: 500 });
  }
}
