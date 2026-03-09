import { NextRequest, NextResponse } from 'next/server';
import { api } from '../../../../../../convex/_generated/api';
import { requireRole } from '@/lib/auth';
import { userCanAccessProject } from '@/lib/access';
import { logAlertEvent, logAuditEvent } from '@/lib/observability';
import {
  backfillProjectTaskStagePlans,
  getProjectWorkflowRouteHealth,
  getProjectWorkflowStageRoute,
  listProjectWorkflowStageRoutes,
  repairProjectWriterRoutes,
  seedProjectWorkflowStageRoutes,
  upsertProjectWorkflowStageRoute,
  validateConfiguredWritingSlot,
} from '@/lib/workflow/stage-routing';
import { resolveWorkflowProfilePolicy } from '@/lib/workflow/workflow-profiles';
import {
  parseProjectRuntimeSettings,
  syncProjectDedicatedAgentPool,
} from '@/lib/agents/runtime-agent-pools';
import {
  listProjectAgentLaneProfiles,
  listProjectAgentProfiles,
  synchronizeWriterLaneProfileNames,
} from '@/lib/agents/project-agent-profiles';
import { getConvexClient } from '@/lib/convex/server';
import { db, ensureDb } from '@/db';
import { projects } from '@/db/schema';
import { eq } from 'drizzle-orm';
import type { AgentLaneKey } from '@/types/agent-runtime';
import { AGENT_WRITER_LANES } from '@/types/agent-runtime';
import type { ContentFormat } from '@/types/document';
import { CONTENT_FORMAT_LABELS } from '@/types/document';
import type { RoutableWorkflowStage } from '@/types/workflow-routing';
import { ROUTABLE_WORKFLOW_STAGES } from '@/types/workflow-routing';

