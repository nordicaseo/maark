import { and, asc, eq, inArray, or } from 'drizzle-orm';
import { db, ensureDb } from '@/db';
import { dbNow } from '@/db/utils';
import {
  workflowProfiles,
  workflowProfileAssignments,
} from '@/db/schema';
import type { AIAction } from '@/types/ai';
import type { ContentFormat } from '@/types/document';
import type {
  ResolvedWorkflowProfilePolicy,
  WorkflowProfileAssignment,
  WorkflowProfileConfig,
  WorkflowProfileStage,
} from '@/types/workflow-profile';
import {
  WORKFLOW_PROFILE_STAGE_CATALOG,
  isWorkflowProfileStage,
} from '@/types/workflow-profile';

const DEFAULT_STAGE_SEQUENCE: WorkflowProfileStage[] = [...WORKFLOW_PROFILE_STAGE_CATALOG];

const DEFAULT_STAGE_ENABLED: Record<WorkflowProfileStage, boolean> = {
  research: true,
  seo_intel_review: true,
  outline_build: true,
  writing: true,
  editing: true,
  final_review: true,
};

const DEFAULT_STAGE_ACTIONS: Record<WorkflowProfileStage, AIAction> = {
  research: 'workflow_research',
  seo_intel_review: 'workflow_serp',
  outline_build: 'workflow_outline',
  writing: 'workflow_writing',
  editing: 'workflow_editing',
  final_review: 'workflow_final_review',
};

const FALLBACK_PROFILE_KEY = 'topic_production_v1';

