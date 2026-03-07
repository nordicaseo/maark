import { and, eq } from 'drizzle-orm';
import { api } from '../../../convex/_generated/api';
import type { Id } from '../../../convex/_generated/dataModel';
import { db, ensureDb } from '@/db';
import { dbNow } from '@/db/utils';
import { projectWorkflowStageRoutes } from '@/db/schema';
import { getConvexClient } from '@/lib/convex/server';
import { resolveLaneFromContentType } from '@/lib/content-workflow-taxonomy';
import type { AgentLaneKey } from '@/types/agent-runtime';
import type { ContentFormat } from '@/types/document';
import { CONTENT_FORMAT_LABELS } from '@/types/document';
import type {
  RoutableWorkflowStage,
  WorkflowStagePlanSnapshot,
  WorkflowStageRoute,
} from '@/types/workflow-routing';
import { ROUTABLE_WORKFLOW_STAGES } from '@/types/workflow-routing';

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

function defaultStageEnabled(): Record<RoutableWorkflowStage, boolean> {
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

function parseStageEnabled(value: unknown): Record<RoutableWorkflowStage, boolean> {
  const defaults = defaultStageEnabled();
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
    stageEnabled: parseStageEnabled(row.stageEnabled),
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
  incoming?: Partial<Record<RoutableWorkflowStage, boolean>>
): Record<RoutableWorkflowStage, boolean> {
  const base = { ...defaultStageEnabled(), ...existing };
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
      stageEnabled: defaultStageEnabled(),
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
    const stageEnabled = mergeStageEnabled(defaultStageEnabled(), input.stageEnabled);
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
  const stageEnabled = mergeStageEnabled(existing.stageEnabled, input.stageEnabled);

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

  return {
    projectId: args.projectId,
    contentFormat: args.contentFormat,
    laneKey,
    owners,
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
