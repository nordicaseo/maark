import { and, eq } from 'drizzle-orm';
import { api } from '../../../convex/_generated/api';
import { db, ensureDb } from '@/db';
import { dbNow } from '@/db/utils';
import {
  agentSharedProfiles,
  projectAgentLaneProfiles,
  projectAgentProfiles,
} from '@/db/schema';
import { getConvexClient } from '@/lib/convex/server';
import {
  resolveProfileIdentityForCreate,
  resolveProfileIdentityForUpdate,
} from '@/lib/agents/profile-identity-merge';
import type {
  AgentKnowledgePart,
  AgentKnowledgePartType,
  AgentRole,
  HeartbeatRunResult,
  ProjectAgentFileBundle,
  ProjectAgentHeartbeatMeta,
  ProjectAgentLaneProfile,
  ProjectAgentModelOverrides,
  ProjectAgentProfile,
  SharedAgentProfileKey,
  UpsertProjectAgentLaneProfileInput,
  UpsertProjectAgentProfileInput,
} from '@/types/agent-profile';
import {
  AGENT_FILE_KEYS,
  AGENT_KNOWLEDGE_PART_TYPES,
  FIXED_AGENT_ROLES,
  SHARED_AGENT_PROFILE_KEYS,
} from '@/types/agent-profile';
import { AGENT_WRITER_LANES, type AgentLaneKey } from '@/types/agent-runtime';

export interface RolePromptContext {
  role: AgentRole;
  laneKey?: AgentLaneKey;
  profile: ProjectAgentProfile | ProjectAgentLaneProfile;
  promptContext: string;
  roleSkillIds: number[];
  sharedUserProfile: string;
}

const WRITER_LANE_PROFILE_DEFAULTS: Record<
  AgentLaneKey,
  { displayName: string; missionSuffix: string; shortDescription: string; emoji: string }
> = {
  blog: {
    displayName: 'Atlas Blog',
    missionSuffix: 'Focus on editorial blog quality, search intent depth, and narrative flow.',
    shortDescription: 'Blog lane writer',
    emoji: '✍️',
  },
  collection: {
    displayName: 'Atlas Collection',
    missionSuffix:
      'Specialize in collection/category pages with category intent coverage and merchandising clarity.',
    shortDescription: 'Collection lane writer',
    emoji: '🗂️',
  },
  product: {
    displayName: 'Atlas Product',
    missionSuffix:
      'Specialize in product page copy with feature-to-benefit clarity and conversion intent.',
    shortDescription: 'Product lane writer',
    emoji: '📦',
  },
  landing: {
    displayName: 'Atlas Landing',
    missionSuffix:
      'Specialize in landing/home/FAQ style pages with concise value props and CTA structure.',
    shortDescription: 'Landing lane writer',
    emoji: '🎯',
  },
};

const WRITER_LANE_NAME_SUFFIX: Record<AgentLaneKey, string> = {
  blog: 'Blog',
  collection: 'Collection',
  product: 'Product',
  landing: 'Landing',
};

const ROLE_DEFAULTS: Record<
  AgentRole,
  { displayName: string; emoji: string; mission: string; shortDescription: string }
> = {
  researcher: {
    displayName: 'Sage',
    emoji: '🧠',
    shortDescription: 'Research specialist',
    mission:
      'Produce accurate research briefs with sources, facts, and data that the team can trust.',
  },
  outliner: {
    displayName: 'Maple',
    emoji: '🧭',
    shortDescription: 'Outline architect',
    mission:
      'Turn research into complete, sequenced outlines that writers can execute without gaps.',
  },
  writer: {
    displayName: 'Atlas',
    emoji: '✍️',
    shortDescription: 'Content writer',
    mission:
      'Write complete, publication-ready content that follows outline, brand, and SEO requirements.',
  },
  editor: {
    displayName: 'Quill',
    emoji: '🧾',
    shortDescription: 'Editorial finisher',
    mission:
      'Edit drafted content for clarity, flow, factual consistency, and readiness for SEO review.',
  },
  'seo-reviewer': {
    displayName: 'Orion',
    emoji: '🔎',
    shortDescription: 'SEO reviewer',
    mission:
      'Review drafts for SEO coverage, on-page quality, and launch-readiness before completion.',
  },
  'project-manager': {
    displayName: 'Maark',
    emoji: '🧩',
    shortDescription: 'System orchestrator',
    mission:
      'Coordinate handoffs, unblock stages, and keep topic workflows moving with clear accountability.',
  },
  seo: {
    displayName: 'Helix',
    emoji: '📈',
    shortDescription: 'SEO strategist',
    mission:
      'Provide strategy-level SEO guidance for keyword alignment, SERP intent, and content quality.',
  },
  content: {
    displayName: 'Lumen',
    emoji: '📝',
    shortDescription: 'Editorial support',
    mission:
      'Support content quality, narrative clarity, and editorial consistency across deliverables.',
  },
  lead: {
    displayName: 'Astra',
    emoji: '🛡️',
    shortDescription: 'Escalation lead',
    mission:
      'Act as escalation owner for quality gates, decision-making, and workflow continuity.',
  },
};

const ROLE_ORDER = new Map(FIXED_AGENT_ROLES.map((role, idx) => [role, idx]));

const ROLE_STAGE_FOCUS: Record<AgentRole, string[]> = {
  researcher: ['research'],
  outliner: ['outline_build'],
  writer: ['writing'],
  editor: ['editing'],
  'seo-reviewer': ['seo_intel_review', 'final_review'],
  'project-manager': ['prewrite_context', 'human_review'],
  seo: ['research', 'seo_intel_review', 'final_review'],
  content: ['outline_build', 'writing', 'editing'],
  lead: [
    'research',
    'seo_intel_review',
    'outline_build',
    'writing',
    'editing',
    'final_review',
    'human_review',
  ],
};

const MAX_MEMORY_CHARS = 16000;
const MAX_WORKING_CHARS = 3000;
const PROMPT_CONTEXT_MAX_CHARS = 14000;

function normalizeRole(value: unknown): AgentRole | null {
  if (typeof value !== 'string') return null;
  return FIXED_AGENT_ROLES.find((role) => role === value) ?? null;
}

function normalizeLaneKey(value: unknown): AgentLaneKey | null {
  if (typeof value !== 'string') return null;
  return AGENT_WRITER_LANES.find((lane) => lane === value) ?? null;
}

