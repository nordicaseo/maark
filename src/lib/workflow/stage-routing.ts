import { and, eq } from 'drizzle-orm';
import { api } from '../../../convex/_generated/api';
import type { Id } from '../../../convex/_generated/dataModel';
import { db, ensureDb } from '@/db';
import { dbNow } from '@/db/utils';
import { projectWorkflowStageRoutes, projects } from '@/db/schema';
import { getConvexClient } from '@/lib/convex/server';
import { resolveLaneFromContentType } from '@/lib/content-workflow-taxonomy';
import { resolveWorkflowProfilePolicy } from '@/lib/workflow/workflow-profiles';
import {
  parseProjectRuntimeSettings,
  syncProjectDedicatedAgentPool,
} from '@/lib/agents/runtime-agent-pools';
import type { AgentLaneKey } from '@/types/agent-runtime';
import type { ContentFormat } from '@/types/document';
import { CONTENT_FORMAT_LABELS } from '@/types/document';
import type {
  RoutableWorkflowStage,
  WorkflowStagePlanSnapshot,
  WorkflowStageRoute,
} from '@/types/workflow-routing';
import { ROUTABLE_WORKFLOW_STAGES } from '@/types/workflow-routing';
import type { WorkflowProfileStage } from '@/types/workflow-profile';

const SUPPORTED_CONTENT_FORMATS: ContentFormat[] = [
  'blog_post',
  'blog_listicle',
  'blog_buying_guide',
  'blog_how_to',
  'blog_review',
  'product_category',
  'product_description',
  'comparison',
  'news_article',
];

const BLOG_CONTENT_FORMATS = new Set<ContentFormat>([
  'blog_post',
  'blog_listicle',
  'blog_buying_guide',
  'blog_how_to',
  'blog_review',
]);

const DEFAULT_WRITER_LOCK_TIMEOUT_MS = 25 * 60 * 1000;

type RuntimeAgent = {
  _id: Id<'agents'>;
  name: string;
  role: string;
  status: string;
  projectId?: number;
  isDedicated?: boolean;
  laneKey?: string;
  slotKey?: string;
  assignmentHealth?: unknown;
  currentTaskId?: Id<'tasks'>;
};

type RuntimeTask = {
  _id: Id<'tasks'>;
  status: string;
  workflowCurrentStageKey?: string;
  workflowStageStatus?: string;
  workflowLastEventAt?: number;
  workflowUpdatedAt?: number;
  updatedAt?: number;
  workflowContentFormat?: string;
};

export type WritingSlotValidationCode =
  | 'ok'
  | 'invalid_slot'
  | 'wrong_role'
  | 'wrong_lane'
  | 'slot_not_found';

export interface WritingSlotValidationResult {
  ok: boolean;
  code: WritingSlotValidationCode;
  slotKey: string;
  laneKey: AgentLaneKey;
  message: string;
  agentId?: string | null;
  agentName?: string | null;
  writerStatus?: string | null;
  staleLock?: boolean;
  dedicated?: boolean;
  routable?: boolean;
}

export interface WorkflowRouteHealthRow {
  contentFormat: ContentFormat;
  writingSlotKey: string;
  exists: boolean;
  writerStatus: string | null;
  staleLock: boolean;
  queueImpactCount: number;
  validationCode: WritingSlotValidationCode;
}

type RouteRow = {
  id: number;
  projectId: number;
  contentFormat: ContentFormat;
  laneKey: AgentLaneKey;
  stageSlots: unknown;
  stageEnabled: unknown;
  createdById: string | null;
  updatedById: string | null;
  createdAt: string;
  updatedAt: string;
};