function parseRecord(value: unknown): Record<string, unknown> {
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

function parseArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed) ? (parsed as T[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function normalizeSequence(value: unknown): WorkflowProfileStage[] {
  const parsed = parseArray<unknown>(value)
    .map((item) => String(item))
    .filter(isWorkflowProfileStage);
  const uniq: WorkflowProfileStage[] = [];
  for (const stage of parsed) {
    if (!uniq.includes(stage)) uniq.push(stage);
  }
  return uniq.length > 0 ? uniq : [...DEFAULT_STAGE_SEQUENCE];
}

function normalizeEnabled(value: unknown): Record<WorkflowProfileStage, boolean> {
  const source = parseRecord(value);
  return Object.fromEntries(
    WORKFLOW_PROFILE_STAGE_CATALOG.map((stage) => {
      const raw = source[stage];
      const enabled =
        raw === undefined
          ? DEFAULT_STAGE_ENABLED[stage]
          : raw === true || String(raw).toLowerCase() === 'true';
      return [stage, enabled];
    })
  ) as Record<WorkflowProfileStage, boolean>;
}

function isAiAction(value: unknown): value is AIAction {
  return (
    typeof value === 'string' &&
    [
      'writing',
      'rewriting',
      'formatting',
      'skill_generation',
      'comment_processing',
      'research',
      'workflow_research',
      'workflow_serp',
      'workflow_outline',
      'workflow_prewrite',
      'workflow_writing',
      'workflow_editing',
      'workflow_final_review',
      'workflow_pm',
    ].includes(value)
  );
}

function normalizeActions(value: unknown): Record<WorkflowProfileStage, AIAction> {
  const source = parseRecord(value);
  return Object.fromEntries(
    WORKFLOW_PROFILE_STAGE_CATALOG.map((stage) => {
      const raw = source[stage];
      return [stage, isAiAction(raw) ? raw : DEFAULT_STAGE_ACTIONS[stage]];
    })
  ) as Record<WorkflowProfileStage, AIAction>;
}

function normalizeGuidance(value: unknown): Partial<Record<WorkflowProfileStage, string>> {
  const source = parseRecord(value);
  const out: Partial<Record<WorkflowProfileStage, string>> = {};
  for (const stage of WORKFLOW_PROFILE_STAGE_CATALOG) {
    const raw = source[stage];
    if (typeof raw === 'string' && raw.trim().length > 0) {
      out[stage] = raw.trim();
    }
  }
  return out;
}

function normalizeProfileRow(row: Record<string, unknown>): WorkflowProfileConfig {
  return {
    id: Number(row.id),
    key: String(row.key),
    name: String(row.name || row.key || 'Workflow Profile'),
    description: row.description ? String(row.description) : null,
    stageSequence: normalizeSequence(row.stageSequence),
    stageEnabled: normalizeEnabled(row.stageEnabled),
    stageActions: normalizeActions(row.stageActions),
    stageGuidance: normalizeGuidance(row.stageGuidance),
    isSystem: row.isSystem === true || Number(row.isSystem ?? 0) === 1,
    isActive: row.isActive === true || Number(row.isActive ?? 0) === 1,
    createdAt: row.createdAt ? String(row.createdAt) : new Date().toISOString(),
    updatedAt: row.updatedAt ? String(row.updatedAt) : new Date().toISOString(),
  };
}

function normalizeAssignmentRow(row: Record<string, unknown>): WorkflowProfileAssignment {
  return {
    id: Number(row.id),
    scope: row.scope === 'project' ? 'project' : 'global',
    scopeKey: String(row.scopeKey || 'global'),
    projectId: row.projectId == null ? null : Number(row.projectId),
    contentFormat: String(row.contentFormat) as ContentFormat,
    profileKey: String(row.profileKey),
    createdAt: row.createdAt ? String(row.createdAt) : new Date().toISOString(),
    updatedAt: row.updatedAt ? String(row.updatedAt) : new Date().toISOString(),
  };
}

export async function listWorkflowProfileConfigs(): Promise<WorkflowProfileConfig[]> {
  await ensureDb();
  const rows = (await db
    .select({
      id: workflowProfiles.id,
      key: workflowProfiles.key,
      name: workflowProfiles.name,
      description: workflowProfiles.description,
      stageSequence: workflowProfiles.stageSequence,
      stageEnabled: workflowProfiles.stageEnabled,
      stageActions: workflowProfiles.stageActions,
      stageGuidance: workflowProfiles.stageGuidance,
      isSystem: workflowProfiles.isSystem,
      isActive: workflowProfiles.isActive,
      createdAt: workflowProfiles.createdAt,
      updatedAt: workflowProfiles.updatedAt,
    })
    .from(workflowProfiles)
    .orderBy(asc(workflowProfiles.name))) as Array<Record<string, unknown>>;
  return rows.map(normalizeProfileRow);
}

export async function upsertWorkflowProfileConfig(input: {
  key: string;
  name: string;
  description?: string | null;
  stageSequence?: WorkflowProfileStage[];
  stageEnabled?: Partial<Record<WorkflowProfileStage, boolean>>;
  stageActions?: Partial<Record<WorkflowProfileStage, AIAction>>;
  stageGuidance?: Partial<Record<WorkflowProfileStage, string>>;
  isSystem?: boolean;
  isActive?: boolean;
}): Promise<WorkflowProfileConfig> {
  await ensureDb();

  const key = input.key.trim();
  if (!key) {
    throw new Error('Workflow profile key is required.');
  }

  const [existing] = await db
    .select({ id: workflowProfiles.id })
    .from(workflowProfiles)
    .where(eq(workflowProfiles.key, key))
    .limit(1);

  const stageSequence = normalizeSequence(input.stageSequence);
  const stageEnabled = normalizeEnabled(input.stageEnabled);
  const stageActions = normalizeActions(input.stageActions);
  const stageGuidance = normalizeGuidance(input.stageGuidance);

  if (existing) {
    const [updated] = await db
      .update(workflowProfiles)
      .set({
        name: input.name.trim() || key,
        description: input.description ?? null,
        stageSequence,
        stageEnabled,
        stageActions,
        stageGuidance,
        isSystem: input.isSystem ?? false,
        isActive: input.isActive !== false,
        updatedAt: dbNow(),
      })
      .where(eq(workflowProfiles.id, existing.id))
      .returning();
    return normalizeProfileRow(updated as unknown as Record<string, unknown>);
  }

  const [created] = await db
    .insert(workflowProfiles)
    .values({
      key,
      name: input.name.trim() || key,
      description: input.description ?? null,
      stageSequence,
      stageEnabled,
      stageActions,
      stageGuidance,
      isSystem: input.isSystem ?? false,
      isActive: input.isActive !== false,
    })
    .returning();
  return normalizeProfileRow(created as unknown as Record<string, unknown>);
}

export async function listWorkflowProfileAssignments(
  projectId?: number | null
): Promise<WorkflowProfileAssignment[]> {
  await ensureDb();
  const predicates = [eq(workflowProfileAssignments.scope, 'global')];
  if (projectId) {
    predicates.push(eq(workflowProfileAssignments.projectId, projectId));
  }
  const rows = (await db
    .select({
      id: workflowProfileAssignments.id,
      scope: workflowProfileAssignments.scope,
      scopeKey: workflowProfileAssignments.scopeKey,
      projectId: workflowProfileAssignments.projectId,
      contentFormat: workflowProfileAssignments.contentFormat,
      profileKey: workflowProfileAssignments.profileKey,
      createdAt: workflowProfileAssignments.createdAt,
      updatedAt: workflowProfileAssignments.updatedAt,
    })
    .from(workflowProfileAssignments)
    .where(or(...predicates))
    .orderBy(asc(workflowProfileAssignments.contentFormat))) as Array<Record<string, unknown>>;
  return rows.map(normalizeAssignmentRow);
}

export async function upsertWorkflowProfileAssignment(input: {
  projectId?: number | null;
  contentFormat: ContentFormat;
  profileKey: string;
}): Promise<WorkflowProfileAssignment> {
  await ensureDb();
  const scope = input.projectId ? 'project' : 'global';
  const scopeKey = input.projectId ? `project:${input.projectId}` : 'global';
  const profileKey = input.profileKey.trim();

  const [existingProfile] = await db
    .select({ key: workflowProfiles.key })
    .from(workflowProfiles)
    .where(eq(workflowProfiles.key, profileKey))
    .limit(1);
  if (!existingProfile) {
    throw new Error('Workflow profile key not found.');
  }

  const [existing] = await db
    .select({ id: workflowProfileAssignments.id })
    .from(workflowProfileAssignments)
    .where(
      and(
        eq(workflowProfileAssignments.scopeKey, scopeKey),
        eq(workflowProfileAssignments.contentFormat, input.contentFormat)
      )
    )
    .limit(1);

  if (existing) {
    const [updated] = await db
      .update(workflowProfileAssignments)
      .set({
        scope,
        scopeKey,
        projectId: input.projectId ?? null,
        profileKey,
        updatedAt: dbNow(),
      })
      .where(eq(workflowProfileAssignments.id, existing.id))
      .returning();
    return normalizeAssignmentRow(updated as unknown as Record<string, unknown>);
  }

  const [created] = await db
    .insert(workflowProfileAssignments)
    .values({
      scope,
      scopeKey,
      projectId: input.projectId ?? null,
      contentFormat: input.contentFormat,
      profileKey,
    })
    .returning();

  return normalizeAssignmentRow(created as unknown as Record<string, unknown>);
}

export async function resolveWorkflowProfilePolicy(input: {
  projectId?: number | null;
  contentFormat: ContentFormat;
}): Promise<ResolvedWorkflowProfilePolicy> {
  await ensureDb();

  const scopeKeys = input.projectId ? [`project:${input.projectId}`, 'global'] : ['global'];
  const assignments = (await db
    .select({
      scope: workflowProfileAssignments.scope,
      scopeKey: workflowProfileAssignments.scopeKey,
      contentFormat: workflowProfileAssignments.contentFormat,
      profileKey: workflowProfileAssignments.profileKey,
    })
    .from(workflowProfileAssignments)
    .where(
      and(
        inArray(workflowProfileAssignments.scopeKey, scopeKeys),
        eq(workflowProfileAssignments.contentFormat, input.contentFormat)
      )
    )) as Array<{
    scope: string;
    scopeKey: string;
    contentFormat: string;
    profileKey: string;
  }>;

  const prioritized =
    assignments.find((item) => item.scope === 'project') ??
    assignments.find((item) => item.scope === 'global') ??
    null;

  const resolvedKey = prioritized?.profileKey || FALLBACK_PROFILE_KEY;
  const [profile] = await db
    .select({
      key: workflowProfiles.key,
      name: workflowProfiles.name,
      stageSequence: workflowProfiles.stageSequence,
      stageEnabled: workflowProfiles.stageEnabled,
      stageActions: workflowProfiles.stageActions,
      stageGuidance: workflowProfiles.stageGuidance,
    })
    .from(workflowProfiles)
    .where(eq(workflowProfiles.key, resolvedKey))
    .limit(1);

  if (!profile) {
    return {
      key: resolvedKey,
      name: resolvedKey,
      source: 'fallback',
      stageSequence: [...DEFAULT_STAGE_SEQUENCE],
      stageEnabled: { ...DEFAULT_STAGE_ENABLED },
      stageActions: { ...DEFAULT_STAGE_ACTIONS },
      stageGuidance: {},
    };
  }

  return {
    key: profile.key,
    name: profile.name,
    source:
      prioritized?.scope === 'project' ? 'project' : prioritized ? 'global' : 'fallback',
    stageSequence: normalizeSequence(profile.stageSequence),
    stageEnabled: normalizeEnabled(profile.stageEnabled),
    stageActions: normalizeActions(profile.stageActions),
    stageGuidance: normalizeGuidance(profile.stageGuidance),
  };
}