function toIsoDate(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  const str = String(value ?? '').trim();
  if (!str) return new Date().toISOString();
  const parsed = new Date(str);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  if (typeof value === 'object') {
    return value as T;
  }
  return fallback;
}

function normalizeSkillIds(value: unknown): number[] {
  const parsed = parseJson<unknown[]>(value, []);
  if (!Array.isArray(parsed)) return [];
  const unique = new Set<number>();
  for (const item of parsed) {
    const n = Number(item);
    if (Number.isFinite(n) && n > 0) unique.add(Math.trunc(n));
  }
  return Array.from(unique);
}

function normalizeKnowledgeParts(value: unknown): AgentKnowledgePart[] {
  const parsed = parseJson<unknown[]>(value, []);
  if (!Array.isArray(parsed)) return [];
  const parts: AgentKnowledgePart[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const partTypeRaw = String(row.partType || '').trim();
    const partType = AGENT_KNOWLEDGE_PART_TYPES.includes(partTypeRaw as AgentKnowledgePartType)
      ? (partTypeRaw as AgentKnowledgePartType)
      : 'custom';
    const label = String(row.label || '').trim() || partType.replace(/_/g, ' ');
    const content = String(row.content || '').trim();
    if (!content) continue;
    const sortOrder = Number.isFinite(Number(row.sortOrder))
      ? Math.max(0, Math.trunc(Number(row.sortOrder)))
      : parts.length;
    const id = String(row.id || `${partType}:${sortOrder}`).trim();
    parts.push({ id, partType, label, content, sortOrder });
  }
  return parts.sort((a, b) => a.sortOrder - b.sortOrder);
}