export interface ProjectWorkflowStageRoute extends WorkflowStageRoute {
  id: number;
  projectId: number;
  contentFormat: ContentFormat;
  createdById: string | null;
  updatedById: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertProjectWorkflowStageRouteInput {
  projectId: number;
  contentFormat: ContentFormat;
  laneKey?: AgentLaneKey;
  stageSlots?: Partial<Record<RoutableWorkflowStage, string>>;
  stageEnabled?: Partial<Record<RoutableWorkflowStage, boolean>>;
  userId?: string | null;
}

function normalizeLaneKey(value: unknown): AgentLaneKey {
  if (value === 'blog' || value === 'collection' || value === 'product' || value === 'landing') {
    return value;
  }
  return 'blog';
}

function resolveWriterLockTimeoutMs(): number {
  const parsed = Number.parseFloat(
    String(process.env.WORKFLOW_WRITER_LOCK_TIMEOUT_MINUTES ?? '')
  );
  if (!Number.isFinite(parsed)) return DEFAULT_WRITER_LOCK_TIMEOUT_MS;
  return Math.max(5, parsed) * 60 * 1000;
}

function normalizeAgentStatus(status: string | null | undefined): 'ONLINE' | 'IDLE' | 'WORKING' | 'OFFLINE' {
  const normalized = String(status || '')
    .trim()
    .toUpperCase();
  if (normalized === 'ONLINE') return 'ONLINE';
  if (normalized === 'IDLE') return 'IDLE';
  if (normalized === 'WORKING') return 'WORKING';
  return 'OFFLINE';
}

function writerNameForLane(laneKey: AgentLaneKey, ordinal = 1): string {
  const base =
    laneKey === 'blog'
      ? 'Atlas Blog'
      : laneKey === 'collection'
        ? 'Atlas Collection'
        : laneKey === 'product'
          ? 'Atlas Product'
          : 'Atlas Landing';
  return ordinal <= 1 ? base : `${base} ${ordinal}`;
}

function parseWriterSlotKey(slotKey: string): { projectId: number; laneKey: AgentLaneKey; ordinal: number } | null {
  const match = /^p(\d+):writer:(blog|collection|product|landing):(\d+)$/.exec(slotKey.trim());
  if (!match) return null;
  return {
    projectId: Number.parseInt(match[1], 10),
    laneKey: normalizeLaneKey(match[2]),
    ordinal: Number.parseInt(match[3], 10),
  };
}

function isBlogContentFormat(contentFormat: ContentFormat): boolean {
  return BLOG_CONTENT_FORMATS.has(contentFormat);
}

function assertStrictBlogWriterRoute(args: {
  projectId: number;
  contentFormat: ContentFormat;
  laneKey: AgentLaneKey;
  writingSlot: string;
}) {
  if (!isBlogContentFormat(args.contentFormat)) return;
  if (args.laneKey !== 'blog') {
    throw new Error(
      `Invalid workflow route for ${args.contentFormat}: blog formats require lane "blog".`
    );
  }
  const slot = String(args.writingSlot || '').trim();
  if (!slot) {
    throw new Error(
      `Invalid workflow route for ${args.contentFormat}: writing slot is required for strict blog routing.`
    );
  }
  const parsed = parseWriterSlotKey(slot);
  if (!parsed || parsed.projectId !== args.projectId || parsed.laneKey !== 'blog') {
    throw new Error(
      `Invalid workflow route for ${args.contentFormat}: writing slot "${slot}" must match project ${args.projectId} and lane "blog".`
    );
  }
}

function isRoutable(assignmentHealth: unknown): boolean {
  if (!assignmentHealth || typeof assignmentHealth !== 'object') return true;
  const record = assignmentHealth as Record<string, unknown>;
  return record.routable !== false;
}

function defaultStageSlots(projectId: number, laneKey: AgentLaneKey): Record<RoutableWorkflowStage, string> {
  return {
    research: `p${projectId}:researcher:1`,
    seo_intel_review: `p${projectId}:seo:1`,
    outline_build: `p${projectId}:outliner:1`,
    writing: `p${projectId}:writer:${laneKey}:1`,
    editing: `p${projectId}:editor:1`,
    final_review: `p${projectId}:seo-reviewer:1`,
  };
}

function defaultStageEnabled(contentFormat?: ContentFormat): Record<RoutableWorkflowStage, boolean> {
  if (contentFormat === 'product_category') {
    return {
      research: false,
      seo_intel_review: true,
      outline_build: true,
      writing: true,
      editing: true,
      final_review: true,
    };
  }
  return {
    research: true,
    seo_intel_review: true,
    outline_build: true,
    writing: true,
    editing: true,
    final_review: true,
  };
}

function parseObject(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  if (typeof value === 'object') return value as Record<string, unknown>;
  return {};
}

function parseStageSlots(
  value: unknown,
  projectId: number,
  laneKey: AgentLaneKey
): Record<RoutableWorkflowStage, string> {
  const defaults = defaultStageSlots(projectId, laneKey);
  const parsed = parseObject(value);
  const out = { ...defaults };
  for (const stage of ROUTABLE_WORKFLOW_STAGES) {
    const raw = parsed[stage];
    if (typeof raw === 'string' && raw.trim().length > 0) {
      out[stage] = raw.trim();
    }
  }
  return out;
}

function parseStageEnabled(
  value: unknown,
  contentFormat?: ContentFormat
): Record<RoutableWorkflowStage, boolean> {
  const defaults = defaultStageEnabled(contentFormat);
  const parsed = parseObject(value);
  const out = { ...defaults };
  for (const stage of ROUTABLE_WORKFLOW_STAGES) {
    if (parsed[stage] !== undefined) {
      out[stage] = parsed[stage] === true || String(parsed[stage]).toLowerCase() === 'true';
    }
  }
  return out;
}

function mapRouteRow(row: RouteRow): ProjectWorkflowStageRoute {
  const laneKey = normalizeLaneKey(row.laneKey);
  return {
    id: Number(row.id),
    projectId: Number(row.projectId),
    contentFormat: row.contentFormat,
    laneKey,
    stageSlots: parseStageSlots(row.stageSlots, Number(row.projectId), laneKey),
    stageEnabled: parseStageEnabled(row.stageEnabled, row.contentFormat),
    createdById: row.createdById,
    updatedById: row.updatedById,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mergeStageSlots(
  projectId: number,
  laneKey: AgentLaneKey,
  existing: Record<RoutableWorkflowStage, string>,
  incoming?: Partial<Record<RoutableWorkflowStage, string>>
): Record<RoutableWorkflowStage, string> {
  const base = {
    ...defaultStageSlots(projectId, laneKey),
    ...existing,
  };
  if (!incoming) return base;
  for (const stage of ROUTABLE_WORKFLOW_STAGES) {
    const value = incoming[stage];
    if (typeof value === 'string' && value.trim().length > 0) {
      base[stage] = value.trim();
    }
  }
  return base;
}

function mergeStageEnabled(
  existing: Record<RoutableWorkflowStage, boolean>,
  incoming?: Partial<Record<RoutableWorkflowStage, boolean>>,
  contentFormat?: ContentFormat
): Record<RoutableWorkflowStage, boolean> {
  const base = { ...defaultStageEnabled(contentFormat), ...existing };
  if (!incoming) return base;
  for (const stage of ROUTABLE_WORKFLOW_STAGES) {
    const value = incoming[stage];
    if (typeof value === 'boolean') {
      base[stage] = value;
    }
  }
  return base;
}

export async function seedProjectWorkflowStageRoutes(
  projectId: number,
  userId?: string | null
): Promise<{ seededFormats: ContentFormat[]; routes: ProjectWorkflowStageRoute[] }> {
  await ensureDb();
  const rows = (await db
    .select({
      id: projectWorkflowStageRoutes.id,
      projectId: projectWorkflowStageRoutes.projectId,
      contentFormat: projectWorkflowStageRoutes.contentFormat,
      laneKey: projectWorkflowStageRoutes.laneKey,
      stageSlots: projectWorkflowStageRoutes.stageSlots,
      stageEnabled: projectWorkflowStageRoutes.stageEnabled,
      createdById: projectWorkflowStageRoutes.createdById,
      updatedById: projectWorkflowStageRoutes.updatedById,
      createdAt: projectWorkflowStageRoutes.createdAt,
      updatedAt: projectWorkflowStageRoutes.updatedAt,
    })
    .from(projectWorkflowStageRoutes)
    .where(eq(projectWorkflowStageRoutes.projectId, projectId))) as RouteRow[];

  const existing = new Set(rows.map((row) => row.contentFormat));
  const seededFormats: ContentFormat[] = [];

  for (const contentFormat of SUPPORTED_CONTENT_FORMATS) {
    if (existing.has(contentFormat)) continue;
    const laneKey = normalizeLaneKey(resolveLaneFromContentType(contentFormat));
    await db.insert(projectWorkflowStageRoutes).values({
      projectId,
      contentFormat,
      laneKey,
      stageSlots: defaultStageSlots(projectId, laneKey),
      stageEnabled: defaultStageEnabled(contentFormat),
      createdById: userId ?? null,
      updatedById: userId ?? null,
      createdAt: dbNow(),
      updatedAt: dbNow(),
    });
    seededFormats.push(contentFormat);
  }

  const routes = await listProjectWorkflowStageRoutes(projectId);
  return { seededFormats, routes };
}

export async function listProjectWorkflowStageRoutes(
  projectId: number
): Promise<ProjectWorkflowStageRoute[]> {
  await ensureDb();
  const rows = (await db
    .select({
      id: projectWorkflowStageRoutes.id,
      projectId: projectWorkflowStageRoutes.projectId,
      contentFormat: projectWorkflowStageRoutes.contentFormat,
      laneKey: projectWorkflowStageRoutes.laneKey,
      stageSlots: projectWorkflowStageRoutes.stageSlots,
      stageEnabled: projectWorkflowStageRoutes.stageEnabled,
      createdById: projectWorkflowStageRoutes.createdById,
      updatedById: projectWorkflowStageRoutes.updatedById,
      createdAt: projectWorkflowStageRoutes.createdAt,
      updatedAt: projectWorkflowStageRoutes.updatedAt,
    })
    .from(projectWorkflowStageRoutes)
    .where(eq(projectWorkflowStageRoutes.projectId, projectId))) as RouteRow[];
  return rows.map(mapRouteRow);
}

export async function getProjectWorkflowStageRoute(
  projectId: number,
  contentFormat: ContentFormat
): Promise<ProjectWorkflowStageRoute | null> {
  await ensureDb();
  const [row] = (await db
    .select({
      id: projectWorkflowStageRoutes.id,
      projectId: projectWorkflowStageRoutes.projectId,
      contentFormat: projectWorkflowStageRoutes.contentFormat,
      laneKey: projectWorkflowStageRoutes.laneKey,
      stageSlots: projectWorkflowStageRoutes.stageSlots,
      stageEnabled: projectWorkflowStageRoutes.stageEnabled,
      createdById: projectWorkflowStageRoutes.createdById,
      updatedById: projectWorkflowStageRoutes.updatedById,
      createdAt: projectWorkflowStageRoutes.createdAt,
      updatedAt: projectWorkflowStageRoutes.updatedAt,
    })
    .from(projectWorkflowStageRoutes)
    .where(
      and(
        eq(projectWorkflowStageRoutes.projectId, projectId),
        eq(projectWorkflowStageRoutes.contentFormat, contentFormat)
      )
    )
    .limit(1)) as RouteRow[];
  return row ? mapRouteRow(row) : null;
}

export async function upsertProjectWorkflowStageRoute(
  input: UpsertProjectWorkflowStageRouteInput
): Promise<ProjectWorkflowStageRoute> {
  await ensureDb();
  const existing = await getProjectWorkflowStageRoute(input.projectId, input.contentFormat);
  const laneKey = normalizeLaneKey(input.laneKey ?? existing?.laneKey ?? resolveLaneFromContentType(input.contentFormat));

  if (!existing) {
    const stageSlots = mergeStageSlots(
      input.projectId,
      laneKey,
      defaultStageSlots(input.projectId, laneKey),
      input.stageSlots
    );
    const stageEnabled = mergeStageEnabled(
      defaultStageEnabled(input.contentFormat),
      input.stageEnabled,
      input.contentFormat
    );
    await db.insert(projectWorkflowStageRoutes).values({
      projectId: input.projectId,
      contentFormat: input.contentFormat,
      laneKey,
      stageSlots,
      stageEnabled,
      createdById: input.userId ?? null,
      updatedById: input.userId ?? null,
      createdAt: dbNow(),
      updatedAt: dbNow(),
    });
    const created = await getProjectWorkflowStageRoute(input.projectId, input.contentFormat);
    if (!created) throw new Error('Failed to create workflow stage route.');
    return created;
  }

  const stageSlots = mergeStageSlots(
    input.projectId,
    laneKey,
    existing.stageSlots,
    input.stageSlots
  );
  const stageEnabled = mergeStageEnabled(
    existing.stageEnabled,
    input.stageEnabled,
    input.contentFormat
  );

  await db
    .update(projectWorkflowStageRoutes)
    .set({
      laneKey,
      stageSlots,
      stageEnabled,
      updatedById: input.userId ?? null,
      updatedAt: dbNow(),
    })
    .where(eq(projectWorkflowStageRoutes.id, existing.id));

  const updated = await getProjectWorkflowStageRoute(input.projectId, input.contentFormat);
  if (!updated) throw new Error('Failed to update workflow stage route.');
  return updated;
}

async function getProjectRuntimeAgents(projectId: number): Promise<RuntimeAgent[]> {
  const convex = getConvexClient();
  if (!convex) {
    throw new Error('Mission Control is not configured (Convex URL missing)');
  }
  const rows = (await convex.query(api.agents.list, {
    projectId,
    limit: 2000,
  })) as RuntimeAgent[];
  return rows;
}

async function getRuntimeTaskById(
  taskId: Id<'tasks'>,
  projectId: number
): Promise<RuntimeTask | null> {
  const convex = getConvexClient();
  if (!convex) return null;
  return (await convex.query(api.tasks.get, {
    id: taskId,
    projectId,
  })) as RuntimeTask | null;
}

async function detectStaleWriterLock(
  agent: RuntimeAgent,
  projectId: number
): Promise<boolean> {
  const status = normalizeAgentStatus(agent.status);
  if (status !== 'WORKING') return false;
  if (!agent.currentTaskId) return true;
  const task = await getRuntimeTaskById(agent.currentTaskId, projectId);
  if (!task) return true;

  const stage = String(task.workflowCurrentStageKey || '').toLowerCase();
  const stageStatus = String(task.workflowStageStatus || '').toLowerCase();
  if (task.status !== 'IN_PROGRESS') return true;
  if (stage !== 'writing') return true;
  if (stageStatus !== 'in_progress') return true;

  const now = Date.now();
  const lockTimeoutMs = resolveWriterLockTimeoutMs();
  const lastTouch =
    task.workflowLastEventAt || task.workflowUpdatedAt || task.updatedAt || 0;
  if (lastTouch > 0 && now - lastTouch > lockTimeoutMs) {
    return true;
  }
  return false;
}

export async function validateConfiguredWritingSlot(args: {
  projectId: number;
  laneKey: AgentLaneKey;
  slotKey: string;
  runtimeAgents?: RuntimeAgent[];
}): Promise<WritingSlotValidationResult> {
  const normalizedSlot = String(args.slotKey || '').trim();
  if (!normalizedSlot) {
    return {
      ok: false,
      code: 'invalid_slot',
      slotKey: normalizedSlot,
      laneKey: args.laneKey,
      message: 'Writing slot is empty.',
    };
  }

  const agents = args.runtimeAgents ?? (await getProjectRuntimeAgents(args.projectId));
  const agent = agents.find((row) => String(row.slotKey || '').trim() === normalizedSlot);
  if (!agent) {
    const parsedSlot = parseWriterSlotKey(normalizedSlot);
    if (!parsedSlot) {
      return {
        ok: false,
        code: 'invalid_slot',
        slotKey: normalizedSlot,
        laneKey: args.laneKey,
        message: 'Configured writing slot key format is invalid.',
      };
    }
    if (parsedSlot.projectId !== args.projectId) {
      return {
        ok: false,
        code: 'invalid_slot',
        slotKey: normalizedSlot,
        laneKey: args.laneKey,
        message: 'Configured writing slot belongs to a different project.',
      };
    }
    if (parsedSlot.laneKey !== args.laneKey) {
      return {
        ok: false,
        code: 'wrong_lane',
        slotKey: normalizedSlot,
        laneKey: args.laneKey,
        message: `Configured writing slot lane mismatch. Expected ${args.laneKey}, got ${parsedSlot.laneKey}.`,
      };
    }
    return {
      ok: false,
      code: 'slot_not_found',
      slotKey: normalizedSlot,
      laneKey: args.laneKey,
      message: 'Configured writing slot does not exist in runtime agents.',
    };
  }

  if (String(agent.role || '').toLowerCase() !== 'writer') {
    return {
      ok: false,
      code: 'wrong_role',
      slotKey: normalizedSlot,
      laneKey: args.laneKey,
      message: 'Configured slot points to a non-writer agent.',
      agentId: String(agent._id),
      agentName: agent.name,
      writerStatus: normalizeAgentStatus(agent.status),
    };
  }

  const agentLane = normalizeLaneKey(agent.laneKey);
  if (agentLane !== args.laneKey) {
    return {
      ok: false,
      code: 'wrong_lane',
      slotKey: normalizedSlot,
      laneKey: args.laneKey,
      message: `Configured writer lane mismatch. Expected ${args.laneKey}, got ${agentLane}.`,
      agentId: String(agent._id),
      agentName: agent.name,
      writerStatus: normalizeAgentStatus(agent.status),
    };
  }

  const dedicated = agent.isDedicated !== false;
  const routable = isRoutable(agent.assignmentHealth);
  if (!dedicated || !routable) {
    return {
      ok: false,
      code: 'invalid_slot',
      slotKey: normalizedSlot,
      laneKey: args.laneKey,
      message: 'Configured writer slot is not routable/dedicated.',
      agentId: String(agent._id),
      agentName: agent.name,
      writerStatus: normalizeAgentStatus(agent.status),
      dedicated,
      routable,
    };
  }

  const staleLock = await detectStaleWriterLock(agent, args.projectId);
  return {
    ok: true,
    code: 'ok',
    slotKey: normalizedSlot,
    laneKey: args.laneKey,
    message: staleLock
      ? 'Configured writing slot is valid but has a stale lock.'
      : 'Configured writing slot is valid.',
    agentId: String(agent._id),
    agentName: agent.name,
    writerStatus: normalizeAgentStatus(agent.status),
    staleLock,
    dedicated,
    routable,
  };
}

async function ensureWriterAgentAtSlot(args: {
  projectId: number;
  laneKey: AgentLaneKey;
  slotKey: string;
  runtimeAgents: RuntimeAgent[];
}): Promise<{ created: boolean; outcomeCode: string }> {
  const convex = getConvexClient();
  if (!convex) {
    throw new Error('Mission Control is not configured (Convex URL missing)');
  }

  const existing = args.runtimeAgents.find(
    (agent) => String(agent.slotKey || '').trim() === args.slotKey
  );
  if (existing) return { created: false, outcomeCode: 'slot_exists' };

  const parsed = parseWriterSlotKey(args.slotKey);
  if (!parsed || parsed.projectId !== args.projectId || parsed.laneKey !== args.laneKey) {
    return { created: false, outcomeCode: 'invalid_slot' };
  }

  await convex.mutation(api.agents.register, {
    name: writerNameForLane(args.laneKey, parsed.ordinal),
    role: 'writer',
    specialization: `Lane writer (${args.laneKey})`,
    skills: ['SEO writing', 'keyword research', 'content structure', 'blog posts'],
    projectId: args.projectId,
    isDedicated: true,
    capacityWeight: 1,
    slotKey: args.slotKey,
    laneKey: args.laneKey,
    laneProfileKey: `writer:${args.laneKey}`,
    assignmentHealth: {
      routable: true,
      strictIsolation: true,
      temporary: false,
    },
  });

  return { created: true, outcomeCode: 'configured_writer_seeded' };
}

async function normalizeWriterAvailability(args: {
  projectId: number;
  slotKey: string;
  runtimeAgents: RuntimeAgent[];
}): Promise<{ repaired: boolean; outcomeCode: string; writerStatus: string | null }> {
  const convex = getConvexClient();
  if (!convex) {
    throw new Error('Mission Control is not configured (Convex URL missing)');
  }

  const writer = args.runtimeAgents.find(
    (agent) => String(agent.slotKey || '').trim() === args.slotKey
  );
  if (!writer) {
    return { repaired: false, outcomeCode: 'slot_not_found', writerStatus: null };
  }

  const status = normalizeAgentStatus(writer.status);
  if (status === 'OFFLINE') {
    await convex.mutation(api.agents.updateStatus, {
      id: writer._id,
      status: 'IDLE',
    });
    return {
      repaired: true,
      outcomeCode: 'configured_writer_stale_recovered',
      writerStatus: 'IDLE',
    };
  }

  const staleLock = await detectStaleWriterLock(writer, args.projectId);
  if (staleLock) {
    await convex.mutation(api.agents.updateStatus, {
      id: writer._id,
      status: 'IDLE',
    });
    return {
      repaired: true,
      outcomeCode: 'configured_writer_stale_recovered',
      writerStatus: 'IDLE',
    };
  }

  return { repaired: false, outcomeCode: 'healthy', writerStatus: status };
}

export async function getProjectWorkflowRouteHealth(
  projectId: number
): Promise<WorkflowRouteHealthRow[]> {
  const routes = await listProjectWorkflowStageRoutes(projectId);
  const convex = getConvexClient();
  if (!convex) return [];
  const runtimeAgents = await getProjectRuntimeAgents(projectId);
  const tasks = (await convex.query(api.tasks.list, {
    projectId,
    limit: 1200,
  })) as RuntimeTask[];

  const queueImpactByFormat = new Map<ContentFormat, number>();
  for (const task of tasks) {
    if (String(task.workflowCurrentStageKey || '') !== 'writing') continue;
    if (String(task.workflowStageStatus || '') !== 'queued') continue;
    const format = task.workflowContentFormat as ContentFormat | undefined;
    if (!format) continue;
    queueImpactByFormat.set(format, (queueImpactByFormat.get(format) || 0) + 1);
  }

  const out: WorkflowRouteHealthRow[] = [];
  for (const route of routes) {
    const validation = await validateConfiguredWritingSlot({
      projectId,
      laneKey: route.laneKey,
      slotKey: route.stageSlots.writing || '',
      runtimeAgents,
    });
    out.push({
      contentFormat: route.contentFormat,
      writingSlotKey: route.stageSlots.writing || '',
      exists:
        validation.ok ||
        validation.code === 'wrong_role' ||
        validation.code === 'wrong_lane',
      writerStatus: validation.writerStatus || null,
      staleLock: Boolean(validation.staleLock),
      queueImpactCount: queueImpactByFormat.get(route.contentFormat) || 0,
      validationCode: validation.code,
    });
  }
  return out;
}

export async function repairProjectWriterRoutes(args: {
  projectId: number;
  userId?: string | null;
  canonicalizeInvalidBlog?: boolean;
}): Promise<{
  routesScanned: number;
  routesPatched: number;
  routesHealthy: number;
  writersSeeded: number;
  staleLocksRecovered: number;
  results: Array<{
    contentFormat: ContentFormat;
    writingSlotKey: string;
    validationCode: WritingSlotValidationCode;
    patchedToCanonical: boolean;
    repairOutcomeCode: string;
  }>;
}> {
  await ensureDb();
  const [project] = await db
    .select({ settings: projects.settings })
    .from(projects)
    .where(eq(projects.id, args.projectId))
    .limit(1);
  if (!project) {
    throw new Error('Project not found.');
  }

  const runtime = parseProjectRuntimeSettings(project.settings);
  await syncProjectDedicatedAgentPool({
    projectId: args.projectId,
    template: runtime.staffingTemplate,
    roleCounts: runtime.roleCounts,
    laneCapacity: runtime.laneCapacity,
    userId: args.userId ?? null,
  });

  const routes = await listProjectWorkflowStageRoutes(args.projectId);
  let routesPatched = 0;
  let routesHealthy = 0;
  let writersSeeded = 0;
  let staleLocksRecovered = 0;
  const results: Array<{
    contentFormat: ContentFormat;
    writingSlotKey: string;
    validationCode: WritingSlotValidationCode;
    patchedToCanonical: boolean;
    repairOutcomeCode: string;
  }> = [];

  for (const route of routes) {
    const writingSlot = route.stageSlots.writing || '';
    let effectiveLane: AgentLaneKey = route.laneKey;
    let runtimeAgents = await getProjectRuntimeAgents(args.projectId);
    let validation = await validateConfiguredWritingSlot({
      projectId: args.projectId,
      laneKey: effectiveLane,
      slotKey: writingSlot,
      runtimeAgents,
    });

    let patchedToCanonical = false;
    let repairOutcomeCode = validation.code === 'ok' ? 'healthy' : validation.code;
    let effectiveSlot = writingSlot;

    if (validation.code === 'slot_not_found') {
      const seeded = await ensureWriterAgentAtSlot({
        projectId: args.projectId,
        laneKey: effectiveLane,
        slotKey: effectiveSlot,
        runtimeAgents,
      });
      if (seeded.created) writersSeeded += 1;
      repairOutcomeCode = seeded.outcomeCode;
      runtimeAgents = await getProjectRuntimeAgents(args.projectId);
      validation = await validateConfiguredWritingSlot({
        projectId: args.projectId,
        laneKey: effectiveLane,
        slotKey: effectiveSlot,
        runtimeAgents,
      });
    }

    const shouldCanonicalizeBlogRoute =
      !validation.ok &&
      isBlogContentFormat(route.contentFormat) &&
      args.canonicalizeInvalidBlog !== false &&
      (validation.code === 'invalid_slot' ||
        validation.code === 'wrong_lane' ||
        validation.code === 'wrong_role');

    if (shouldCanonicalizeBlogRoute) {
      const canonicalBlogSlot = `p${args.projectId}:writer:blog:1`;
      const updatedSlots = { ...route.stageSlots, writing: canonicalBlogSlot };
      await upsertProjectWorkflowStageRoute({
        projectId: args.projectId,
        contentFormat: route.contentFormat,
        laneKey: 'blog',
        stageSlots: updatedSlots,
        stageEnabled: route.stageEnabled,
        userId: args.userId ?? null,
      });
      patchedToCanonical = true;
      routesPatched += 1;
      effectiveSlot = canonicalBlogSlot;
      effectiveLane = 'blog';
      runtimeAgents = await getProjectRuntimeAgents(args.projectId);
      validation = await validateConfiguredWritingSlot({
        projectId: args.projectId,
        laneKey: effectiveLane,
        slotKey: canonicalBlogSlot,
        runtimeAgents,
      });
      repairOutcomeCode = `patched:${repairOutcomeCode}`;
      if (validation.code === 'slot_not_found') {
        const seeded = await ensureWriterAgentAtSlot({
          projectId: args.projectId,
          laneKey: effectiveLane,
          slotKey: effectiveSlot,
          runtimeAgents,
        });
        if (seeded.created) writersSeeded += 1;
        repairOutcomeCode = seeded.outcomeCode;
        runtimeAgents = await getProjectRuntimeAgents(args.projectId);
        validation = await validateConfiguredWritingSlot({
          projectId: args.projectId,
          laneKey: effectiveLane,
          slotKey: effectiveSlot,
          runtimeAgents,
        });
      }
    }

    if (validation.ok) {
      const normalized = await normalizeWriterAvailability({
        projectId: args.projectId,
        slotKey: effectiveSlot,
        runtimeAgents,
      });
      if (normalized.repaired) {
        staleLocksRecovered += 1;
        repairOutcomeCode = normalized.outcomeCode;
      }
      routesHealthy += 1;
    }

    results.push({
      contentFormat: route.contentFormat,
      writingSlotKey: effectiveSlot,
      validationCode: validation.code,
      patchedToCanonical,
      repairOutcomeCode,
    });
  }

  return {
    routesScanned: routes.length,
    routesPatched,
    routesHealthy,
    writersSeeded,
    staleLocksRecovered,
    results,
  };
}

export async function resolveWorkflowStagePlanSnapshot(args: {
  projectId: number;
  contentFormat: ContentFormat;
  laneKey?: AgentLaneKey;
  userId?: string | null;
}): Promise<WorkflowStagePlanSnapshot> {
  await ensureDb();
  await seedProjectWorkflowStageRoutes(args.projectId, args.userId ?? null);
  const route =
    (await getProjectWorkflowStageRoute(args.projectId, args.contentFormat)) ??
    (await upsertProjectWorkflowStageRoute({
      projectId: args.projectId,
      contentFormat: args.contentFormat,
      laneKey: args.laneKey,
      userId: args.userId,
    }));

  const laneKey = normalizeLaneKey(args.laneKey ?? route.laneKey);
  const workflowProfile = await resolveWorkflowProfilePolicy({
    projectId: args.projectId,
    contentFormat: args.contentFormat,
  });
  assertStrictBlogWriterRoute({
    projectId: args.projectId,
    contentFormat: args.contentFormat,
    laneKey,
    writingSlot: workflowProfile.stageEnabled.writing ? route.stageSlots.writing || '' : `p${args.projectId}:writer:${laneKey}:1`,
  });
  const normalizedSlots = {
    ...route.stageSlots,
    writing:
      route.stageSlots.writing && route.stageSlots.writing.includes(':writer:')
        ? route.stageSlots.writing.replace(
            /:writer:[^:]+:/,
            `:writer:${laneKey}:`
          )
        : `p${args.projectId}:writer:${laneKey}:1`,
  } as Record<RoutableWorkflowStage, string>;

  const convex = getConvexClient();
  const allAgents = convex
    ? await convex.query(api.agents.list, { projectId: args.projectId, limit: 1200 })
    : [];

  const owners = Object.fromEntries(
    ROUTABLE_WORKFLOW_STAGES.map((stage) => {
      const slotKey = normalizedSlots[stage];
      const enabled = route.stageEnabled[stage] !== false;
      const runtimeAgent =
        allAgents.find((agent) => String(agent.slotKey || '') === slotKey) || null;
      return [
        stage,
        {
          stage,
          slotKey,
          enabled,
          laneKey,
          agentId: runtimeAgent ? String(runtimeAgent._id) : null,
          agentName: runtimeAgent?.name ?? null,
          agentRole: runtimeAgent?.role ?? null,
        },
      ];
    })
  ) as WorkflowStagePlanSnapshot['owners'];

  const enabledStageSequence = workflowProfile.stageSequence.filter(
    (stage) => workflowProfile.stageEnabled[stage] !== false
  ) as WorkflowProfileStage[];

  return {
    projectId: args.projectId,
    contentFormat: args.contentFormat,
    laneKey,
    owners,
    workflowProfile,
    enabledStageSequence,
    createdAt: Date.now(),
  };
}

function isContentFormat(value: unknown): value is ContentFormat {
  return (
    typeof value === 'string' &&
    Object.prototype.hasOwnProperty.call(CONTENT_FORMAT_LABELS, value)
  );
}

function inferContentFormat(task: {
  workflowContentFormat?: unknown;
  workflowPageType?: unknown;
  workflowSubtype?: unknown;
  tags?: unknown;
}): ContentFormat {
  if (isContentFormat(task.workflowContentFormat)) {
    return task.workflowContentFormat;
  }

  const tags = Array.isArray(task.tags) ? task.tags : [];
  for (const tag of tags) {
    if (typeof tag !== 'string') continue;
    if (!tag.startsWith('format:')) continue;
    const value = tag.slice('format:'.length).trim();
    if (isContentFormat(value)) return value;
  }

  const subtype = String(task.workflowSubtype || '').trim().toLowerCase();
  if (subtype === 'how_to_guide') return 'blog_how_to';
  if (subtype === 'buying_guide') return 'blog_buying_guide';
  if (subtype === 'best_of' || subtype === 'listicle') return 'blog_listicle';
  if (subtype === 'review') return 'blog_review';
  if (subtype === 'comparison') return 'comparison';
  if (subtype === 'blog_post') return 'blog_post';

  const pageType = String(task.workflowPageType || '').trim().toLowerCase();
  if (pageType === 'collection') return 'product_category';
  if (pageType === 'product') return 'product_description';
  if (pageType === 'landing_page') return 'product_description';
  if (pageType === 'homepage') return 'blog_post';
  if (pageType === 'faq') return 'blog_how_to';

  return 'blog_post';
}

function inferLaneKey(task: { workflowLaneKey?: unknown }, contentFormat: ContentFormat): AgentLaneKey {
  const lane = task.workflowLaneKey;
  if (lane === 'blog' || lane === 'collection' || lane === 'product' || lane === 'landing') {
    return lane;
  }
  return normalizeLaneKey(resolveLaneFromContentType(contentFormat));
}

function hasStagePlan(task: { workflowStagePlan?: unknown }): boolean {
  if (!task.workflowStagePlan || typeof task.workflowStagePlan !== 'object') return false;
  const plan = task.workflowStagePlan as Record<string, unknown>;
  return Boolean(plan.owners && typeof plan.owners === 'object');
}

export async function backfillProjectTaskStagePlans(args: {
  projectId: number;
  userId?: string | null;
  force?: boolean;
}): Promise<{
  scanned: number;
  updated: number;
  skipped: number;
  sample: Array<{ taskId: string; contentFormat: ContentFormat; laneKey: AgentLaneKey }>;
}> {
  const convex = getConvexClient();
  if (!convex) {
    throw new Error('Mission Control is not configured (Convex URL missing)');
  }

  const tasks = (await convex.query(api.tasks.list, {
    projectId: args.projectId,
    limit: 1000,
  })) as Array<{
    _id: Id<'tasks'>;
    workflowTemplateKey?: string;
    workflowStagePlan?: unknown;
    workflowContentFormat?: unknown;
    workflowPageType?: unknown;
    workflowSubtype?: unknown;
    workflowLaneKey?: unknown;
    tags?: unknown;
  }>;

  const planCache = new Map<string, WorkflowStagePlanSnapshot>();
  let scanned = 0;
  let updated = 0;
  let skipped = 0;
  const sample: Array<{ taskId: string; contentFormat: ContentFormat; laneKey: AgentLaneKey }> = [];

  for (const task of tasks) {
    if (task.workflowTemplateKey !== 'topic_production_v1') continue;
    scanned += 1;

    if (!args.force && hasStagePlan(task)) {
      skipped += 1;
      continue;
    }

    const contentFormat = inferContentFormat(task);
    const laneKey = inferLaneKey(task, contentFormat);
    const cacheKey = `${contentFormat}:${laneKey}`;

    let stagePlan = planCache.get(cacheKey);
    if (!stagePlan) {
      stagePlan = await resolveWorkflowStagePlanSnapshot({
        projectId: args.projectId,
        contentFormat,
        laneKey,
        userId: args.userId ?? null,
      });
      planCache.set(cacheKey, stagePlan);
    }

    const existingTags = Array.isArray(task.tags)
      ? task.tags.filter((tag): tag is string => typeof tag === 'string')
      : [];
    const tags = Array.from(
      new Set([...existingTags, `format:${contentFormat}`, `lane:${laneKey}`])
    );

    await convex.mutation(api.tasks.update, {
      id: task._id,
      expectedProjectId: args.projectId,
      workflowContentFormat: contentFormat,
      workflowLaneKey: laneKey,
      workflowStagePlan: stagePlan,
      tags,
    });

    updated += 1;
    if (sample.length < 20) {
      sample.push({ taskId: String(task._id), contentFormat, laneKey });
    }
  }

  return { scanned, updated, skipped, sample };
}