function parseProjectId(value: unknown): number | null {
  const n = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function isContentFormat(value: unknown): value is ContentFormat {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(CONTENT_FORMAT_LABELS, value);
}

function isBlogFormat(contentFormat: ContentFormat): boolean {
  return contentFormat.startsWith('blog_');
}

function isLaneKey(value: unknown): value is AgentLaneKey {
  return typeof value === 'string' && AGENT_WRITER_LANES.includes(value as AgentLaneKey);
}

function sanitizeStageSlots(
  value: unknown
): Partial<Record<RoutableWorkflowStage, string>> | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const out: Partial<Record<RoutableWorkflowStage, string>> = {};
  const source = value as Record<string, unknown>;
  for (const stage of ROUTABLE_WORKFLOW_STAGES) {
    const raw = source[stage];
    if (typeof raw === 'string' && raw.trim().length > 0) out[stage] = raw.trim();
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function sanitizeStageEnabled(
  value: unknown
): Partial<Record<RoutableWorkflowStage, boolean>> | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const out: Partial<Record<RoutableWorkflowStage, boolean>> = {};
  const source = value as Record<string, unknown>;
  for (const stage of ROUTABLE_WORKFLOW_STAGES) {
    if (source[stage] !== undefined) {
      out[stage] = source[stage] === true || String(source[stage]).toLowerCase() === 'true';
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function isRoutableRuntimeAgent(assignmentHealth: unknown): boolean {
  if (!assignmentHealth || typeof assignmentHealth !== 'object') return true;
  return (assignmentHealth as Record<string, unknown>).routable !== false;
}

function parseSlotOrdinal(slotKey: string): number | null {
  const parts = slotKey.split(':');
  for (let idx = parts.length - 1; idx >= 0; idx -= 1) {
    const raw = parts[idx];
    const parsed = Number.parseInt(raw || '', 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return null;
}

function parsePrimaryWriterSlotKey(
  projectId: number,
  slotKey: string
): { laneKey: AgentLaneKey; ordinal: number } | null {
  const match = new RegExp(
    `^p${projectId}:writer:(blog|collection|product|landing):(\\d+)$`
  ).exec(slotKey.trim());
  if (!match) return null;
  const laneKey = match[1] as AgentLaneKey;
  const ordinal = Number.parseInt(match[2], 10);
  if (!Number.isFinite(ordinal)) return null;
  return { laneKey, ordinal };
}

function withOrdinalSuffix(name: string, ordinal: number | null): string {
  if (!ordinal || ordinal <= 1) return name;
  const suffix = ` ${ordinal}`;
  return name.endsWith(suffix) ? name : `${name}${suffix}`;
}

export async function GET(req: NextRequest) {
  await ensureDb();
  const auth = await requireRole('super_admin');
  if (auth.error) return auth.error;

  const projectId = parseProjectId(req.nextUrl.searchParams.get('projectId'));
  if (!projectId) {
    return NextResponse.json({ error: 'projectId is required' }, { status: 400 });
  }
  if (!(await userCanAccessProject(auth.user, projectId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const seeded = await seedProjectWorkflowStageRoutes(projectId, auth.user.id);
    await synchronizeWriterLaneProfileNames({
      projectId,
      userId: auth.user.id,
    });
    const contentFormat = req.nextUrl.searchParams.get('contentFormat');
    const routes = seeded.routes;
    const filtered = isContentFormat(contentFormat)
      ? routes.filter((route) => route.contentFormat === contentFormat)
      : routes;
    const [projectRoleProfiles, projectLaneProfiles] = await Promise.all([
      listProjectAgentProfiles(projectId),
      listProjectAgentLaneProfiles(projectId, 'writer'),
    ]);
    const roleDisplayNameByRole = new Map(
      projectRoleProfiles
        .map((profile) => [profile.role.toLowerCase(), profile.displayName.trim()] as const)
        .filter((entry) => entry[1].length > 0)
    );
    const writerLaneDisplayNameByLane = new Map(
      projectLaneProfiles
        .map((profile) => [profile.laneKey.toLowerCase(), profile.displayName.trim()] as const)
        .filter((entry) => entry[1].length > 0)
    );
    const convex = getConvexClient();
    const runtimeAgents = convex
      ? (
          (await convex.query(api.agents.list, {
            projectId,
            limit: 1200,
          })) as Array<{
            _id: string;
            name: string;
            role: string;
            status: string;
            slotKey?: string;
            laneKey?: string;
            currentTaskId?: string;
            isDedicated?: boolean;
            assignmentHealth?: Record<string, unknown>;
          }>
        )
          .filter((agent) => {
            const slotKey = String(agent.slotKey || '').trim();
            if (!slotKey) return false;
            if (agent.isDedicated === false) return false;
            if (!isRoutableRuntimeAgent(agent.assignmentHealth)) return false;
            if (slotKey.includes(':auto:')) return false;
            if (!slotKey.startsWith(`p${projectId}:`)) return false;
            const role = String(agent.role || '').toLowerCase();
            if (role === 'writer') {
              const laneKey = String(agent.laneKey || '').toLowerCase();
              if (!isLaneKey(laneKey)) return false;
              const parsed = parsePrimaryWriterSlotKey(projectId, slotKey);
              if (!parsed || parsed.ordinal !== 1) return false;
              return parsed.laneKey === laneKey;
            }
            return true;
          })
          .map((agent) => ({
            role: String(agent.role || '').toLowerCase(),
            laneKey: String(agent.laneKey || '').toLowerCase(),
            slotKey: String(agent.slotKey || ''),
            _rawName: agent.name,
            id: String(agent._id),
            status: agent.status,
            currentTaskId: agent.currentTaskId ? String(agent.currentTaskId) : null,
          }))
          .map((agent) => {
            const ordinal = parseSlotOrdinal(agent.slotKey);
            const laneDisplayName =
              agent.role === 'writer'
                ? writerLaneDisplayNameByLane.get(agent.laneKey) || null
                : null;
            const roleDisplayName = roleDisplayNameByRole.get(agent.role) || null;
            const runtimeName = String(agent._rawName || '').trim();
            const fallbackName = laneDisplayName || roleDisplayName || agent.slotKey;
            const resolvedName = runtimeName || withOrdinalSuffix(fallbackName, ordinal);
            return {
              id: agent.id,
              name: resolvedName,
              role: agent.role,
              status: agent.status,
              slotKey: agent.slotKey,
              laneKey: agent.laneKey,
              currentTaskId: agent.currentTaskId,
            };
          })
          .sort((a, b) => {
            const roleSort = a.role.localeCompare(b.role);
            if (roleSort !== 0) return roleSort;
            const nameSort = a.name.localeCompare(b.name);
            if (nameSort !== 0) return nameSort;
            return a.slotKey.localeCompare(b.slotKey);
          })
      : [];
    const workflowProfiles = Object.fromEntries(
      await Promise.all(
        filtered.map(async (route) => [
          route.contentFormat,
          await resolveWorkflowProfilePolicy({
            projectId,
            contentFormat: route.contentFormat,
          }),
        ])
      )
    );
    return NextResponse.json({
      projectId,
      seededFormats: seeded.seededFormats,
      routes: filtered,
      workflowProfiles,
      runtimeAgents,
      routeHealth: await getProjectWorkflowRouteHealth(projectId),
    });
  } catch (error) {
    await logAlertEvent({
      source: 'admin',
      eventType: 'workflow_routes_list_failed',
      severity: 'error',
      message: 'Failed to load workflow routing.',
      metadata: { error: error instanceof Error ? error.message : 'Unknown error' },
    });
    return NextResponse.json({ error: 'Failed to load workflow routes' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  await ensureDb();
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
    if (!isContentFormat(body.contentFormat)) {
      return NextResponse.json({ error: 'Invalid contentFormat' }, { status: 400 });
    }

    const contentFormat = body.contentFormat as ContentFormat;
    const workflowProfile = await resolveWorkflowProfilePolicy({
      projectId,
      contentFormat,
    });
    const existingRoute = await getProjectWorkflowStageRoute(projectId, contentFormat);
    const nextStageEnabled = {
      ...(existingRoute?.stageEnabled || {}),
      ...(sanitizeStageEnabled(body.stageEnabled) || {}),
    } as Partial<Record<RoutableWorkflowStage, boolean>>;
    const writingEnabledFromRoute = nextStageEnabled.writing !== false;
    const writingEnabledFromProfile = workflowProfile.stageEnabled.writing !== false;
    const writingStageRequired = writingEnabledFromRoute && writingEnabledFromProfile;
    const nextLaneKey = isLaneKey(body.laneKey)
      ? body.laneKey
      : (existingRoute?.laneKey ?? 'blog');
    if (isBlogFormat(contentFormat) && writingStageRequired && nextLaneKey !== 'blog') {
      return NextResponse.json(
        {
          error: 'Blog formats require a blog writer lane.',
          code: 'wrong_lane',
          details: {
            laneKey: nextLaneKey,
            expectedLane: 'blog',
            contentFormat,
          },
        },
        { status: 400 }
      );
    }
    const nextStageSlots = {
      ...(existingRoute?.stageSlots || {}),
      ...(sanitizeStageSlots(body.stageSlots) || {}),
    } as Partial<Record<RoutableWorkflowStage, string>>;
    if (writingStageRequired) {
      const writingSlotKey = String(nextStageSlots.writing || '').trim();
      const validationLane = isBlogFormat(contentFormat) ? 'blog' : nextLaneKey;
      let writingValidation = await validateConfiguredWritingSlot({
        projectId,
        laneKey: validationLane,
        slotKey: writingSlotKey,
      });

      if (!writingValidation.ok) {
        const [project] = await db
          .select({ settings: projects.settings })
          .from(projects)
          .where(eq(projects.id, projectId))
          .limit(1);
        if (project) {
          const runtime = parseProjectRuntimeSettings(project.settings);
          await syncProjectDedicatedAgentPool({
            projectId,
            template: runtime.staffingTemplate,
            roleCounts: runtime.roleCounts,
            laneCapacity: runtime.laneCapacity,
            userId: auth.user.id,
          });
          await repairProjectWriterRoutes({
            projectId,
            userId: auth.user.id,
            canonicalizeInvalidBlog: true,
          });
          writingValidation = await validateConfiguredWritingSlot({
            projectId,
            laneKey: validationLane,
            slotKey: writingSlotKey,
          });
        }
      }

      if (!writingValidation.ok) {
        return NextResponse.json(
          {
            error: writingValidation.message,
            code: writingValidation.code,
            details: {
              slotKey: writingValidation.slotKey,
              laneKey: writingValidation.laneKey,
              agentId: writingValidation.agentId ?? null,
              agentName: writingValidation.agentName ?? null,
              writerStatus: writingValidation.writerStatus ?? null,
              dedicated: writingValidation.dedicated ?? null,
              routable: writingValidation.routable ?? null,
            },
          },
          { status: 400 }
        );
      }
    }

    const route = await upsertProjectWorkflowStageRoute({
      projectId,
      contentFormat,
      laneKey: nextLaneKey,
      stageSlots: sanitizeStageSlots(body.stageSlots),
      stageEnabled: sanitizeStageEnabled(body.stageEnabled),
      userId: auth.user.id,
    });

    await logAuditEvent({
      userId: auth.user.id,
      action: 'admin.workflow_route.update',
      resourceType: 'project_workflow_stage_route',
      resourceId: `${projectId}:${route.contentFormat}`,
      projectId,
      metadata: {
        contentFormat: route.contentFormat,
        laneKey: route.laneKey,
        stageSlots: route.stageSlots,
        stageEnabled: route.stageEnabled,
      },
    });

    return NextResponse.json(route);
  } catch (error) {
    await logAlertEvent({
      source: 'admin',
      eventType: 'workflow_route_update_failed',
      severity: 'error',
      message: 'Failed to update workflow route.',
      metadata: { error: error instanceof Error ? error.message : 'Unknown error' },
    });
    return NextResponse.json({ error: 'Failed to update workflow route' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  await ensureDb();
  const auth = await requireRole('super_admin');
  if (auth.error) return auth.error;

  try {
    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const action = String(body.action || '').trim().toLowerCase();
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

    if (action === 'repair') {
      const repair = await repairProjectWriterRoutes({
        projectId,
        userId: auth.user.id,
        canonicalizeInvalidBlog: true,
      });
      const stagePlanBackfill = await backfillProjectTaskStagePlans({
        projectId,
        userId: auth.user.id,
        force: true,
      });
      const routes = await listProjectWorkflowStageRoutes(projectId);
      const routeHealth = await getProjectWorkflowRouteHealth(projectId);
      await logAuditEvent({
        userId: auth.user.id,
        action: 'admin.workflow_route.repair',
        resourceType: 'project',
        resourceId: projectId,
        projectId,
        metadata: {
          repair,
          stagePlanBackfill,
        },
      });
      return NextResponse.json({
        ok: true,
        projectId,
        action: 'repair',
        repair,
        stagePlanBackfill,
        routes,
        routeHealth,
      });
    }

    const seeded = await seedProjectWorkflowStageRoutes(projectId, auth.user.id);
    const backfillActiveTasks =
      body.backfillActiveTasks === undefined
        ? true
        : body.backfillActiveTasks === true ||
          String(body.backfillActiveTasks).toLowerCase() === 'true';
    const runtime = parseProjectRuntimeSettings(project.settings);
    const synced = await syncProjectDedicatedAgentPool({
      projectId,
      template: runtime.staffingTemplate,
      roleCounts: runtime.roleCounts,
      laneCapacity: runtime.laneCapacity,
      userId: auth.user.id,
    });
    const repair = await repairProjectWriterRoutes({
      projectId,
      userId: auth.user.id,
      canonicalizeInvalidBlog: true,
    });
    const stagePlanBackfill = backfillActiveTasks
      ? await backfillProjectTaskStagePlans({
          projectId,
          userId: auth.user.id,
        })
      : null;
    const routes = await listProjectWorkflowStageRoutes(projectId);
    const routeHealth = await getProjectWorkflowRouteHealth(projectId);

    await logAuditEvent({
      userId: auth.user.id,
      action: 'admin.workflow_route.sync',
      resourceType: 'project',
      resourceId: projectId,
      projectId,
      metadata: {
        seededFormats: seeded.seededFormats,
        synced,
        repair,
        backfillActiveTasks,
        stagePlanBackfill,
        routesCanonicalized: repair.routesPatched,
        stagePlansBackfilled: stagePlanBackfill?.updated ?? 0,
        tasksRequeued: synced.tasksRequeued,
        writersDeleted: synced.writersDeleted,
        writersRenamed: synced.writersRenamed,
      },
    });

    return NextResponse.json({
      ok: true,
      projectId,
      seededFormats: seeded.seededFormats,
      synced,
      repair,
      stagePlanBackfill,
      routesCanonicalized: repair.routesPatched,
      stagePlansBackfilled: stagePlanBackfill?.updated ?? 0,
      tasksRequeued: synced.tasksRequeued,
      writersDeleted: synced.writersDeleted,
      writersRenamed: synced.writersRenamed,
      routes,
      routeHealth,
    });
  } catch (error) {
    await logAlertEvent({
      source: 'admin',
      eventType: 'workflow_route_sync_failed',
      severity: 'error',
      message: 'Failed to sync workflow routing.',
      metadata: { error: error instanceof Error ? error.message : 'Unknown error' },
    });
    return NextResponse.json({ error: 'Failed to sync workflow routing' }, { status: 500 });
  }
}
