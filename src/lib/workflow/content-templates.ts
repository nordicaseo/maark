import { and, asc, eq, inArray, or } from 'drizzle-orm';
import { db, ensureDb } from '@/db';
import { dbNow } from '@/db/utils';
import {
  contentTemplateAssignments,
  contentTemplates,
} from '@/db/schema';
import type { ContentFormat } from '@/types/document';
import type {
  ContentTemplateConfig,
  OutlineConstraintPolicy,
  StyleGuardPolicy,
  TemplateAssignment,
  WordRangePolicy,
} from '@/types/content-template-config';

const DEFAULT_WORD_RANGE: WordRangePolicy = { min: 1200, max: 2500 };
const DEFAULT_OUTLINE_CONSTRAINTS: OutlineConstraintPolicy = { maxH2: 8, maxH3PerH2: 3 };
const DEFAULT_STYLE_GUARD: StyleGuardPolicy = {
  emDash: 'allow',
  colon: 'allow',
  maxNarrativeColons: 0,
};

const FALLBACK_TEMPLATE_BY_FORMAT: Record<ContentFormat, string> = {
  blog_post: 'blog_standard_v2',
  blog_listicle: 'blog_listicle_v2',
  blog_buying_guide: 'blog_buying_guide_v2',
  blog_how_to: 'blog_how_to_v2',
  blog_review: 'blog_review_v2',
  product_category: 'product_collection',
  product_description: 'product_landing',
  comparison: 'comparison',
  news_article: 'news',
};

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

function normalizeWordRange(value: unknown): WordRangePolicy {
  const data = parseRecord(value);
  const minRaw = Number(data.min);
  const maxRaw = Number(data.max);
  const min = Number.isFinite(minRaw) ? Math.max(300, Math.floor(minRaw)) : DEFAULT_WORD_RANGE.min;
  const max = Number.isFinite(maxRaw) ? Math.max(min, Math.floor(maxRaw)) : DEFAULT_WORD_RANGE.max;
  return { min, max };
}

function normalizeOutlineConstraints(value: unknown): OutlineConstraintPolicy {
  const data = parseRecord(value);
  const maxH2Raw = Number(data.maxH2);
  const maxH3Raw = Number(data.maxH3PerH2);
  return {
    maxH2: Number.isFinite(maxH2Raw) ? Math.max(2, Math.floor(maxH2Raw)) : DEFAULT_OUTLINE_CONSTRAINTS.maxH2,
    maxH3PerH2: Number.isFinite(maxH3Raw)
      ? Math.max(1, Math.floor(maxH3Raw))
      : DEFAULT_OUTLINE_CONSTRAINTS.maxH3PerH2,
  };
}

function normalizeStyleGuard(value: unknown): StyleGuardPolicy {
  const data = parseRecord(value);
  const emDash = data.emDash === 'allow' ? 'allow' : 'forbid';
  const colon = data.colon === 'allow' || data.colon === 'forbid' ? data.colon : 'structural_only';
  const maxNarrativeColonsRaw = Number(data.maxNarrativeColons);
  return {
    emDash,
    colon,
    maxNarrativeColons: Number.isFinite(maxNarrativeColonsRaw)
      ? Math.max(0, Math.floor(maxNarrativeColonsRaw))
      : DEFAULT_STYLE_GUARD.maxNarrativeColons,
  };
}

function normalizeTemplateRow(row: Record<string, unknown>): ContentTemplateConfig {
  return {
    id: Number(row.id),
    key: String(row.key),
    name: String(row.name || row.key || 'Template'),
    description: row.description ? String(row.description) : null,
    contentFormats: parseArray<ContentFormat>(row.contentFormats).filter(Boolean),
    structure: {
      sections: parseArray<{ heading: string; level: 1 | 2 | 3; optional?: boolean }>(
        parseRecord(row.structure).sections
      ),
    },
    wordRange: normalizeWordRange(row.wordRange),
    outlineConstraints: normalizeOutlineConstraints(row.outlineConstraints),
    styleGuard: normalizeStyleGuard(row.styleGuard),
    isSystem: row.isSystem === true || Number(row.isSystem ?? 0) === 1,
    isActive: row.isActive === true || Number(row.isActive ?? 0) === 1,
    createdAt: row.createdAt ? String(row.createdAt) : new Date().toISOString(),
    updatedAt: row.updatedAt ? String(row.updatedAt) : new Date().toISOString(),
  };
}