function normalizeModelOverrides(value: unknown): ProjectAgentModelOverrides {
  const parsed = parseJson<Record<string, unknown>>(value, {});
  if (!parsed || typeof parsed !== 'object') return {};
  const out: ProjectAgentModelOverrides = {};
  for (const [key, raw] of Object.entries(parsed)) {
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

function normalizeHeartbeatMeta(value: unknown): ProjectAgentHeartbeatMeta {
  const parsed = parseJson<Record<string, unknown>>(value, {});
  const suggestedActions = Array.isArray(parsed.suggestedActions)
    ? parsed.suggestedActions.map((item) => String(item ?? '').trim()).filter(Boolean).slice(0, 8)
    : [];
  return {
    ...(parsed.lastRunAt ? { lastRunAt: String(parsed.lastRunAt) } : {}),
    ...(parsed.lastSummary ? { lastSummary: String(parsed.lastSummary) } : {}),
    ...(suggestedActions.length > 0 ? { suggestedActions } : {}),
    ...(parsed.lastMemoryUpdateAt ? { lastMemoryUpdateAt: String(parsed.lastMemoryUpdateAt) } : {}),
    ...(parsed.lastWorkingUpdateAt ? { lastWorkingUpdateAt: String(parsed.lastWorkingUpdateAt) } : {}),
  };
}

function buildDefaultFileBundle(
  role: AgentRole,
  displayName: string,
  emoji: string,
  mission: string
): ProjectAgentFileBundle {
  const identity = `# IDENTITY\nName: ${displayName}\nRole: ${role}\nEmoji: ${emoji}\nMission: ${mission}`;
  const soul = `# SOUL\nYou are ${displayName}. Prioritize quality, clarity, and project scope discipline for ${role} responsibilities.`;
  const heartbeat = `# HEARTBEAT\nRun a manual heartbeat when requested.\n1) Review open/blocked tasks.\n2) Summarize risks.\n3) Suggest next actions.`;
  const agents = `# AGENTS\nFollow Topic Workflow v1 handoffs.\nRespect stage ownership and approvals.\nLog important decisions in MEMORY.`;
  const tools = `# TOOLS\nUse Maark project context, workflow events, and project agent knowledge before producing output.`;
  const memory = '# MEMORY\n- Initialized profile.';
  const working = '# WORKING\nNo active assignment.';
  const bootstrap =
    '# BOOTSTRAP\nReview IDENTITY, SOUL, HEARTBEAT, AGENTS, TOOLS, and USER context before first task.';

  return {
    SOUL: soul,
    IDENTITY: identity,
    HEARTBEAT: heartbeat,
    AGENTS: agents,
    TOOLS: tools,
    MEMORY: memory,
    WORKING: working,
    BOOTSTRAP: bootstrap,
  };
}

function normalizeFileBundle(
  role: AgentRole,
  displayName: string,
  emoji: string,
  mission: string,
  input: unknown
): ProjectAgentFileBundle {
  const defaults = buildDefaultFileBundle(role, displayName, emoji, mission);
  const parsed = parseJson<Record<string, unknown>>(input, {});
  const bundle: Partial<ProjectAgentFileBundle> = {};
  for (const key of AGENT_FILE_KEYS) {
    const value = parsed?.[key];
    bundle[key] = typeof value === 'string' && value.trim().length > 0 ? value : defaults[key];
  }
  return bundle as ProjectAgentFileBundle;
}

function trimTo(input: string, maxChars: number): string {
  if (input.length <= maxChars) return input;
  return `${input.slice(0, maxChars).trimEnd()}\n\n...`;
}

function roleDisplay(role: AgentRole) {
  return ROLE_DEFAULTS[role];
}

function mapProfileRow(row: Record<string, unknown>): ProjectAgentProfile {
  const role = normalizeRole(row.role) || 'writer';
  const defaults = roleDisplay(role);
  const displayName =
    typeof row.displayName === 'string' && row.displayName.trim()
      ? row.displayName
      : defaults.displayName;
  const emoji =
    typeof row.emoji === 'string' && row.emoji.trim() ? row.emoji : defaults.emoji;
  const mission =
    typeof row.mission === 'string' && row.mission.trim()
      ? row.mission
      : defaults.mission;
  const shortDescription =
    typeof row.shortDescription === 'string' && row.shortDescription.trim()
      ? row.shortDescription.trim()
      : defaults.shortDescription;
  const avatarUrl =
    typeof row.avatarUrl === 'string' && row.avatarUrl.trim()
      ? row.avatarUrl.trim()
      : null;

  return {
    id: Number(row.id),
    projectId: Number(row.projectId),
    role,
    displayName,
    emoji: emoji || null,
    avatarUrl,
    shortDescription: shortDescription || null,
    mission: mission || null,
    isEnabled:
      typeof row.isEnabled === 'boolean'
        ? row.isEnabled
        : Number(row.isEnabled ?? 1) === 1,
    fileBundle: normalizeFileBundle(role, displayName, emoji, mission, row.fileBundle),
    knowledgeParts: normalizeKnowledgeParts(row.knowledgeParts),
    skillIds: normalizeSkillIds(row.skillIds),
    modelOverrides: normalizeModelOverrides(row.modelOverrides),
    heartbeatMeta: normalizeHeartbeatMeta(row.heartbeatMeta),
    createdById: (row.createdById as string | null) ?? null,
    updatedById: (row.updatedById as string | null) ?? null,
    createdAt: toIsoDate(row.createdAt),
    updatedAt: toIsoDate(row.updatedAt),
  };
}

function laneProfileDefaults(role: AgentRole, laneKey: AgentLaneKey) {
  const roleDefaults = roleDisplay(role);
  if (role !== 'writer') return roleDefaults;
  const laneDefaults = WRITER_LANE_PROFILE_DEFAULTS[laneKey];
  return {
    displayName: laneDefaults.displayName,
    emoji: laneDefaults.emoji,
    shortDescription: laneDefaults.shortDescription,
    mission: `${roleDefaults.mission} ${laneDefaults.missionSuffix}`.trim(),
  };
}

function isDefaultWriterLaneDisplayName(laneKey: AgentLaneKey, displayName: string): boolean {
  return (
    displayName.trim().toLowerCase() ===
    WRITER_LANE_PROFILE_DEFAULTS[laneKey].displayName.trim().toLowerCase()
  );
}

function deriveWriterLaneDisplayName(writerDisplayName: string, laneKey: AgentLaneKey): string {
  const base = writerDisplayName.trim() || ROLE_DEFAULTS.writer.displayName;
  const suffix = WRITER_LANE_NAME_SUFFIX[laneKey];
  const suffixNeedle = ` ${suffix}`.toLowerCase();
  if (base.toLowerCase().endsWith(suffixNeedle)) return base;
  return `${base} ${suffix}`;
}

function mapLaneProfileRow(row: Record<string, unknown>): ProjectAgentLaneProfile {
  const role = normalizeRole(row.role) || 'writer';
  const laneKey = normalizeLaneKey(row.laneKey) || 'blog';
  const defaults = laneProfileDefaults(role, laneKey);
  const displayName =
    typeof row.displayName === 'string' && row.displayName.trim()
      ? row.displayName
      : defaults.displayName;
  const emoji =
    typeof row.emoji === 'string' && row.emoji.trim() ? row.emoji : defaults.emoji;
  const mission =
    typeof row.mission === 'string' && row.mission.trim()
      ? row.mission
      : defaults.mission;
  const shortDescription =
    typeof row.shortDescription === 'string' && row.shortDescription.trim()
      ? row.shortDescription.trim()
      : defaults.shortDescription;
  const avatarUrl =
    typeof row.avatarUrl === 'string' && row.avatarUrl.trim()
      ? row.avatarUrl.trim()
      : null;

  return {
    id: Number(row.id),
    projectId: Number(row.projectId),
    role,
    laneKey,
    displayName,
    emoji: emoji || null,
    avatarUrl,
    shortDescription: shortDescription || null,
    mission: mission || null,
    isEnabled:
      typeof row.isEnabled === 'boolean'
        ? row.isEnabled
        : Number(row.isEnabled ?? 1) === 1,
    fileBundle: normalizeFileBundle(role, displayName, emoji, mission, row.fileBundle),
    knowledgeParts: normalizeKnowledgeParts(row.knowledgeParts),
    skillIds: normalizeSkillIds(row.skillIds),
    modelOverrides: normalizeModelOverrides(row.modelOverrides),
    heartbeatMeta: normalizeHeartbeatMeta(row.heartbeatMeta),
    createdById: (row.createdById as string | null) ?? null,
    updatedById: (row.updatedById as string | null) ?? null,
    createdAt: toIsoDate(row.createdAt),
    updatedAt: toIsoDate(row.updatedAt),
  };
}

function sortProfilesByRoleOrder(profiles: ProjectAgentProfile[]) {
  return [...profiles].sort((a, b) => {
    const ai = ROLE_ORDER.get(a.role) ?? 999;
    const bi = ROLE_ORDER.get(b.role) ?? 999;
    return ai - bi;
  });
}

async function getProjectProfileRow(projectId: number, role: AgentRole) {
  const [row] = await db
    .select({
      id: projectAgentProfiles.id,
      projectId: projectAgentProfiles.projectId,
      role: projectAgentProfiles.role,
      displayName: projectAgentProfiles.displayName,
      emoji: projectAgentProfiles.emoji,
      avatarUrl: projectAgentProfiles.avatarUrl,
      shortDescription: projectAgentProfiles.shortDescription,
      mission: projectAgentProfiles.mission,
      isEnabled: projectAgentProfiles.isEnabled,
      fileBundle: projectAgentProfiles.fileBundle,
      knowledgeParts: projectAgentProfiles.knowledgeParts,
      skillIds: projectAgentProfiles.skillIds,
      modelOverrides: projectAgentProfiles.modelOverrides,
      heartbeatMeta: projectAgentProfiles.heartbeatMeta,
      createdById: projectAgentProfiles.createdById,
      updatedById: projectAgentProfiles.updatedById,
      createdAt: projectAgentProfiles.createdAt,
      updatedAt: projectAgentProfiles.updatedAt,
    })
    .from(projectAgentProfiles)
    .where(
      and(
        eq(projectAgentProfiles.projectId, projectId),
        eq(projectAgentProfiles.role, role)
      )
    )
    .limit(1);
  return row as Record<string, unknown> | undefined;
}

async function getProjectLaneProfileRow(projectId: number, role: AgentRole, laneKey: AgentLaneKey) {
  const [row] = await db
    .select({
      id: projectAgentLaneProfiles.id,
      projectId: projectAgentLaneProfiles.projectId,
      role: projectAgentLaneProfiles.role,
      laneKey: projectAgentLaneProfiles.laneKey,
      displayName: projectAgentLaneProfiles.displayName,
      emoji: projectAgentLaneProfiles.emoji,
      avatarUrl: projectAgentLaneProfiles.avatarUrl,
      shortDescription: projectAgentLaneProfiles.shortDescription,
      mission: projectAgentLaneProfiles.mission,
      isEnabled: projectAgentLaneProfiles.isEnabled,
      fileBundle: projectAgentLaneProfiles.fileBundle,
      knowledgeParts: projectAgentLaneProfiles.knowledgeParts,
      skillIds: projectAgentLaneProfiles.skillIds,
      modelOverrides: projectAgentLaneProfiles.modelOverrides,
      heartbeatMeta: projectAgentLaneProfiles.heartbeatMeta,
      createdById: projectAgentLaneProfiles.createdById,
      updatedById: projectAgentLaneProfiles.updatedById,
      createdAt: projectAgentLaneProfiles.createdAt,
      updatedAt: projectAgentLaneProfiles.updatedAt,
    })
    .from(projectAgentLaneProfiles)
    .where(
      and(
        eq(projectAgentLaneProfiles.projectId, projectId),
        eq(projectAgentLaneProfiles.role, role),
        eq(projectAgentLaneProfiles.laneKey, laneKey)
      )
    )
    .limit(1);
  return row as Record<string, unknown> | undefined;
}

export async function seedProjectAgentProfiles(
  projectId: number,
  userId?: string | null
): Promise<{ seededRoles: AgentRole[]; profiles: ProjectAgentProfile[] }> {
  await ensureDb();

  const existingRows = (await db
    .select({
      role: projectAgentProfiles.role,
    })
    .from(projectAgentProfiles)
    .where(eq(projectAgentProfiles.projectId, projectId))) as Array<{ role: string }>;

  const existingRoles = new Set(
    existingRows
      .map((row) => normalizeRole(row.role))
      .filter((role): role is AgentRole => Boolean(role))
  );

  const seededRoles: AgentRole[] = [];
  for (const role of FIXED_AGENT_ROLES) {
    if (existingRoles.has(role)) continue;
    const defaults = roleDisplay(role);
    await db.insert(projectAgentProfiles).values({
      projectId,
      role,
      displayName: defaults.displayName,
      emoji: defaults.emoji,
      shortDescription: defaults.shortDescription,
      mission: defaults.mission,
      isEnabled: true,
      fileBundle: buildDefaultFileBundle(
        role,
        defaults.displayName,
        defaults.emoji,
        defaults.mission
      ),
      knowledgeParts: [],
      skillIds: [],
      modelOverrides: {},
      heartbeatMeta: {},
      createdById: userId ?? null,
      updatedById: userId ?? null,
      createdAt: dbNow(),
      updatedAt: dbNow(),
    });
    seededRoles.push(role);
  }

  const profiles = await listProjectAgentProfiles(projectId);
  return { seededRoles, profiles };
}

export async function seedProjectAgentLaneProfiles(
  projectId: number,
  userId?: string | null
): Promise<{ seededLaneProfiles: Array<{ role: AgentRole; laneKey: AgentLaneKey }>; profiles: ProjectAgentLaneProfile[] }> {
  await ensureDb();
  await seedProjectAgentProfiles(projectId, userId ?? null);

  const existingRows = (await db
    .select({
      role: projectAgentLaneProfiles.role,
      laneKey: projectAgentLaneProfiles.laneKey,
    })
    .from(projectAgentLaneProfiles)
    .where(eq(projectAgentLaneProfiles.projectId, projectId))) as Array<{
    role: string;
    laneKey: string;
  }>;

  const existing = new Set(
    existingRows
      .map((row) => {
        const role = normalizeRole(row.role);
        const laneKey = normalizeLaneKey(row.laneKey);
        if (!role || !laneKey) return null;
        return `${role}:${laneKey}`;
      })
      .filter((value): value is string => Boolean(value))
  );

  const seededLaneProfiles: Array<{ role: AgentRole; laneKey: AgentLaneKey }> = [];
  for (const laneKey of AGENT_WRITER_LANES) {
    const role: AgentRole = 'writer';
    const key = `${role}:${laneKey}`;
    if (existing.has(key)) continue;
    const defaults = laneProfileDefaults(role, laneKey);
    await db.insert(projectAgentLaneProfiles).values({
      projectId,
      role,
      laneKey,
      displayName: defaults.displayName,
      emoji: defaults.emoji,
      shortDescription: defaults.shortDescription,
      mission: defaults.mission,
      isEnabled: true,
      fileBundle: buildDefaultFileBundle(role, defaults.displayName, defaults.emoji, defaults.mission),
      knowledgeParts: [],
      skillIds: [],
      modelOverrides: {},
      heartbeatMeta: {},
      createdById: userId ?? null,
      updatedById: userId ?? null,
      createdAt: dbNow(),
      updatedAt: dbNow(),
    });
    seededLaneProfiles.push({ role, laneKey });
  }

  const profiles = await listProjectAgentLaneProfiles(projectId, 'writer');
  return { seededLaneProfiles, profiles };
}

export async function listProjectAgentProfiles(
  projectId: number
): Promise<ProjectAgentProfile[]> {
  await ensureDb();
  const rows = (await db
    .select({
      id: projectAgentProfiles.id,
      projectId: projectAgentProfiles.projectId,
      role: projectAgentProfiles.role,
      displayName: projectAgentProfiles.displayName,
      emoji: projectAgentProfiles.emoji,
      avatarUrl: projectAgentProfiles.avatarUrl,
      shortDescription: projectAgentProfiles.shortDescription,
      mission: projectAgentProfiles.mission,
      isEnabled: projectAgentProfiles.isEnabled,
      fileBundle: projectAgentProfiles.fileBundle,
      knowledgeParts: projectAgentProfiles.knowledgeParts,
      skillIds: projectAgentProfiles.skillIds,
      modelOverrides: projectAgentProfiles.modelOverrides,
      heartbeatMeta: projectAgentProfiles.heartbeatMeta,
      createdById: projectAgentProfiles.createdById,
      updatedById: projectAgentProfiles.updatedById,
      createdAt: projectAgentProfiles.createdAt,
      updatedAt: projectAgentProfiles.updatedAt,
    })
    .from(projectAgentProfiles)
    .where(eq(projectAgentProfiles.projectId, projectId))) as Array<Record<string, unknown>>;

  return sortProfilesByRoleOrder(rows.map(mapProfileRow));
}

export async function listProjectAgentLaneProfiles(
  projectId: number,
  role: AgentRole = 'writer'
): Promise<ProjectAgentLaneProfile[]> {
  await ensureDb();
  const rows = (await db
    .select({
      id: projectAgentLaneProfiles.id,
      projectId: projectAgentLaneProfiles.projectId,
      role: projectAgentLaneProfiles.role,
      laneKey: projectAgentLaneProfiles.laneKey,
      displayName: projectAgentLaneProfiles.displayName,
      emoji: projectAgentLaneProfiles.emoji,
      avatarUrl: projectAgentLaneProfiles.avatarUrl,
      shortDescription: projectAgentLaneProfiles.shortDescription,
      mission: projectAgentLaneProfiles.mission,
      isEnabled: projectAgentLaneProfiles.isEnabled,
      fileBundle: projectAgentLaneProfiles.fileBundle,
      knowledgeParts: projectAgentLaneProfiles.knowledgeParts,
      skillIds: projectAgentLaneProfiles.skillIds,
      modelOverrides: projectAgentLaneProfiles.modelOverrides,
      heartbeatMeta: projectAgentLaneProfiles.heartbeatMeta,
      createdById: projectAgentLaneProfiles.createdById,
      updatedById: projectAgentLaneProfiles.updatedById,
      createdAt: projectAgentLaneProfiles.createdAt,
      updatedAt: projectAgentLaneProfiles.updatedAt,
    })
    .from(projectAgentLaneProfiles)
    .where(
      and(
        eq(projectAgentLaneProfiles.projectId, projectId),
        eq(projectAgentLaneProfiles.role, role)
      )
    )) as Array<Record<string, unknown>>;

  return rows
    .map(mapLaneProfileRow)
    .sort((a, b) => AGENT_WRITER_LANES.indexOf(a.laneKey) - AGENT_WRITER_LANES.indexOf(b.laneKey));
}

export async function synchronizeWriterLaneProfileNames(args: {
  projectId: number;
  userId?: string | null;
  force?: boolean;
}): Promise<{
  renamed: number;
  names: Record<AgentLaneKey, string>;
}> {
  await ensureDb();
  await seedProjectAgentProfiles(args.projectId, args.userId ?? null);
  await seedProjectAgentLaneProfiles(args.projectId, args.userId ?? null);

  const writerProfile = await getProjectAgentProfile(args.projectId, 'writer');
  const writerName = writerProfile?.displayName?.trim() || ROLE_DEFAULTS.writer.displayName;
  const laneProfiles = await listProjectAgentLaneProfiles(args.projectId, 'writer');
  let renamed = 0;

  for (const laneProfile of laneProfiles) {
    const existingName = laneProfile.displayName.trim();
    const shouldRename =
      args.force === true || isDefaultWriterLaneDisplayName(laneProfile.laneKey, existingName);
    if (!shouldRename) continue;

    const desiredName = deriveWriterLaneDisplayName(writerName, laneProfile.laneKey).trim();
    if (!desiredName || desiredName === existingName) continue;

    await upsertProjectAgentLaneProfile({
      projectId: args.projectId,
      role: 'writer',
      laneKey: laneProfile.laneKey,
      displayName: desiredName,
      userId: args.userId ?? null,
    });
    renamed += 1;
  }

  const refreshed = await listProjectAgentLaneProfiles(args.projectId, 'writer');
  const byLane = new Map<AgentLaneKey, string>(
    refreshed.map((profile) => [profile.laneKey, profile.displayName.trim()] as const)
  );
  const names = Object.fromEntries(
    AGENT_WRITER_LANES.map((laneKey) => [
      laneKey,
      byLane.get(laneKey) || deriveWriterLaneDisplayName(writerName, laneKey),
    ])
  ) as Record<AgentLaneKey, string>;

  return { renamed, names };
}

export async function getProjectAgentProfile(
  projectId: number,
  role: AgentRole
): Promise<ProjectAgentProfile | null> {
  await ensureDb();
  const row = await getProjectProfileRow(projectId, role);
  return row ? mapProfileRow(row) : null;
}

export async function getProjectAgentLaneProfile(
  projectId: number,
  role: AgentRole,
  laneKey: AgentLaneKey
): Promise<ProjectAgentLaneProfile | null> {
  await ensureDb();
  const row = await getProjectLaneProfileRow(projectId, role, laneKey);
  return row ? mapLaneProfileRow(row) : null;
}

export async function upsertProjectAgentProfile(
  input: UpsertProjectAgentProfileInput
): Promise<ProjectAgentProfile> {
  await ensureDb();

  const existingRow = await getProjectProfileRow(input.projectId, input.role);
  const defaults = roleDisplay(input.role);
  const avatarUrlInput =
    typeof input.avatarUrl === 'string' ? input.avatarUrl.trim() : undefined;
  const shortDescriptionInput =
    typeof input.shortDescription === 'string' ? input.shortDescription.trim() : undefined;
  const createIdentity = resolveProfileIdentityForCreate({
    input: {
      displayName: input.displayName,
      emoji: input.emoji,
      mission: input.mission,
    },
    defaults,
  });
  const displayName = createIdentity.displayName;
  const emoji = createIdentity.emoji;
  const mission = createIdentity.mission;
  const createAvatarUrl = avatarUrlInput !== undefined ? avatarUrlInput || null : null;
  const createShortDescription =
    shortDescriptionInput !== undefined
      ? shortDescriptionInput || defaults.shortDescription
      : defaults.shortDescription;

  if (!existingRow) {
    await db.insert(projectAgentProfiles).values({
      projectId: input.projectId,
      role: input.role,
      displayName,
      emoji,
      avatarUrl: createAvatarUrl,
      shortDescription: createShortDescription,
      mission,
      isEnabled: input.isEnabled !== false,
      fileBundle: normalizeFileBundle(
        input.role,
        displayName,
        emoji,
        mission,
        input.fileBundle || {}
      ),
      knowledgeParts: input.knowledgeParts || [],
      skillIds: input.skillIds || [],
      modelOverrides: input.modelOverrides || {},
      heartbeatMeta: input.heartbeatMeta || {},
      createdById: input.userId ?? null,
      updatedById: input.userId ?? null,
      createdAt: dbNow(),
      updatedAt: dbNow(),
    });

    const created = await getProjectAgentProfile(input.projectId, input.role);
    if (!created) {
      throw new Error('Failed to create project agent profile');
    }
    return created;
  }

  const existing = mapProfileRow(existingRow);
  const mergedIdentity = resolveProfileIdentityForUpdate({
    input: {
      displayName: input.displayName,
      emoji: input.emoji,
      mission: input.mission,
    },
    existing: {
      displayName: existing.displayName,
      emoji: existing.emoji,
      mission: existing.mission,
    },
    defaults,
  });
  const avatarUrl =
    avatarUrlInput !== undefined
      ? avatarUrlInput || null
      : existing.avatarUrl || null;
  const shortDescription =
    shortDescriptionInput !== undefined
      ? shortDescriptionInput || defaults.shortDescription
      : existing.shortDescription || defaults.shortDescription;
  const mergedFileBundle = {
    ...existing.fileBundle,
    ...(input.fileBundle || {}),
  };
  const mergedKnowledgeParts =
    input.knowledgeParts !== undefined ? normalizeKnowledgeParts(input.knowledgeParts) : existing.knowledgeParts;
  const mergedSkillIds =
    input.skillIds !== undefined ? Array.from(new Set(input.skillIds)) : existing.skillIds;
  const mergedModelOverrides = input.modelOverrides ?? existing.modelOverrides;
  const mergedHeartbeatMeta = input.heartbeatMeta
    ? { ...existing.heartbeatMeta, ...input.heartbeatMeta }
    : existing.heartbeatMeta;

  await db
    .update(projectAgentProfiles)
    .set({
      displayName: mergedIdentity.displayName,
      emoji: mergedIdentity.emoji,
      avatarUrl,
      shortDescription,
      mission: mergedIdentity.mission,
      isEnabled:
        input.isEnabled !== undefined
          ? input.isEnabled
          : existing.isEnabled,
      fileBundle: mergedFileBundle,
      knowledgeParts: mergedKnowledgeParts,
      skillIds: mergedSkillIds,
      modelOverrides: mergedModelOverrides,
      heartbeatMeta: mergedHeartbeatMeta,
      updatedById: input.userId ?? null,
      updatedAt: dbNow(),
    })
    .where(eq(projectAgentProfiles.id, existing.id));

  const updated = await getProjectAgentProfile(input.projectId, input.role);
  if (!updated) {
    throw new Error('Failed to update project agent profile');
  }
  return updated;
}

export async function upsertProjectAgentLaneProfile(
  input: UpsertProjectAgentLaneProfileInput
): Promise<ProjectAgentLaneProfile> {
  await ensureDb();

  const existingRow = await getProjectLaneProfileRow(input.projectId, input.role, input.laneKey);
  const defaults = laneProfileDefaults(input.role, input.laneKey);
  const avatarUrlInput =
    typeof input.avatarUrl === 'string' ? input.avatarUrl.trim() : undefined;
  const shortDescriptionInput =
    typeof input.shortDescription === 'string' ? input.shortDescription.trim() : undefined;
  const createIdentity = resolveProfileIdentityForCreate({
    input: {
      displayName: input.displayName,
      emoji: input.emoji,
      mission: input.mission,
    },
    defaults,
  });
  const displayName = createIdentity.displayName;
  const emoji = createIdentity.emoji;
  const mission = createIdentity.mission;
  const createAvatarUrl = avatarUrlInput !== undefined ? avatarUrlInput || null : null;
  const createShortDescription =
    shortDescriptionInput !== undefined
      ? shortDescriptionInput || defaults.shortDescription
      : defaults.shortDescription;

  if (!existingRow) {
    await db.insert(projectAgentLaneProfiles).values({
      projectId: input.projectId,
      role: input.role,
      laneKey: input.laneKey,
      displayName,
      emoji,
      avatarUrl: createAvatarUrl,
      shortDescription: createShortDescription,
      mission,
      isEnabled: input.isEnabled !== false,
      fileBundle: normalizeFileBundle(
        input.role,
        displayName,
        emoji,
        mission,
        input.fileBundle || {}
      ),
      knowledgeParts: input.knowledgeParts || [],
      skillIds: input.skillIds || [],
      modelOverrides: input.modelOverrides || {},
      heartbeatMeta: input.heartbeatMeta || {},
      createdById: input.userId ?? null,
      updatedById: input.userId ?? null,
      createdAt: dbNow(),
      updatedAt: dbNow(),
    });

    const created = await getProjectAgentLaneProfile(input.projectId, input.role, input.laneKey);
    if (!created) {
      throw new Error('Failed to create project lane agent profile');
    }
    return created;
  }

  const existing = mapLaneProfileRow(existingRow);
  const mergedIdentity = resolveProfileIdentityForUpdate({
    input: {
      displayName: input.displayName,
      emoji: input.emoji,
      mission: input.mission,
    },
    existing: {
      displayName: existing.displayName,
      emoji: existing.emoji,
      mission: existing.mission,
    },
    defaults,
  });
  const avatarUrl =
    avatarUrlInput !== undefined
      ? avatarUrlInput || null
      : existing.avatarUrl || null;
  const shortDescription =
    shortDescriptionInput !== undefined
      ? shortDescriptionInput || defaults.shortDescription
      : existing.shortDescription || defaults.shortDescription;
  const mergedFileBundle = {
    ...existing.fileBundle,
    ...(input.fileBundle || {}),
  };
  const mergedKnowledgeParts =
    input.knowledgeParts !== undefined ? normalizeKnowledgeParts(input.knowledgeParts) : existing.knowledgeParts;
  const mergedSkillIds =
    input.skillIds !== undefined ? Array.from(new Set(input.skillIds)) : existing.skillIds;
  const mergedModelOverrides = input.modelOverrides ?? existing.modelOverrides;
  const mergedHeartbeatMeta = input.heartbeatMeta
    ? { ...existing.heartbeatMeta, ...input.heartbeatMeta }
    : existing.heartbeatMeta;

  await db
    .update(projectAgentLaneProfiles)
    .set({
      displayName: mergedIdentity.displayName,
      emoji: mergedIdentity.emoji,
      avatarUrl,
      shortDescription,
      mission: mergedIdentity.mission,
      isEnabled:
        input.isEnabled !== undefined
          ? input.isEnabled
          : existing.isEnabled,
      fileBundle: mergedFileBundle,
      knowledgeParts: mergedKnowledgeParts,
      skillIds: mergedSkillIds,
      modelOverrides: mergedModelOverrides,
      heartbeatMeta: mergedHeartbeatMeta,
      updatedById: input.userId ?? null,
      updatedAt: dbNow(),
    })
    .where(eq(projectAgentLaneProfiles.id, existing.id));

  const updated = await getProjectAgentLaneProfile(input.projectId, input.role, input.laneKey);
  if (!updated) {
    throw new Error('Failed to update project lane agent profile');
  }
  return updated;
}

export async function getSharedProfile(
  key: SharedAgentProfileKey
): Promise<string> {
  await ensureDb();
  const [row] = await db
    .select({
      content: agentSharedProfiles.content,
    })
    .from(agentSharedProfiles)
    .where(eq(agentSharedProfiles.key, key))
    .limit(1);
  return typeof row?.content === 'string' ? row.content : '';
}

export async function getSharedUserProfile(): Promise<string> {
  return getSharedProfile(SHARED_AGENT_PROFILE_KEYS.USER_MD);
}

export async function setSharedUserProfile(
  content: string,
  userId?: string | null
): Promise<string> {
  await ensureDb();
  const key = SHARED_AGENT_PROFILE_KEYS.USER_MD;
  const [existing] = await db
    .select({
      id: agentSharedProfiles.id,
    })
    .from(agentSharedProfiles)
    .where(eq(agentSharedProfiles.key, key))
    .limit(1);

  if (existing?.id) {
    await db
      .update(agentSharedProfiles)
      .set({
        content,
        updatedById: userId ?? null,
        updatedAt: dbNow(),
      })
      .where(eq(agentSharedProfiles.id, existing.id));
  } else {
    await db.insert(agentSharedProfiles).values({
      key,
      content,
      updatedById: userId ?? null,
      createdAt: dbNow(),
      updatedAt: dbNow(),
    });
  }
  return content;
}

export async function resolveRoleSkillIds(
  _projectId: number,
  _role: AgentRole,
  _laneKey?: AgentLaneKey
): Promise<number[]> {
  return [];
}

export async function buildRolePromptContext(
  projectId: number,
  role: AgentRole,
  laneKey?: AgentLaneKey
): Promise<RolePromptContext> {
  await ensureDb();

  let profile =
    role === 'writer' && laneKey
      ? await getProjectAgentLaneProfile(projectId, role, laneKey)
      : await getProjectAgentProfile(projectId, role);
  if (!profile) {
    await seedProjectAgentProfiles(projectId, null);
    if (role === 'writer' && laneKey) {
      await seedProjectAgentLaneProfiles(projectId, null);
      profile = await getProjectAgentLaneProfile(projectId, role, laneKey);
    } else {
      profile = await getProjectAgentProfile(projectId, role);
    }
  }

  if (!profile) {
    const defaults =
      role === 'writer' && laneKey
        ? laneProfileDefaults(role, laneKey)
        : roleDisplay(role);
    profile = {
      id: -1,
      projectId,
      role,
      ...(role === 'writer' && laneKey ? { laneKey } : {}),
      displayName: defaults.displayName,
      emoji: defaults.emoji,
      avatarUrl: null,
      shortDescription: defaults.shortDescription,
      mission: defaults.mission,
      isEnabled: true,
      fileBundle: buildDefaultFileBundle(role, defaults.displayName, defaults.emoji, defaults.mission),
      knowledgeParts: [],
      skillIds: [],
      modelOverrides: {},
      heartbeatMeta: {},
      createdById: null,
      updatedById: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  // Fix 3A: If non-writer role has empty knowledge, inherit from writer profile
  let effectiveKnowledgeParts = profile.knowledgeParts;
  if (effectiveKnowledgeParts.length === 0 && role !== 'writer') {
    const writerProfile = await getProjectAgentProfile(projectId, 'writer');
    if (writerProfile && writerProfile.knowledgeParts.length > 0) {
      effectiveKnowledgeParts = writerProfile.knowledgeParts;
    }
  }

  const sharedUserProfile = await getSharedUserProfile();
  const sections: string[] = [];
  for (const key of ['IDENTITY', 'SOUL', 'AGENTS', 'TOOLS', 'HEARTBEAT'] as const) {
    const content = String(profile.fileBundle[key] || '').trim();
    if (content) sections.push(content);
  }
  if (effectiveKnowledgeParts.length > 0) {
    const knowledgeSections = effectiveKnowledgeParts
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((part) => {
        const label = part.label || part.partType.replace(/_/g, ' ');
        return `## ${label}\n${part.content.trim()}`;
      })
      .join('\n\n');
    if (knowledgeSections.trim()) {
      sections.push(`# KNOWLEDGE\n${knowledgeSections}`);
    }
  }
  if (sharedUserProfile.trim()) {
    sections.push(`# USER\n${sharedUserProfile.trim()}`);
  }
  const promptContext = trimTo(sections.join('\n\n---\n\n'), PROMPT_CONTEXT_MAX_CHARS);
  const roleSkillIds: number[] = [];

  return {
    role,
    laneKey,
    profile,
    promptContext,
    roleSkillIds,
    sharedUserProfile,
  };
}

export async function appendMemoryEntry(
  projectId: number,
  role: AgentRole,
  entry: string,
  userIdOrOptions?:
    | string
    | null
    | {
        userId?: string | null;
        laneKey?: AgentLaneKey;
      }
) {
  const userId =
    typeof userIdOrOptions === 'string' || userIdOrOptions === null
      ? userIdOrOptions
      : userIdOrOptions?.userId;
  const laneKey =
    typeof userIdOrOptions === 'object' && userIdOrOptions !== null
      ? userIdOrOptions.laneKey
      : undefined;
  const profile =
    role === 'writer' && laneKey
      ? await getProjectAgentLaneProfile(projectId, role, laneKey)
      : await getProjectAgentProfile(projectId, role);
  const existingText = profile?.fileBundle.MEMORY || '# MEMORY';
  const nowIso = new Date().toISOString();
  const addition = `- [${nowIso}] ${entry.trim()}`;
  const merged = trimTo(`${existingText.trim()}\n${addition}\n`, MAX_MEMORY_CHARS);
  if (role === 'writer' && laneKey) {
    await upsertProjectAgentLaneProfile({
      projectId,
      role,
      laneKey,
      userId: userId ?? null,
      fileBundle: { MEMORY: merged },
      heartbeatMeta: { lastMemoryUpdateAt: nowIso },
    });
  } else {
    await upsertProjectAgentProfile({
      projectId,
      role,
      userId: userId ?? null,
      fileBundle: { MEMORY: merged },
      heartbeatMeta: { lastMemoryUpdateAt: nowIso },
    });
  }
}

export async function setWorkingState(
  projectId: number,
  role: AgentRole,
  stateText: string,
  userIdOrOptions?:
    | string
    | null
    | {
        userId?: string | null;
        laneKey?: AgentLaneKey;
      }
) {
  const userId =
    typeof userIdOrOptions === 'string' || userIdOrOptions === null
      ? userIdOrOptions
      : userIdOrOptions?.userId;
  const laneKey =
    typeof userIdOrOptions === 'object' && userIdOrOptions !== null
      ? userIdOrOptions.laneKey
      : undefined;
  const nowIso = new Date().toISOString();
  const content = trimTo(`# WORKING\n${stateText.trim()}\nUpdated: ${nowIso}`, MAX_WORKING_CHARS);
  if (role === 'writer' && laneKey) {
    await upsertProjectAgentLaneProfile({
      projectId,
      role,
      laneKey,
      userId: userId ?? null,
      fileBundle: { WORKING: content },
      heartbeatMeta: { lastWorkingUpdateAt: nowIso },
    });
  } else {
    await upsertProjectAgentProfile({
      projectId,
      role,
      userId: userId ?? null,
      fileBundle: { WORKING: content },
      heartbeatMeta: { lastWorkingUpdateAt: nowIso },
    });
  }
}

export function resolveProjectRoleModelOverride(
  profile: Pick<ProjectAgentProfile, 'modelOverrides'> | Pick<ProjectAgentLaneProfile, 'modelOverrides'> | null | undefined,
  actionKeys: string[]
) {
  if (!profile?.modelOverrides) return undefined;
  for (const key of actionKeys) {
    const hit = profile.modelOverrides[key];
    if (hit) return hit;
  }
  return undefined;
}

export async function runProjectHeartbeat(args: {
  projectId: number;
  actorUserId?: string | null;
  actorName?: string | null;
  roles?: AgentRole[];
}): Promise<HeartbeatRunResult> {
  await ensureDb();

  const seeded = await seedProjectAgentProfiles(args.projectId, args.actorUserId ?? null);
  const profiles = seeded.profiles;
  const targetRoles = args.roles?.length
    ? args.roles
    : FIXED_AGENT_ROLES;
  const activeProfiles = profiles.filter(
    (profile) => targetRoles.includes(profile.role) && profile.isEnabled
  );

  const convex = getConvexClient();
  const tasks = convex
    ? await convex.query(api.tasks.list, { projectId: args.projectId, limit: 500 })
    : [];

  const blocked = tasks.filter((task) => task.workflowStageStatus === 'blocked').length;
  const queued = tasks.filter((task) => task.workflowStageStatus === 'queued').length;
  const inReview = tasks.filter((task) => task.status === 'IN_REVIEW').length;
  const inProgress = tasks.filter((task) => task.status === 'IN_PROGRESS').length;

  const roleResults: HeartbeatRunResult['roleResults'] = [];
  const projectSuggestions: string[] = [];

  for (const profile of activeProfiles) {
    const focusStages = ROLE_STAGE_FOCUS[profile.role] || [];
    const stageTasks = tasks.filter((task) =>
      focusStages.includes(String(task.workflowCurrentStageKey || ''))
    );
    const stageBlocked = stageTasks.filter((task) => task.workflowStageStatus === 'blocked').length;
    const stageQueued = stageTasks.filter((task) => task.workflowStageStatus === 'queued').length;
    const latestTask = stageTasks
      .slice()
      .sort((a, b) => (b.workflowLastEventAt ?? 0) - (a.workflowLastEventAt ?? 0))[0];

    const summary = `${profile.displayName} heartbeat: ${stageTasks.length} focus task(s), ` +
      `${stageBlocked} blocked, ${stageQueued} queued.` +
      (latestTask?.workflowLastEventText
        ? ` Latest: ${latestTask.workflowLastEventText}`
        : '');

    const suggestedActions: string[] = [];
    if (stageBlocked > 0) {
      suggestedActions.push(`Review blocked ${profile.role} tasks and resolve assignment or approval gates.`);
    }
    if (stageQueued > 0) {
      suggestedActions.push(`Monitor queued ${profile.role} tasks and rebalance agent availability.`);
    }
    if (suggestedActions.length === 0) {
      suggestedActions.push(`Continue ${profile.role} pipeline execution and monitor next handoff.`);
    }

    await appendMemoryEntry(args.projectId, profile.role, summary, args.actorUserId ?? null);
    await setWorkingState(
      args.projectId,
      profile.role,
      `${summary}\nSuggested actions:\n${suggestedActions.map((line) => `- ${line}`).join('\n')}`,
      args.actorUserId ?? null
    );
    await upsertProjectAgentProfile({
      projectId: args.projectId,
      role: profile.role,
      userId: args.actorUserId ?? null,
      heartbeatMeta: {
        lastRunAt: new Date().toISOString(),
        lastSummary: summary,
        suggestedActions,
      },
    });

    roleResults.push({
      role: profile.role,
      summary,
      suggestedActions,
      profileUpdated: true,
    });
    projectSuggestions.push(...suggestedActions);
  }

  const dedupedSuggestions = Array.from(new Set(projectSuggestions)).slice(0, 12);
  const projectSummary =
    `Heartbeat summary: ${inProgress} in progress, ${inReview} in review, ` +
    `${blocked} blocked, ${queued} queued in project ${args.projectId}.`;

  if (convex) {
    const authorName = args.actorName || 'Project Heartbeat';
    await convex.mutation(api.messages.send, {
      projectId: args.projectId,
      authorType: 'agent',
      authorId: 'project-heartbeat',
      authorName,
      content: `${projectSummary}\n${dedupedSuggestions.map((item) => `- ${item}`).join('\n')}`,
    });
    await convex.mutation(api.activities.create, {
      type: 'agent_heartbeat',
      projectId: args.projectId,
      description: projectSummary,
      metadata: {
        suggestedActions: dedupedSuggestions,
        roleResults,
      },
    });
  }

  return {
    projectId: args.projectId,
    runAt: new Date().toISOString(),
    roleResults,
    projectSummary,
    suggestedActions: dedupedSuggestions,
  };
}