function normalizeAssignmentRow(row: Record<string, unknown>): TemplateAssignment {
  return {
    id: Number(row.id),
    scope: row.scope === 'project' ? 'project' : 'global',
    scopeKey: String(row.scopeKey || 'global'),
    projectId: row.projectId == null ? null : Number(row.projectId),
    contentFormat: String(row.contentFormat) as ContentFormat,
    templateKey: String(row.templateKey),
    createdAt: row.createdAt ? String(row.createdAt) : new Date().toISOString(),
    updatedAt: row.updatedAt ? String(row.updatedAt) : new Date().toISOString(),
  };
}

export interface ResolvedTemplatePolicy {
  key: string;
  name: string;
  source: 'project' | 'global' | 'fallback';
  wordRange: WordRangePolicy;
  outlineConstraints: OutlineConstraintPolicy;
  styleGuard: StyleGuardPolicy;
}

export async function listContentTemplateConfigs(): Promise<ContentTemplateConfig[]> {
  await ensureDb();
  const rows = (await db
    .select({
      id: contentTemplates.id,
      key: contentTemplates.key,
      name: contentTemplates.name,
      description: contentTemplates.description,
      contentFormats: contentTemplates.contentFormats,
      structure: contentTemplates.structure,
      wordRange: contentTemplates.wordRange,
      outlineConstraints: contentTemplates.outlineConstraints,
      styleGuard: contentTemplates.styleGuard,
      isSystem: contentTemplates.isSystem,
      isActive: contentTemplates.isActive,
      createdAt: contentTemplates.createdAt,
      updatedAt: contentTemplates.updatedAt,
    })
    .from(contentTemplates)
    .orderBy(asc(contentTemplates.name))) as Array<Record<string, unknown>>;
  return rows.map(normalizeTemplateRow);
}

export async function upsertContentTemplateConfig(input: {
  key: string;
  name: string;
  description?: string | null;
  contentFormats: ContentFormat[];
  structure?: Record<string, unknown>;
  wordRange?: WordRangePolicy;
  outlineConstraints?: OutlineConstraintPolicy;
  styleGuard?: StyleGuardPolicy;
  isSystem?: boolean;
  isActive?: boolean;
}): Promise<ContentTemplateConfig> {
  await ensureDb();

  const key = input.key.trim();
  if (!key) {
    throw new Error('Template key is required.');
  }

  const [existing] = await db
    .select({ id: contentTemplates.id })
    .from(contentTemplates)
    .where(eq(contentTemplates.key, key))
    .limit(1);

  if (existing) {
    const [updated] = await db
      .update(contentTemplates)
      .set({
        name: input.name.trim() || key,
        description: input.description ?? null,
        contentFormats: input.contentFormats,
        structure: input.structure ?? { sections: [] },
        wordRange: input.wordRange ?? DEFAULT_WORD_RANGE,
        outlineConstraints: input.outlineConstraints ?? DEFAULT_OUTLINE_CONSTRAINTS,
        styleGuard: input.styleGuard ?? DEFAULT_STYLE_GUARD,
        isSystem: input.isSystem ?? false,
        isActive: input.isActive ?? true,
        updatedAt: dbNow(),
      })
      .where(eq(contentTemplates.id, existing.id))
      .returning();
    return normalizeTemplateRow(updated as unknown as Record<string, unknown>);
  }

  const [created] = await db
    .insert(contentTemplates)
    .values({
      key,
      name: input.name.trim() || key,
      description: input.description ?? null,
      contentFormats: input.contentFormats,
      structure: input.structure ?? { sections: [] },
      wordRange: input.wordRange ?? DEFAULT_WORD_RANGE,
      outlineConstraints: input.outlineConstraints ?? DEFAULT_OUTLINE_CONSTRAINTS,
      styleGuard: input.styleGuard ?? DEFAULT_STYLE_GUARD,
      isSystem: input.isSystem ?? false,
      isActive: input.isActive ?? true,
    })
    .returning();
  return normalizeTemplateRow(created as unknown as Record<string, unknown>);
}

export async function listTemplateAssignments(projectId?: number | null): Promise<TemplateAssignment[]> {
  await ensureDb();
  const predicates = [eq(contentTemplateAssignments.scope, 'global')];
  if (projectId) {
    predicates.push(eq(contentTemplateAssignments.projectId, projectId));
  }

  const rows = (await db
    .select({
      id: contentTemplateAssignments.id,
      scope: contentTemplateAssignments.scope,
      scopeKey: contentTemplateAssignments.scopeKey,
      projectId: contentTemplateAssignments.projectId,
      contentFormat: contentTemplateAssignments.contentFormat,
      templateKey: contentTemplateAssignments.templateKey,
      createdAt: contentTemplateAssignments.createdAt,
      updatedAt: contentTemplateAssignments.updatedAt,
    })
    .from(contentTemplateAssignments)
    .where(or(...predicates))
    .orderBy(asc(contentTemplateAssignments.contentFormat))) as Array<Record<string, unknown>>;

  return rows.map(normalizeAssignmentRow);
}

export async function upsertTemplateAssignment(input: {
  projectId?: number | null;
  contentFormat: ContentFormat;
  templateKey: string;
}): Promise<TemplateAssignment> {
  await ensureDb();
  const scope = input.projectId ? 'project' : 'global';
  const scopeKey = input.projectId ? `project:${input.projectId}` : 'global';
  const templateKey = input.templateKey.trim();

  const [existingTemplate] = await db
    .select({ key: contentTemplates.key })
    .from(contentTemplates)
    .where(eq(contentTemplates.key, templateKey))
    .limit(1);
  if (!existingTemplate) {
    throw new Error('Template key not found.');
  }

  const [existing] = await db
    .select({ id: contentTemplateAssignments.id })
    .from(contentTemplateAssignments)
    .where(
      and(
        eq(contentTemplateAssignments.scopeKey, scopeKey),
        eq(contentTemplateAssignments.contentFormat, input.contentFormat)
      )
    )
    .limit(1);

  if (existing) {
    const [updated] = await db
      .update(contentTemplateAssignments)
      .set({
        scope,
        scopeKey,
        projectId: input.projectId ?? null,
        templateKey,
        updatedAt: dbNow(),
      })
      .where(eq(contentTemplateAssignments.id, existing.id))
      .returning();
    return normalizeAssignmentRow(updated as unknown as Record<string, unknown>);
  }

  const [created] = await db
    .insert(contentTemplateAssignments)
    .values({
      scope,
      scopeKey,
      projectId: input.projectId ?? null,
      contentFormat: input.contentFormat,
      templateKey,
    })
    .returning();

  return normalizeAssignmentRow(created as unknown as Record<string, unknown>);
}

export async function resolveTemplatePolicy(input: {
  projectId?: number | null;
  contentFormat: ContentFormat;
}): Promise<ResolvedTemplatePolicy> {
  await ensureDb();
  const scopeKeys = input.projectId ? [`project:${input.projectId}`, 'global'] : ['global'];

  const assignments = (await db
    .select({
      scope: contentTemplateAssignments.scope,
      scopeKey: contentTemplateAssignments.scopeKey,
      contentFormat: contentTemplateAssignments.contentFormat,
      templateKey: contentTemplateAssignments.templateKey,
    })
    .from(contentTemplateAssignments)
    .where(
      and(
        inArray(contentTemplateAssignments.scopeKey, scopeKeys),
        eq(contentTemplateAssignments.contentFormat, input.contentFormat)
      )
    )) as Array<{
    scope: string;
    scopeKey: string;
    contentFormat: string;
    templateKey: string;
  }>;

  const prioritizedAssignment =
    assignments.find((item) => item.scope === 'project') ??
    assignments.find((item) => item.scope === 'global') ??
    null;

  const fallbackTemplateKey = FALLBACK_TEMPLATE_BY_FORMAT[input.contentFormat];
  const resolvedKey = prioritizedAssignment?.templateKey || fallbackTemplateKey;

  const [template] = await db
    .select({
      key: contentTemplates.key,
      name: contentTemplates.name,
      wordRange: contentTemplates.wordRange,
      outlineConstraints: contentTemplates.outlineConstraints,
      styleGuard: contentTemplates.styleGuard,
    })
    .from(contentTemplates)
    .where(eq(contentTemplates.key, resolvedKey))
    .limit(1);

  if (!template) {
    return {
      key: resolvedKey,
      name: resolvedKey,
      source: 'fallback',
      wordRange: DEFAULT_WORD_RANGE,
      outlineConstraints: DEFAULT_OUTLINE_CONSTRAINTS,
      styleGuard: DEFAULT_STYLE_GUARD,
    };
  }

  return {
    key: template.key,
    name: template.name,
    source: prioritizedAssignment?.scope === 'project' ? 'project' : prioritizedAssignment ? 'global' : 'fallback',
    wordRange: normalizeWordRange(template.wordRange),
    outlineConstraints: normalizeOutlineConstraints(template.outlineConstraints),
    styleGuard: normalizeStyleGuard(template.styleGuard),
  };
}
