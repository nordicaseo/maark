import { randomBytes } from 'crypto';
import { marked } from 'marked';
import { and, asc, eq, isNull, or } from 'drizzle-orm';
import { api } from '../../convex/_generated/api';
import type { Doc, Id } from '../../convex/_generated/dataModel';
import type { AppUser } from '@/lib/auth';
import { db, ensureDb } from '@/db';
import { dbNow } from '@/db/utils';
import { documents, skills, skillParts } from '@/db/schema';
import {
  getWorkflowTaskForUser,
  type TopicStageKey,
} from '@/lib/topic-workflow';
import {
  isAgentLaneKey,
  TOPIC_STAGE_OWNER_CHAINS,
} from '@/lib/content-workflow-taxonomy';
import {
  resolveProviderForAction,
  type ModelOverride,
} from '@/lib/ai/model-resolution';
import {
  appendMemoryEntry,
  buildRolePromptContext,
  resolveRoleSkillIds,
  resolveProjectRoleModelOverride,
  setWorkingState,
} from '@/lib/agents/project-agent-profiles';
import { getSerpIntelSnapshot } from '@/lib/serp/serp-intel';
import { contentToHtml } from '@/lib/tiptap/to-html';
import { normalizeGeneratedHtml } from '@/lib/utils/html-normalize';
import { getConvexClient } from '@/lib/convex/server';
import { resolveTaskLinkedPageCleanContent } from '@/lib/pages/artifacts';
import { logAlertEvent } from '@/lib/observability';
import {
  buildEndingCompletionPrompt,
  buildContinuationPrompt,
  evaluateWritingCompleteness,
  extractOutlineHeadings,
  stripHtmlForCompleteness,
  type WritingCompletenessResult,
} from '@/lib/workflow/writing-completeness';
import { applyStyleGuard, styleGuardPassed } from '@/lib/workflow/style-guard';
import { resolveTemplatePolicy } from '@/lib/workflow/content-templates';
import { getWorkflowOpsSettings } from '@/lib/workflow/ops-settings';
import type { AgentRole } from '@/types/agent-profile';
import type { AgentLaneKey } from '@/types/agent-runtime';
import type { AIAction } from '@/types/ai';
import type {
  OutlineConstraintPolicy,
  StyleGuardPolicy,
} from '@/types/content-template-config';
import type { ContentFormat } from '@/types/document';

interface StageRunResult {
  summary: string;
  artifactTitle: string;
  artifactBody: string;
  artifactData?: unknown;
  model: {
    providerName: string;
    model: string;
    maxTokens: number;
    temperature: number;
  };
  deliverable?: {
    type: string;
    title: string;
    url?: string;
  };
  control?: {
    approved?: boolean;
    revisionBrief?: string;
    styleAdjusted?: boolean;
  };
}

interface SkillContext {
  names: string[];
  promptText: string;
  applied: Array<{
    id: number;
    name: string;
    origin: 'role_profile' | 'task' | 'project' | 'global';
  }>;
}

interface StageProfileContext {
  role: AgentRole;
  laneKey?: AgentLaneKey;
  promptText: string;
  profileUpdatedAt?: string;
  profileName?: string;
  roleSkillIds: number[];
  projectRoleModelOverride?: ModelOverride;
}

export interface WorkflowStageRun {
  stage: TopicStageKey;
  summary: string;
  nextStage?: TopicStageKey;
}

export interface RunTopicWorkflowInput {
  user: AppUser;
  taskId: Id<'tasks'>;
  autoContinue?: boolean;
  maxStages?: number;
}

export interface RunTopicWorkflowResult {
  taskId: string;
  currentStage: TopicStageKey;
  runs: WorkflowStageRun[];
  stoppedReason?: string;
  documentId?: number;
}

const RUNNABLE_STAGES = new Set<TopicStageKey>([
  'research',
  'seo_intel_review',
  'outline_build',
  'writing',
  'editing',
  'final_review',
]);

const ROUTED_STAGE_ORDER = [
  'research',
  'seo_intel_review',
  'outline_build',
  'writing',
  'editing',
  'final_review',
] as const;

const ROLE_ALIASES: Record<string, string[]> = {
  researcher: ['researcher', 'seo', 'editor'],
  outliner: ['outliner', 'editor', 'content'],
  writer: ['writer'],
  'seo-reviewer': ['seo-reviewer', 'seo', 'editor'],
  'project-manager': ['project-manager', 'lead', 'editor'],
  seo: ['seo', 'seo-reviewer', 'editor'],
  content: ['content', 'editor'],
  lead: ['lead', 'project-manager', 'editor', 'seo-reviewer'],
};

const STAGE_PRIMARY_ROLE: Record<TopicStageKey, AgentRole> = {
  research: 'researcher',
  seo_intel_review: 'seo-reviewer',
  outline_build: 'outliner',
  outline_review: 'seo-reviewer',
  prewrite_context: 'project-manager',
  writing: 'writer',
  editing: 'editor',
  final_review: 'seo-reviewer',
  human_review: 'lead',
  complete: 'lead',
};

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

const DEFAULT_FINAL_REVIEW_MAX_REVISIONS = 2;
const STYLE_FIX_MAX_ATTEMPTS = 1;
const MAX_COMPRESSION_ATTEMPTS = 2;
const NON_BLOCKING_SERP_TIMEOUT_MS = 1500;

function stripCodeFences(input: string): string {
  return input
    .replace(/^```(?:json|markdown|html)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

class IncompleteDraftError extends Error {
  completion: WritingCompletenessResult;
  partialHtml: string;
  partialPlainText: string;
  continuationAttempts: number;
  endingCompletionAttempted: boolean;

  constructor(args: {
    message: string;
    completion: WritingCompletenessResult;
    partialHtml: string;
    partialPlainText: string;
    continuationAttempts: number;
    endingCompletionAttempted: boolean;
  }) {
    super(args.message);
    this.name = 'IncompleteDraftError';
    this.completion = args.completion;
    this.partialHtml = args.partialHtml;
    this.partialPlainText = args.partialPlainText;
    this.continuationAttempts = args.continuationAttempts;
    this.endingCompletionAttempted = args.endingCompletionAttempted;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

async function collectStreamText(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let out = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    out += decoder.decode(value, { stream: true });
  }
  return out.trim();
}

function parseJsonObject<T>(raw: string): T {
  const cleaned = stripCodeFences(raw);
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1)) as T;
    }
    throw new Error('Model response was not valid JSON.');
  }
}

function parseStringArray(value: unknown, limit = 8): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item ?? '').trim())
    .filter(Boolean)
    .slice(0, limit);
}

function parseTermArray(value: unknown, limit = 10): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === 'string') return item.trim();
      if (item && typeof item === 'object') {
        return String((item as { term?: unknown }).term ?? '').trim();
      }
      return '';
    })
    .filter(Boolean)
    .slice(0, limit);
}

function trimTo(input: string, maxChars: number): string {
  if (input.length <= maxChars) return input;
  return `${input.slice(0, maxChars).trimEnd()}…`;
}

async function loadSerpIntelNonBlocking(args: {
  keyword: string;
  projectId?: number | null;
}): Promise<Awaited<ReturnType<typeof getSerpIntelSnapshot>> | null> {
  const keyword = args.keyword.trim();
  if (!keyword) return null;

  const timeoutPromise = new Promise<null>((resolve) => {
    setTimeout(() => resolve(null), NON_BLOCKING_SERP_TIMEOUT_MS);
  });

  const intelPromise = getSerpIntelSnapshot({
    keyword,
    projectId: args.projectId ?? undefined,
    preferFresh: false,
    cachedOnly: true,
  })
    .then((snapshot) => snapshot)
    .catch(() => null);

  return Promise.race([intelPromise, timeoutPromise]);
}

function normalizeContentFormat(value: unknown): ContentFormat {
  if (typeof value !== 'string') return 'blog_post';
  return (SUPPORTED_CONTENT_FORMATS.find((format) => format === value) || 'blog_post') as ContentFormat;
}

function legacyActionKeyForStage(stage: TopicStageKey): AIAction {
  if (stage === 'writing' || stage === 'editing' || stage === 'final_review') return 'writing';
  return 'research';
}

function enforceOutlineConstraints(
  markdown: string,
  policy: OutlineConstraintPolicy
): { markdown: string; trimmed: boolean; h2Count: number } {
  const lines = markdown.split('\n');
  const out: string[] = [];
  const maxH2 = Math.max(2, policy.maxH2 || 8);
  const maxH3PerH2 = Math.max(1, policy.maxH3PerH2 || 3);
  let h2Count = 0;
  let h3CountCurrentH2 = 0;
  let skipH2Section = false;
  let skipH3Section = false;
  let trimmed = false;

  for (const line of lines) {
    const heading2 = /^##\s+/.test(line);
    const heading3 = /^###\s+/.test(line);

    if (heading2) {
      h2Count += 1;
      h3CountCurrentH2 = 0;
      skipH3Section = false;
      if (h2Count > maxH2) {
        skipH2Section = true;
        trimmed = true;
        continue;
      }
      skipH2Section = false;
      out.push(line);
      continue;
    }

    if (skipH2Section) {
      continue;
    }

    if (heading3) {
      h3CountCurrentH2 += 1;
      if (h3CountCurrentH2 > maxH3PerH2) {
        skipH3Section = true;
        trimmed = true;
        continue;
      }
      skipH3Section = false;
      out.push(line);
      continue;
    }

    if (skipH3Section) {
      continue;
    }

    out.push(line);
  }

  return {
    markdown: out.join('\n').trim(),
    trimmed,
    h2Count: Math.min(h2Count, maxH2),
  };
}

function buildCompressionPrompt(args: {
  currentHtml: string;
  minimumWords: number;
  maximumWords: number;
  missingHeadings: string[];
}): string {
  return `Compress and refine this article to fit strict length constraints without losing structure.

Constraints:
- Keep all required headings and section intent.
- Target total words between ${args.minimumWords} and ${args.maximumWords}.
- Remove repetition, filler transitions, and redundant examples.
- Keep clean HTML output only.
- Do not include markdown or code fences.

Missing headings to preserve:
${args.missingHeadings.slice(0, 10).join(', ') || 'none'}

Current article HTML:
${args.currentHtml}

Return the full revised article HTML.`;
}

function buildStyleFixPrompt(args: {
  currentHtml: string;
  policy: StyleGuardPolicy;
}): string {
  const colonInstruction =
    args.policy.colon === 'forbid'
      ? 'Remove all colons from narrative and headings.'
      : args.policy.colon === 'structural_only'
        ? `Only keep colons in structural headings/labels. Narrative colons max ${Math.max(
            0,
            args.policy.maxNarrativeColons || 0
          )}.`
        : 'Colon usage is allowed.';

  return `Rewrite this HTML article with style normalization:
- Replace every em dash and en dash with natural punctuation or sentence split.
- ${colonInstruction}
- Preserve article meaning, headings, and SEO intent.
- Return clean HTML only.

Article HTML:
${args.currentHtml}`;
}

async function countFinalReviewAutoRevisionAttempts(
  convex: NonNullable<ReturnType<typeof getConvexClient>>,
  taskId: Id<'tasks'>
): Promise<number> {
  const history = await convex.query(api.topicWorkflow.listWorkflowHistory, {
    taskId,
    limit: 120,
  });
  return (history.events || []).filter((event) => {
    const payload = (event.payload as { meta?: { reasonCode?: string } } | undefined)?.meta;
    return (
      event.stageKey === 'final_review' &&
      event.eventType === 'stage_progress' &&
      payload?.reasonCode === 'final_review_auto_revision'
    );
  }).length;
}

function composeStageUserPrompt(
  basePrompt: string,
  rolePromptText: string,
  skillPromptText: string
): string {
  const sections = [basePrompt.trim()];
  const role = rolePromptText.trim();
  const skills = skillPromptText.trim();

  if (role) {
    sections.push(`Role profile context:\n${role}`);
  }
  if (skills) {
    sections.push(`Project skills and rules:\n${skills}`);
  }

  return sections.join('\n\n');
}

function normalizedRoleCandidates(role: string): string[] {
  const key = role.toLowerCase();
  const aliases = ROLE_ALIASES[key] || [key];
  return Array.from(new Set([key, ...aliases]));
}

function isRoleAllowedForStage(stage: TopicStageKey, role: string): boolean {
  const normalizedRole = role.toLowerCase();
  const chain = TOPIC_STAGE_OWNER_CHAINS[stage] || [];
  for (const requestedRole of chain) {
    if (requestedRole === 'human') continue;
    if (normalizedRoleCandidates(requestedRole).includes(normalizedRole)) {
      return true;
    }
  }
  return false;
}

function resolveTaskLaneKey(task: Doc<'tasks'>): AgentLaneKey {
  if (isAgentLaneKey(task.workflowLaneKey)) return task.workflowLaneKey;
  const laneFromTag = (task.tags || [])
    .map((tag) => String(tag))
    .find((tag) => tag.startsWith('lane:'));
  const laneKey = laneFromTag ? laneFromTag.split(':')[1] : '';
  if (isAgentLaneKey(laneKey)) return laneKey;
  return 'blog';
}


async function buildSkillContext(
  task: Doc<'tasks'>,
  roleSkillIds: number[] = []
): Promise<SkillContext> {
  const selectedSkills = new Map<
    number,
    {
      id: number;
      name: string;
      content: string;
      origin: 'role_profile' | 'task' | 'project' | 'global';
    }
  >();

  if (roleSkillIds.length > 0) {
    const roleSkills = (await db
      .select({
        id: skills.id,
        name: skills.name,
        content: skills.content,
      })
      .from(skills)
      .where(or(...roleSkillIds.map((id) => eq(skills.id, id))))) as Array<{
      id: number;
      name: string;
      content: string;
    }>;

    const roleSkillById = new Map<number, { id: number; name: string; content: string }>(
      roleSkills.map((skill) => [skill.id, skill])
    );
    for (const skillId of roleSkillIds) {
      const roleSkill = roleSkillById.get(skillId);
      if (!roleSkill) continue;
      selectedSkills.set(roleSkill.id, {
        ...roleSkill,
        origin: 'role_profile',
      });
    }
  }

  if (task.skillId) {
    const [explicitSkill] = await db
      .select({
        id: skills.id,
        name: skills.name,
        content: skills.content,
      })
      .from(skills)
      .where(eq(skills.id, task.skillId))
      .limit(1);

    if (explicitSkill) {
      selectedSkills.set(explicitSkill.id, {
        ...explicitSkill,
        origin: 'task',
      });
    }
  }

  if (task.projectId) {
    const projectSkills = await db
      .select({
        id: skills.id,
        name: skills.name,
        content: skills.content,
      })
      .from(skills)
      .where(eq(skills.projectId, task.projectId))
      .orderBy(asc(skills.id))
      .limit(10);

    for (const projectSkill of projectSkills) {
      if (selectedSkills.has(projectSkill.id)) continue;
      selectedSkills.set(projectSkill.id, {
        ...projectSkill,
        origin: 'project',
      });
    }
  }

  const globalSkills = await db
    .select({
      id: skills.id,
      name: skills.name,
      content: skills.content,
    })
    .from(skills)
    .where(
      and(
        eq(skills.isGlobal, 1),
        or(isNull(skills.projectId), eq(skills.projectId, task.projectId ?? -1))
      )
    )
    .orderBy(asc(skills.id))
    .limit(10);

  for (const globalSkill of globalSkills) {
    if (selectedSkills.has(globalSkill.id)) continue;
    selectedSkills.set(globalSkill.id, {
      ...globalSkill,
      origin: 'global',
    });
  }

  const orderedSkills = Array.from(selectedSkills.values());
  if (orderedSkills.length === 0) {
    return { names: [], promptText: '', applied: [] };
  }

  const sections: string[] = [];
  const names: string[] = [];
  const applied: SkillContext['applied'] = [];

  for (const skill of orderedSkills) {
    names.push(skill.name);
    applied.push({
      id: skill.id,
      name: skill.name,
      origin: skill.origin,
    });

    const parts: Array<{ content: string | null; sortOrder: number | null }> = await db
      .select({
        content: skillParts.content,
        sortOrder: skillParts.sortOrder,
      })
      .from(skillParts)
      .where(eq(skillParts.skillId, skill.id));

    const orderedParts = parts
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
      .map((part) => String(part.content ?? '').trim())
      .filter(Boolean);

    const mergedContent =
      orderedParts.length > 0
        ? orderedParts.join('\n\n')
        : String(skill.content || '').trim();

    if (!mergedContent) continue;

    sections.push(`Skill (${skill.origin}): ${skill.name}\n${mergedContent}`);
  }

  const promptText = trimTo(sections.join('\n\n---\n\n'), 7000);
  return { names, promptText, applied };
}

async function getDocumentById(documentId: number) {
  const [doc] = await db
    .select()
    .from(documents)
    .where(eq(documents.id, documentId))
    .limit(1);

  if (!doc) {
    throw new Error(`Linked document #${documentId} was not found.`);
  }

  return doc;
}

async function ensureTaskDocument(
  task: Doc<'tasks'>,
  user: AppUser
): Promise<{ task: Doc<'tasks'>; document: Awaited<ReturnType<typeof getDocumentById>> }> {
  const { convex } = await getWorkflowTaskForUser(user, task._id);

  if (task.documentId) {
    const document = await getDocumentById(task.documentId);
    return { task, document };
  }

  const [document] = await db
    .insert(documents)
    .values({
      title: task.title,
      contentType: 'blog_post',
      targetKeyword: task.title,
      projectId: task.projectId ?? null,
      authorId: user.id,
      content: { type: 'doc', content: [{ type: 'paragraph' }] },
      plainText: '',
      wordCount: 0,
      status: 'draft',
    })
    .returning();

  await convex.mutation(api.tasks.update, {
    id: task._id,
    expectedProjectId: task.projectId ?? undefined,
    documentId: document.id,
  });

  const refreshed = await convex.query(api.tasks.get, {
    id: task._id,
    projectId: task.projectId ?? undefined,
  });

  if (!refreshed) {
    throw new Error('Task not found after linking document.');
  }

  return { task: refreshed, document };
}

async function resolveAgentStageModelOverride(
  task: Doc<'tasks'>,
  stage: TopicStageKey
): Promise<ModelOverride | undefined> {
  if (!task.assignedAgentId) return undefined;

  const convex = getConvexClient();
  if (!convex) return undefined;

  const agent = await convex.query(api.agents.get, { id: task.assignedAgentId });
  const overrides = agent?.modelOverrides;
  if (!overrides) return undefined;

  const keys: string[] = [
    stage,
    stageActionKey(stage),
    legacyActionKeyForStage(stage),
    `${stage}_stage`,
    'workflow',
  ];
  if (stage === 'prewrite_context') {
    keys.unshift('workflow_pm', 'workflow_prewrite');
  }

  for (const key of keys) {
    const hit = overrides[key];
    if (hit) return hit;
  }

  return undefined;
}

function stageActionKey(stage: TopicStageKey): AIAction {
  switch (stage) {
    case 'research':
      return 'workflow_research';
    case 'seo_intel_review':
      return 'workflow_serp';
    case 'outline_build':
      return 'workflow_outline';
    case 'prewrite_context':
      return 'workflow_pm';
    case 'writing':
      return 'workflow_writing';
    case 'editing':
      return 'workflow_editing';
    case 'final_review':
      return 'workflow_final_review';
    default:
      return 'research';
  }
}

function isPlannedStageEnabled(task: Doc<'tasks'>, stage: TopicStageKey): boolean {
  if (!ROUTED_STAGE_ORDER.includes(stage as (typeof ROUTED_STAGE_ORDER)[number])) {
    return true;
  }
  const plan =
    task.workflowStagePlan && typeof task.workflowStagePlan === 'object'
      ? (task.workflowStagePlan as Record<string, unknown>)
      : null;
  const owners =
    plan?.owners && typeof plan.owners === 'object'
      ? (plan.owners as Record<string, unknown>)
      : null;
  const owner =
    owners?.[stage] && typeof owners[stage] === 'object'
      ? (owners[stage] as Record<string, unknown>)
      : null;
  if (!owner || owner.enabled === undefined) return true;
  return owner.enabled === true || String(owner.enabled).toLowerCase() === 'true';
}

function nextCanonicalStage(stage: TopicStageKey): TopicStageKey | null {
  if (stage === 'research') return 'seo_intel_review';
  if (stage === 'seo_intel_review') return 'outline_build';
  if (stage === 'outline_build') return 'writing';
  if (stage === 'writing') return 'editing';
  if (stage === 'editing') return 'final_review';
  if (stage === 'prewrite_context') return 'writing';
  return null;
}

function resolveAutoAdvance(
  task: Doc<'tasks'>,
  stage: TopicStageKey
): {
  toStage: TopicStageKey;
  skipOptionalOutlineReview?: boolean;
  skippedStages?: TopicStageKey[];
} | null {
  let next = nextCanonicalStage(stage);
  if (!next) return null;
  const skippedStages: TopicStageKey[] = [];

  while (next && !isPlannedStageEnabled(task, next)) {
    skippedStages.push(next);
    next = nextCanonicalStage(next);
  }
  if (!next) return null;

  return {
    toStage: next,
    skippedStages: skippedStages.length > 0 ? skippedStages : undefined,
  };
}

async function resolveProviderForStage(
  stage: TopicStageKey,
  stageProfileContext: StageProfileContext,
  agentOverride?: ModelOverride
) {
  const stageAction = stageActionKey(stage);
  const legacyAction = legacyActionKeyForStage(stage);

  try {
    return await resolveProviderForAction(stageAction, undefined, {
      projectRoleOverride: stageProfileContext.projectRoleModelOverride,
      agentOverride,
    });
  } catch (error) {
    if (legacyAction === stageAction) throw error;
    return await resolveProviderForAction(legacyAction, undefined, {
      projectRoleOverride: stageProfileContext.projectRoleModelOverride,
      agentOverride,
    });
  }
}

async function setAgentWorking(
  convex: ReturnType<typeof getConvexClient>,
  task: Doc<'tasks'>,
  preloadedAgent?: Doc<'agents'> | null
) {
  if (!convex || !task.assignedAgentId) return null;

  const agent = preloadedAgent ?? (await convex.query(api.agents.get, { id: task.assignedAgentId }));
  await convex.mutation(api.agents.updateStatus, {
    id: task.assignedAgentId,
    status: 'WORKING',
    currentTaskId: task._id,
  });
  return agent;
}

async function setAgentOnline(
  convex: ReturnType<typeof getConvexClient>,
  task: Doc<'tasks'>
) {
  if (!convex || !task.assignedAgentId) return;
  await convex.mutation(api.agents.updateStatus, {
    id: task.assignedAgentId,
    status: 'ONLINE',
  });
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

async function getWriterAvailabilityDiagnostics(
  convex: NonNullable<ReturnType<typeof getConvexClient>>,
  projectId?: number | null,
  laneKey?: AgentLaneKey
): Promise<{
  writerCount: number;
  writerOnline: number;
  writerIdle: number;
  writerWorking: number;
  writerOffline: number;
  laneKey: AgentLaneKey | null;
}> {
  const allAgents = await convex.query(api.agents.list, {
    limit: 300,
    projectId: projectId ?? undefined,
    role: 'writer',
    laneKey: laneKey ?? undefined,
  });
  const writers = allAgents.filter((agent) => agent.role.toLowerCase() === 'writer');
  return {
    writerCount: writers.length,
    writerOnline: writers.filter((agent) => normalizeAgentStatus(agent.status) === 'ONLINE').length,
    writerIdle: writers.filter((agent) => normalizeAgentStatus(agent.status) === 'IDLE').length,
    writerWorking: writers.filter((agent) => normalizeAgentStatus(agent.status) === 'WORKING').length,
    writerOffline: writers.filter((agent) => normalizeAgentStatus(agent.status) === 'OFFLINE').length,
    laneKey: laneKey ?? null,
  };
}

async function runResearchStage(
  task: Doc<'tasks'>,
  document: Awaited<ReturnType<typeof getDocumentById>>,
  skillContext: SkillContext,
  stageProfileContext: StageProfileContext
): Promise<StageRunResult> {
  const modelOverride = await resolveAgentStageModelOverride(task, 'research');
  const { provider, providerName, model, maxTokens, temperature } = await resolveProviderForStage(
    'research',
    stageProfileContext,
    modelOverride
  );

  const linkedPageContext = await resolveTaskLinkedPageCleanContent({
    taskId: String(task._id),
    projectId: task.projectId ?? null,
  }).catch(() => null);

  const pageContextBlock = linkedPageContext
    ? `Linked page clean content context:
Headings:
${linkedPageContext.headings.slice(0, 14).map((heading) => `- ${heading}`).join('\n') || '-'}

Page text excerpt:
${trimTo(linkedPageContext.text, 1600)}`
    : 'Linked page clean content context: unavailable.';

  const system = `You are a senior SEO researcher.
Return strict JSON only with this shape:
{
  "summary": string,
  "facts": string[],
  "statistics": [{"stat": string, "source"?: string}],
  "sources": [{"url": string, "title"?: string}]
}
Keep facts specific, concise, and production-safe.`;

  const user = `Topic: ${task.title}
Description: ${task.description || ''}
Target keyword: ${document.targetKeyword || task.title}
${pageContextBlock}

Produce a concise research brief for content production.`;

  const fullUserPrompt = composeStageUserPrompt(
    user,
    stageProfileContext.promptText,
    skillContext.promptText
  );

  const raw = await collectStreamText(
    provider.stream({
      model,
      system,
      messages: [{ role: 'user', content: fullUserPrompt }],
      maxTokens,
      temperature,
    })
  );

  const parsed = parseJsonObject<{
    summary?: unknown;
    facts?: unknown;
    statistics?: unknown;
    sources?: unknown;
  }>(raw);

  const summary = String(parsed.summary ?? '').trim() || 'Research brief generated.';
  const facts = parseStringArray(parsed.facts, 8);

  const statistics = Array.isArray(parsed.statistics)
    ? parsed.statistics
        .map((item) => {
          if (!item || typeof item !== 'object') return null;
          const stat = String((item as { stat?: unknown }).stat ?? '').trim();
          const source = String((item as { source?: unknown }).source ?? '').trim();
          if (!stat) return null;
          return {
            stat,
            ...(source ? { source } : {}),
          };
        })
        .filter((item): item is { stat: string; source?: string } => Boolean(item))
        .slice(0, 8)
    : [];

  const sources = Array.isArray(parsed.sources)
    ? parsed.sources
        .map((item) => {
          if (!item || typeof item !== 'object') return null;
          const url = String((item as { url?: unknown }).url ?? '').trim();
          if (!url) return null;
          const title = String((item as { title?: unknown }).title ?? '').trim();
          return {
            url,
            ...(title ? { title } : {}),
          };
        })
        .filter((item): item is { url: string; title?: string } => Boolean(item))
        .slice(0, 8)
    : [];

  const serpIntelKeyword = String(document.targetKeyword || task.title || '').trim();
  const serpIntelSnapshot = await loadSerpIntelNonBlocking({
    keyword: serpIntelKeyword,
    projectId: task.projectId ?? null,
  });

  const existingResearch =
    document.researchSnapshot && typeof document.researchSnapshot === 'object'
      ? (document.researchSnapshot as Record<string, unknown>)
      : {};

  const researchSnapshot = {
    ...existingResearch,
    summary,
    facts,
    statistics,
    sources,
    seoIntel: serpIntelSnapshot ?? existingResearch.seoIntel,
    analyzedAt: Date.now(),
  };

  await db
    .update(documents)
    .set({
      researchSnapshot,
      updatedAt: dbNow(),
    })
    .where(eq(documents.id, document.id));

  const bodyLines: string[] = [summary];
  if (facts.length > 0) {
    bodyLines.push('', 'Facts:', ...facts.map((fact) => `- ${fact}`));
  }
  if (statistics.length > 0) {
    bodyLines.push('', 'Statistics:', ...statistics.map((stat) => `- ${stat.stat}${stat.source ? ` (${stat.source})` : ''}`));
  }
  if (serpIntelSnapshot) {
    bodyLines.push(
      '',
      'SERP context (keyword intel):',
      `- Provider: ${serpIntelSnapshot.provider}`,
      `- Competitors: ${serpIntelSnapshot.competitors.length}`,
      `- Entities: ${serpIntelSnapshot.entities
        .slice(0, 8)
        .map((item) => item.term)
        .join(', ') || 'none'}`,
      `- Related terms: ${serpIntelSnapshot.lsiKeywords
        .slice(0, 10)
        .map((item) => item.term)
        .join(', ') || 'none'}`
    );
  }

  const summaryWithIntel = serpIntelSnapshot
    ? `Research completed (${facts.length} facts, ${sources.length} sources). SERP intel linked (${serpIntelSnapshot.entities.length} entities, ${serpIntelSnapshot.lsiKeywords.length} related terms).`
    : `Research completed (${facts.length} facts, ${sources.length} sources).`;

  return {
    summary: summaryWithIntel,
    artifactTitle: 'Research Brief',
    artifactBody: trimTo(bodyLines.join('\n'), 4000),
    artifactData: researchSnapshot,
    model: {
      providerName,
      model,
      maxTokens,
      temperature,
    },
    deliverable: {
      type: 'research_brief',
      title: 'Research Brief',
    },
  };
}

async function runSeoIntelStage(
  task: Doc<'tasks'>,
  document: Awaited<ReturnType<typeof getDocumentById>>
): Promise<StageRunResult> {
  const keyword = String(document.targetKeyword || task.title || '').trim();
  if (!keyword) {
    throw new Error('SEO intel stage requires a target keyword or task title.');
  }

  let serpIntel:
    | Awaited<ReturnType<typeof getSerpIntelSnapshot>>
    | null = null;
  let degradedReason: string | null = null;

  try {
    serpIntel = await getSerpIntelSnapshot({
      keyword,
      projectId: task.projectId ?? undefined,
      preferFresh: true,
    });
  } catch (error) {
    degradedReason = error instanceof Error ? error.message : 'SERP providers unavailable';
  }

  const existingResearch =
    document.researchSnapshot && typeof document.researchSnapshot === 'object'
      ? (document.researchSnapshot as Record<string, unknown>)
      : {};

  const mergedResearchSnapshot = serpIntel
    ? {
        ...existingResearch,
        seoIntel: {
          ...serpIntel,
          reviewedAt: Date.now(),
        },
      }
    : {
        ...existingResearch,
        seoIntel: {
          provider: 'degraded',
          keyword,
          degraded: true,
          degradedReason: degradedReason || 'SERP intel providers failed',
          competitors: [],
          entities: [],
          lsiKeywords: [],
          suggestions: [],
          reviewedAt: Date.now(),
        },
      };

  await db
    .update(documents)
    .set({
      researchSnapshot: mergedResearchSnapshot,
      updatedAt: dbNow(),
    })
    .where(eq(documents.id, document.id));

  const competitorsPreview = serpIntel
    ? serpIntel.competitors
    .slice(0, 5)
    .map((item) => `- #${item.rank} ${item.domain} — ${item.title}`)
    .join('\n')
    : '';
  const entitiesPreview = serpIntel
    ? serpIntel.entities
    .slice(0, 8)
    .map((item) => `- ${item.term}`)
    .join('\n')
    : '';
  const lsiPreview = serpIntel
    ? serpIntel.lsiKeywords
    .slice(0, 8)
    .map((item) => `- ${item.term}`)
    .join('\n')
    : '';
  const suggestionsPreview = serpIntel
    ? serpIntel.suggestions
    .slice(0, 6)
    .map((item) => `- ${item}`)
    .join('\n')
    : '';

  const body = [
    `Provider: ${serpIntel?.provider || 'degraded'}`,
    `Keyword: ${serpIntel?.keyword || keyword}`,
    !serpIntel ? `Warning: degraded SERP intel (${degradedReason || 'provider failure'})` : null,
    '',
    'Top competitors:',
    competitorsPreview || '- none',
    '',
    'Entities:',
    entitiesPreview || '- none',
    '',
    'LSI / related terms:',
    lsiPreview || '- none',
    '',
    'Recommendations:',
    suggestionsPreview || '- none',
  ]
    .filter(Boolean)
    .join('\n');

  return {
    summary: serpIntel
      ? `SEO intel review completed (${serpIntel.competitors.length} competitors, ${serpIntel.entities.length} entities, ${serpIntel.lsiKeywords.length} related terms).`
      : `SEO intel degraded: provider unavailable (${degradedReason || 'unknown'}). Continuing with limited context.`,
    artifactTitle: serpIntel ? 'SEO Intel Brief' : 'SEO Intel Brief (Degraded)',
    artifactBody: trimTo(body, 5000),
    artifactData: serpIntel || {
      provider: 'degraded',
      keyword,
      degraded: true,
      degradedReason: degradedReason || 'provider failure',
      competitors: [],
      entities: [],
      lsiKeywords: [],
      suggestions: [],
    },
    model: {
      providerName: serpIntel?.provider || 'degraded',
      model: serpIntel ? 'serp-intel' : 'serp-intel-degraded',
      maxTokens: 0,
      temperature: 0,
    },
    deliverable: {
      type: 'seo_brief',
      title: 'SEO Intel Brief',
    },
  };
}

async function runOutlineStage(
  task: Doc<'tasks'>,
  document: Awaited<ReturnType<typeof getDocumentById>>,
  skillContext: SkillContext,
  stageProfileContext: StageProfileContext
): Promise<StageRunResult> {
  const modelOverride = await resolveAgentStageModelOverride(task, 'outline_build');
  const { provider, providerName, model, maxTokens, temperature } = await resolveProviderForStage(
    'outline_build',
    stageProfileContext,
    modelOverride
  );
  const contentFormat = normalizeContentFormat(document.contentType);
  const templatePolicy = await resolveTemplatePolicy({
    projectId: task.projectId ?? null,
    contentFormat,
  });

  const researchSummary = document.researchSnapshot?.summary || 'No research summary provided.';
  const researchFacts = parseStringArray(document.researchSnapshot?.facts, 8);
  const seoIntel = (document.researchSnapshot as { seoIntel?: unknown } | null)?.seoIntel as
    | {
        entities?: unknown;
        lsiKeywords?: unknown;
        competitors?: unknown;
        suggestions?: unknown;
      }
    | undefined;
  const seoEntities = parseTermArray(seoIntel?.entities, 8);
  const seoLsiKeywords = parseTermArray(seoIntel?.lsiKeywords, 10);
  const seoSuggestions = parseTermArray(seoIntel?.suggestions, 6);
  const competitorDomains = Array.isArray(seoIntel?.competitors)
    ? (seoIntel?.competitors as Array<{ domain?: unknown }>)
        .map((item) => String(item.domain ?? '').trim())
        .filter(Boolean)
        .slice(0, 6)
    : [];

  const system = `You are an SEO outliner.
Output markdown only.
Requirements:
- Start with an H1 title line.
- Provide H2 and H3 sections for a complete article.
- Include bullet goals under each major section.
- Keep it actionable for a writer.
- Use at most ${templatePolicy.outlineConstraints.maxH2} H2 sections.
- Use at most ${templatePolicy.outlineConstraints.maxH3PerH2} H3 sections under each H2.
- Keep outline sized for a final article target of ${templatePolicy.wordRange.min}-${templatePolicy.wordRange.max} words.`;

  const user = `Topic: ${task.title}
Description: ${task.description || ''}
Target keyword: ${document.targetKeyword || task.title}
Research summary: ${researchSummary}
Research facts:
${researchFacts.map((fact) => `- ${fact}`).join('\n') || '- (none)'}
SEO entities:
${seoEntities.map((term) => `- ${term}`).join('\n') || '- (none)'}
SEO related terms:
${seoLsiKeywords.map((term) => `- ${term}`).join('\n') || '- (none)'}
Top competitors:
${competitorDomains.map((domain) => `- ${domain}`).join('\n') || '- (none)'}
SEO recommendations:
${seoSuggestions.map((item) => `- ${item}`).join('\n') || '- (none)'}

Generate the production outline now.

Template policy:
- Template: ${templatePolicy.name} (${templatePolicy.key})
- Word range: ${templatePolicy.wordRange.min}-${templatePolicy.wordRange.max}
- Max H2: ${templatePolicy.outlineConstraints.maxH2}
- Max H3 per H2: ${templatePolicy.outlineConstraints.maxH3PerH2}`;

  const fullUserPrompt = composeStageUserPrompt(
    user,
    stageProfileContext.promptText,
    skillContext.promptText
  );

  const outlineRaw = await collectStreamText(
    provider.stream({
      model,
      system,
      messages: [{ role: 'user', content: fullUserPrompt }],
      maxTokens,
      temperature,
    })
  );

  const generatedOutline =
    stripCodeFences(outlineRaw) || `# ${task.title}\n\n## Introduction\n- Add key context`;
  const constrained = enforceOutlineConstraints(
    generatedOutline,
    templatePolicy.outlineConstraints
  );
  const outlineMarkdown = constrained.markdown;
  const outlineHtml = normalizeGeneratedHtml(marked.parse(outlineMarkdown, { async: false }) as string);
  const sectionCount = (outlineMarkdown.match(/^##\s+/gm) || []).length;
  const headingList = extractOutlineHeadings(outlineMarkdown);
  const outlineSnapshot = {
    markdown: outlineMarkdown,
    html: outlineHtml,
    headingCount: sectionCount,
    headings: headingList,
    generatedAt: Date.now(),
    templateKey: templatePolicy.key,
    templateName: templatePolicy.name,
    outlineConstraints: templatePolicy.outlineConstraints,
  };

  await db
    .update(documents)
    .set({
      outlineSnapshot,
      status: 'in_progress',
      updatedAt: dbNow(),
    })
    .where(eq(documents.id, document.id));

  return {
    summary: `Outline completed (${sectionCount} sections).${constrained.trimmed ? ' Trimmed to template section caps.' : ''}`,
    artifactTitle: 'Outline Draft',
    artifactBody: trimTo(outlineMarkdown, 4000),
    artifactData: {
      sections: sectionCount,
      headings: headingList,
      outlineSnapshot,
      template: {
        key: templatePolicy.key,
        name: templatePolicy.name,
        wordRange: templatePolicy.wordRange,
        outlineConstraints: templatePolicy.outlineConstraints,
      },
      constrained: constrained.trimmed,
    },
    model: {
      providerName,
      model,
      maxTokens,
      temperature,
    },
    deliverable: {
      type: 'outline',
      title: 'Outline Draft',
    },
  };
}

async function runPrewriteStage(
  task: Doc<'tasks'>,
  document: Awaited<ReturnType<typeof getDocumentById>>,
  skillContext: SkillContext,
  stageProfileContext: StageProfileContext
): Promise<StageRunResult> {
  const modelOverride = await resolveAgentStageModelOverride(task, 'prewrite_context');
  const { provider, providerName, model, maxTokens, temperature } = await resolveProviderForStage(
    'prewrite_context',
    stageProfileContext,
    modelOverride
  );
  const contentFormat = normalizeContentFormat(document.contentType);
  const templatePolicy = await resolveTemplatePolicy({
    projectId: task.projectId ?? null,
    contentFormat,
  });

  const outlineText =
    String(document.outlineSnapshot?.markdown || '').trim() ||
    stripHtml(contentToHtml(document.content, document.plainText));

  const system = `You are a project manager agent preparing content for writing.
Return strict JSON only with this shape:
{
  "brandContextReady": boolean,
  "internalLinksReady": boolean,
  "questions": string[],
  "notes": string
}`;

  const user = `Topic: ${task.title}
Description: ${task.description || ''}
Research summary: ${document.researchSnapshot?.summary || ''}
Outline excerpt: ${trimTo(outlineText, 1200)}
Template: ${templatePolicy.name} (${templatePolicy.key})
Target word range: ${templatePolicy.wordRange.min}-${templatePolicy.wordRange.max}

Produce prewrite readiness and open questions.`;

  const fullUserPrompt = composeStageUserPrompt(
    user,
    stageProfileContext.promptText,
    skillContext.promptText
  );

  const raw = await collectStreamText(
    provider.stream({
      model,
      system,
      messages: [{ role: 'user', content: fullUserPrompt }],
      maxTokens,
      temperature,
    })
  );

  const parsed = parseJsonObject<{
    brandContextReady?: unknown;
    internalLinksReady?: unknown;
    questions?: unknown;
    notes?: unknown;
  }>(raw);

  const questions = parseStringArray(parsed.questions, 10);
  const agentQuestions = questions.map((question, idx) => ({
    id: `q_${Date.now()}_${idx}`,
    question,
    status: 'open' as const,
    createdAt: Date.now(),
  }));

  const prewriteChecklist = {
    brandContextReady: Boolean(parsed.brandContextReady),
    internalLinksReady: Boolean(parsed.internalLinksReady),
    unresolvedQuestions: agentQuestions.length,
    completedAt: agentQuestions.length === 0 ? Date.now() : undefined,
  };

  await db
    .update(documents)
    .set({
      prewriteChecklist,
      agentQuestions,
      updatedAt: dbNow(),
    })
    .where(eq(documents.id, document.id));

  const notes = String(parsed.notes ?? '').trim();
  const lines = [
    notes || 'Prewrite context generated.',
    '',
    `Brand context ready: ${prewriteChecklist.brandContextReady ? 'yes' : 'no'}`,
    `Internal links ready: ${prewriteChecklist.internalLinksReady ? 'yes' : 'no'}`,
    `Unresolved questions: ${prewriteChecklist.unresolvedQuestions}`,
  ];

  if (agentQuestions.length > 0) {
    lines.push('', 'Questions:');
    lines.push(...agentQuestions.map((q) => `- ${q.question}`));
  }

  return {
    summary: `Prewrite context completed (${prewriteChecklist.unresolvedQuestions} open questions).`,
    artifactTitle: 'Prewrite Context',
    artifactBody: trimTo(lines.join('\n'), 4000),
    artifactData: {
      prewriteChecklist,
      agentQuestions,
    },
    model: {
      providerName,
      model,
      maxTokens,
      temperature,
    },
    deliverable: {
      type: 'prewrite_context',
      title: 'Prewrite Context',
    },
  };
}

async function runWritingStage(
  task: Doc<'tasks'>,
  document: Awaited<ReturnType<typeof getDocumentById>>,
  skillContext: SkillContext,
  stageProfileContext: StageProfileContext
): Promise<StageRunResult> {
  const modelOverride = await resolveAgentStageModelOverride(task, 'writing');
  const { provider, providerName, model, maxTokens, temperature } = await resolveProviderForStage(
    'writing',
    stageProfileContext,
    modelOverride
  );
  const contentFormat = normalizeContentFormat(document.contentType);
  const templatePolicy = await resolveTemplatePolicy({
    projectId: task.projectId ?? null,
    contentFormat,
  });

  const research = document.researchSnapshot?.summary || '';
  const facts = parseStringArray(document.researchSnapshot?.facts, 8);
  const stats = Array.isArray(document.researchSnapshot?.statistics)
    ? (document.researchSnapshot?.statistics as Array<{ stat?: string; source?: string }>)
        .map((s) => {
          const stat = String(s.stat ?? '').trim();
          const source = String(s.source ?? '').trim();
          if (!stat) return null;
          return `${stat}${source ? ` (${source})` : ''}`;
        })
        .filter((value): value is string => Boolean(value))
        .slice(0, 8)
    : [];
  const seoIntel = (document.researchSnapshot as { seoIntel?: unknown } | null)?.seoIntel as
    | {
        entities?: unknown;
        lsiKeywords?: unknown;
        suggestions?: unknown;
        competitors?: unknown;
      }
    | undefined;
  const seoEntities = parseTermArray(seoIntel?.entities, 8);
  const seoLsiKeywords = parseTermArray(seoIntel?.lsiKeywords, 12);
  const seoSuggestions = parseTermArray(seoIntel?.suggestions, 6);
  const competitorDomains = Array.isArray(seoIntel?.competitors)
    ? (seoIntel?.competitors as Array<{ domain?: unknown }>)
        .map((item) => String(item.domain ?? '').trim())
        .filter(Boolean)
        .slice(0, 6)
    : [];
  const outlineMarkdown = String(document.outlineSnapshot?.markdown || '').trim();
  if (!outlineMarkdown) {
    throw new Error(
      'Writing blocked: outlineSnapshot missing. Generate or approve an outline before writing.'
    );
  }
  const outlineHeadings = extractOutlineHeadings(outlineMarkdown);
  if (outlineHeadings.length === 0) {
    throw new Error(
      'Writing blocked: outlineSnapshot is invalid (no H2 sections found).'
    );
  }

  const system = `You are a senior SEO writer.
Output clean HTML only (no markdown, no code fences).
Requirements:
- Write a complete, publication-ready article.
- Respect heading hierarchy.
- Use short paragraphs and clear transitions.
- Incorporate research facts and statistics naturally.
- Do not truncate; finish the full article.
- Keep final word count between ${templatePolicy.wordRange.min} and ${templatePolicy.wordRange.max}.
- Do not use em dashes.
- Use colon only for structural heading/list label contexts.`;

  const user = `Topic: ${task.title}
Description: ${task.description || ''}
Target keyword: ${document.targetKeyword || task.title}

Research summary:
${research || '-'}

Key facts:
${facts.map((fact) => `- ${fact}`).join('\n') || '-'}

Statistics:
${stats.map((s) => `- ${s}`).join('\n') || '-'}
SEO entities to include:
${seoEntities.map((term) => `- ${term}`).join('\n') || '-'}
SEO related terms:
${seoLsiKeywords.map((term) => `- ${term}`).join('\n') || '-'}
Top competing domains:
${competitorDomains.map((domain) => `- ${domain}`).join('\n') || '-'}
SEO brief recommendations:
${seoSuggestions.map((item) => `- ${item}`).join('\n') || '-'}

Outline to follow:
${trimTo(outlineMarkdown, 2500)}

Template policy:
- Template: ${templatePolicy.name} (${templatePolicy.key})
- Word range: ${templatePolicy.wordRange.min}-${templatePolicy.wordRange.max}
- Style: em dash ${templatePolicy.styleGuard.emDash}, colon ${templatePolicy.styleGuard.colon}

Write the final article now.`;

  const fullUserPrompt = composeStageUserPrompt(
    user,
    stageProfileContext.promptText,
    skillContext.promptText
  );

  const raw = await collectStreamText(
    provider.stream({
      model,
      system,
      messages: [{ role: 'user', content: fullUserPrompt }],
      maxTokens,
      temperature,
    })
  );

  if (!raw.trim()) {
    throw new Error('Writing stage returned empty content.');
  }

  let normalizedHtml = normalizeGeneratedHtml(raw);
  let plainText = stripHtmlForCompleteness(normalizedHtml);
  let completion = evaluateWritingCompleteness({
    html: normalizedHtml,
    plainText,
    outlineHeadings,
    minimumWords: templatePolicy.wordRange.min,
    maximumWords: templatePolicy.wordRange.max,
  });

  const MAX_CONTINUATION_ATTEMPTS = 3;
  let continuationAttempts = 0;
  while (!completion.complete && continuationAttempts < MAX_CONTINUATION_ATTEMPTS) {
    continuationAttempts += 1;
    const continuationPrompt = buildContinuationPrompt({
      reasons: completion.reasons,
      missingHeadings: completion.missingHeadings,
      currentHtml: trimTo(normalizedHtml, 9000),
    });

    const continuationRaw = await collectStreamText(
      provider.stream({
        model,
        system,
        messages: [{ role: 'user', content: continuationPrompt }],
        maxTokens,
        temperature,
      })
    );

    if (!continuationRaw.trim()) {
      break;
    }

    normalizedHtml = normalizeGeneratedHtml(`${normalizedHtml}\n${continuationRaw}`);
    plainText = stripHtmlForCompleteness(normalizedHtml);
    completion = evaluateWritingCompleteness({
      html: normalizedHtml,
      plainText,
      outlineHeadings,
      minimumWords: templatePolicy.wordRange.min,
      maximumWords: templatePolicy.wordRange.max,
    });
  }

  let endingCompletionAttempted = false;
  if (
    !completion.complete &&
    completion.abruptEnding &&
    completion.reasons.length === 1
  ) {
    endingCompletionAttempted = true;
    const endingPrompt = buildEndingCompletionPrompt({
      currentHtml: trimTo(normalizedHtml, 9000),
    });
    const endingRaw = await collectStreamText(
      provider.stream({
        model,
        system,
        messages: [{ role: 'user', content: endingPrompt }],
        maxTokens,
        temperature,
      })
    );

    if (endingRaw.trim()) {
      normalizedHtml = normalizeGeneratedHtml(`${normalizedHtml}\n${endingRaw}`);
      plainText = stripHtmlForCompleteness(normalizedHtml);
      completion = evaluateWritingCompleteness({
        html: normalizedHtml,
        plainText,
        outlineHeadings,
        minimumWords: templatePolicy.wordRange.min,
        maximumWords: templatePolicy.wordRange.max,
      });
    }
  }

  let compressionAttempts = 0;
  while (
    !completion.complete &&
    completion.wordOverflow > 0 &&
    compressionAttempts < MAX_COMPRESSION_ATTEMPTS
  ) {
    compressionAttempts += 1;
    const compressionPrompt = buildCompressionPrompt({
      currentHtml: trimTo(normalizedHtml, 9000),
      minimumWords: templatePolicy.wordRange.min,
      maximumWords: templatePolicy.wordRange.max,
      missingHeadings: completion.missingHeadings,
    });

    const compressedRaw = await collectStreamText(
      provider.stream({
        model,
        system,
        messages: [{ role: 'user', content: compressionPrompt }],
        maxTokens,
        temperature,
      })
    );

    if (!compressedRaw.trim()) {
      break;
    }

    normalizedHtml = normalizeGeneratedHtml(compressedRaw);
    plainText = stripHtmlForCompleteness(normalizedHtml);
    completion = evaluateWritingCompleteness({
      html: normalizedHtml,
      plainText,
      outlineHeadings,
      minimumWords: templatePolicy.wordRange.min,
      maximumWords: templatePolicy.wordRange.max,
    });
  }

  let styleAdjusted = false;
  let styleFixAttempts = 0;
  let styleGuardResult = applyStyleGuard(normalizedHtml, templatePolicy.styleGuard);
  if (styleGuardResult.changed) {
    styleAdjusted = true;
    normalizedHtml = normalizeGeneratedHtml(styleGuardResult.html);
    plainText = stripHtmlForCompleteness(normalizedHtml);
    completion = evaluateWritingCompleteness({
      html: normalizedHtml,
      plainText,
      outlineHeadings,
      minimumWords: templatePolicy.wordRange.min,
      maximumWords: templatePolicy.wordRange.max,
    });
    styleGuardResult = applyStyleGuard(normalizedHtml, templatePolicy.styleGuard);
  }

  while (
    !styleGuardPassed(styleGuardResult.metrics, templatePolicy.styleGuard) &&
    styleFixAttempts < STYLE_FIX_MAX_ATTEMPTS
  ) {
    styleFixAttempts += 1;
    const styleFixPrompt = buildStyleFixPrompt({
      currentHtml: trimTo(normalizedHtml, 9000),
      policy: templatePolicy.styleGuard,
    });
    const styleFixRaw = await collectStreamText(
      provider.stream({
        model,
        system,
        messages: [{ role: 'user', content: styleFixPrompt }],
        maxTokens,
        temperature,
      })
    );
    if (!styleFixRaw.trim()) {
      break;
    }
    normalizedHtml = normalizeGeneratedHtml(styleFixRaw);
    const adjusted = applyStyleGuard(normalizedHtml, templatePolicy.styleGuard);
    styleAdjusted = styleAdjusted || adjusted.changed;
    normalizedHtml = normalizeGeneratedHtml(adjusted.html);
    plainText = stripHtmlForCompleteness(normalizedHtml);
    completion = evaluateWritingCompleteness({
      html: normalizedHtml,
      plainText,
      outlineHeadings,
      minimumWords: templatePolicy.wordRange.min,
      maximumWords: templatePolicy.wordRange.max,
    });
    styleGuardResult = applyStyleGuard(normalizedHtml, templatePolicy.styleGuard);
  }

  if (!styleGuardPassed(styleGuardResult.metrics, templatePolicy.styleGuard)) {
    throw new Error(
      'Writing output failed style guard validation (em dash / colon policy) after automated fix pass.'
    );
  }

  if (!completion.complete) {
    throw new IncompleteDraftError({
      message:
        `Writing output incomplete after ${continuationAttempts} continuation attempt(s)` +
        `${endingCompletionAttempted ? ' + ending recovery pass' : ''}` +
        `${compressionAttempts > 0 ? ` + compression ${compressionAttempts} attempt(s)` : ''}: ` +
        `${completion.reasons.join('; ')}`,
      completion,
      partialHtml: normalizedHtml,
      partialPlainText: plainText,
      continuationAttempts,
      endingCompletionAttempted,
    });
  }

  const wordCount = completion.wordCount;

  let aiDetectionScore: number | null = null;
  let aiRiskLevel: string | null = null;
  let contentQualityScore: number | null = null;

  try {
    if (plainText.length >= 50) {
      const { analyzeAiDetection } = await import('@/lib/analyzers/ai-detection');
      const ai = analyzeAiDetection(plainText);
      aiDetectionScore = ai.compositeScore;
      aiRiskLevel = ai.riskLevel;
    }

    if (plainText.length >= 20) {
      const { analyzeContentQuality } = await import('@/lib/analyzers/content-quality');
      const quality = analyzeContentQuality(plainText, document.contentType || 'blog_post');
      contentQualityScore = quality.score;
    }
  } catch (error) {
    console.error('Non-fatal writing stage scoring error:', error);
  }

  const previewToken = document.previewToken || randomBytes(24).toString('hex');

  await db
    .update(documents)
    .set({
      content: normalizedHtml,
      plainText,
      wordCount,
      status: 'review',
      previewToken,
      aiDetectionScore,
      aiRiskLevel,
      contentQualityScore,
      updatedAt: dbNow(),
    })
    .where(eq(documents.id, document.id));

  return {
    summary: `Writing completed (${wordCount.toLocaleString()} words).`,
    artifactTitle: 'Draft Article',
    artifactBody: trimTo(plainText, 1200),
    artifactData: {
      wordCount,
      minWordTarget: completion.minWords,
      maxWordTarget: completion.maxWords,
      headingCoverage: completion.headingCoverage,
      continuationAttempts,
      endingCompletionAttempted,
      compressionAttempts,
      styleAdjusted,
      styleMetrics: styleGuardResult.metrics,
      styleFixAttempts,
      template: {
        key: templatePolicy.key,
        name: templatePolicy.name,
      },
      aiDetectionScore,
      contentQualityScore,
      previewToken,
    },
    model: {
      providerName,
      model,
      maxTokens,
      temperature,
    },
    deliverable: {
      type: 'preview_link',
      title: `Preview: ${task.title}`,
      url: `/preview/${previewToken}`,
    },
    control: {
      styleAdjusted,
    },
  };
}

async function runEditingStage(
  task: Doc<'tasks'>,
  document: Awaited<ReturnType<typeof getDocumentById>>,
  skillContext: SkillContext,
  stageProfileContext: StageProfileContext
): Promise<StageRunResult> {
  const modelOverride = await resolveAgentStageModelOverride(task, 'editing');
  const { provider, providerName, model, maxTokens, temperature } = await resolveProviderForStage(
    'editing',
    stageProfileContext,
    modelOverride
  );
  const contentFormat = normalizeContentFormat(document.contentType);
  const templatePolicy = await resolveTemplatePolicy({
    projectId: task.projectId ?? null,
    contentFormat,
  });

  const currentHtml =
    typeof document.content === 'string'
      ? document.content
      : contentToHtml(document.content, document.plainText);
  const currentText = stripHtmlForCompleteness(currentHtml || document.plainText || '');
  if (!currentText || currentText.length < 220) {
    throw new Error('Editing blocked: draft article is missing or too short.');
  }

  const outlineMarkdown = String(document.outlineSnapshot?.markdown || '').trim();
  const outlineHeadings = extractOutlineHeadings(outlineMarkdown);

  const system = `You are a senior editor.
Return clean HTML only.
Edit for clarity, flow, and readability while preserving SEO intent.
Do not remove required outline sections.
Do not use em dashes.
Use colon only for structural heading/list-label contexts.
Keep output within ${templatePolicy.wordRange.min}-${templatePolicy.wordRange.max} words.`;

  const user = `Task title: ${task.title}
Target keyword: ${document.targetKeyword || task.title}
Template: ${templatePolicy.name} (${templatePolicy.key})

Current draft HTML:
${trimTo(currentHtml, 9000)}

Revise this draft now and return the complete edited HTML.`;

  const fullUserPrompt = composeStageUserPrompt(
    user,
    stageProfileContext.promptText,
    skillContext.promptText
  );

  const raw = await collectStreamText(
    provider.stream({
      model,
      system,
      messages: [{ role: 'user', content: fullUserPrompt }],
      maxTokens,
      temperature,
    })
  );

  if (!raw.trim()) {
    throw new Error('Editing stage returned empty content.');
  }

  let editedHtml = normalizeGeneratedHtml(raw);
  let styleAdjusted = false;
  let styleResult = applyStyleGuard(editedHtml, templatePolicy.styleGuard);
  if (styleResult.changed) {
    styleAdjusted = true;
    editedHtml = normalizeGeneratedHtml(styleResult.html);
    styleResult = applyStyleGuard(editedHtml, templatePolicy.styleGuard);
  }

  if (!styleGuardPassed(styleResult.metrics, templatePolicy.styleGuard)) {
    throw new Error('Editing output failed style guard validation.');
  }

  const editedText = stripHtmlForCompleteness(editedHtml);
  const completeness = evaluateWritingCompleteness({
    html: editedHtml,
    plainText: editedText,
    outlineHeadings,
    minimumWords: templatePolicy.wordRange.min,
    maximumWords: templatePolicy.wordRange.max,
  });
  if (!completeness.complete) {
    throw new Error(
      `Editing output incomplete: ${completeness.reasons.join('; ')}`
    );
  }

  await db
    .update(documents)
    .set({
      content: editedHtml,
      plainText: editedText,
      wordCount: completeness.wordCount,
      status: 'review',
      updatedAt: dbNow(),
    })
    .where(eq(documents.id, document.id));

  return {
    summary: `Editing completed (${completeness.wordCount.toLocaleString()} words).`,
    artifactTitle: 'Edited Draft',
    artifactBody: trimTo(editedText, 1200),
    artifactData: {
      wordCount: completeness.wordCount,
      headingCoverage: completeness.headingCoverage,
      styleAdjusted,
      styleMetrics: styleResult.metrics,
      template: {
        key: templatePolicy.key,
        name: templatePolicy.name,
      },
    },
    model: {
      providerName,
      model,
      maxTokens,
      temperature,
    },
    deliverable: {
      type: 'edited_draft',
      title: 'Edited Draft',
    },
  };
}

async function runFinalReviewStage(
  task: Doc<'tasks'>,
  document: Awaited<ReturnType<typeof getDocumentById>>,
  skillContext: SkillContext,
  stageProfileContext: StageProfileContext
): Promise<StageRunResult> {
  const modelOverride = await resolveAgentStageModelOverride(task, 'final_review');
  const { provider, providerName, model, maxTokens, temperature } = await resolveProviderForStage(
    'final_review',
    stageProfileContext,
    modelOverride
  );
  const contentFormat = normalizeContentFormat(document.contentType);
  const templatePolicy = await resolveTemplatePolicy({
    projectId: task.projectId ?? null,
    contentFormat,
  });

  const draftHtml =
    typeof document.content === 'string'
      ? document.content
      : contentToHtml(document.content, document.plainText);
  const draftText = stripHtmlForCompleteness(draftHtml || document.plainText || '');
  if (!draftText || draftText.length < 240) {
    throw new Error('Final review blocked: draft article is missing or too short.');
  }

  const outlineMarkdown = String(document.outlineSnapshot?.markdown || '').trim();
  const outlineHeadings = extractOutlineHeadings(outlineMarkdown);
  const completeness = evaluateWritingCompleteness({
    html: draftHtml,
    plainText: draftText,
    outlineHeadings,
    minimumWords: templatePolicy.wordRange.min,
    maximumWords: templatePolicy.wordRange.max,
  });

  const system = `You are a strict SEO final reviewer.
Return JSON only:
{
  "approved": boolean,
  "score": number,
  "summary": string,
  "issues": string[],
  "revisionBrief": string
}
Rules:
- Approve only if article is publish-ready.
- Validate SEO intent, heading coverage, factual clarity, and style policy compliance.
- If not approved, provide a concise revision brief focused on actionable fixes.
- Keep issue strings short and specific.`;

  const user = `Task title: ${task.title}
Target keyword: ${document.targetKeyword || task.title}
Template: ${templatePolicy.name} (${templatePolicy.key})
Expected word range: ${templatePolicy.wordRange.min}-${templatePolicy.wordRange.max}
Style policy: emDash=${templatePolicy.styleGuard.emDash}, colon=${templatePolicy.styleGuard.colon}

Automated completeness diagnostics:
- complete: ${completeness.complete ? 'yes' : 'no'}
- word count: ${completeness.wordCount}
- heading coverage: ${(completeness.headingCoverage * 100).toFixed(0)}%
- reasons: ${completeness.reasons.join('; ') || 'none'}

Research summary:
${document.researchSnapshot?.summary || '-'}

Draft excerpt:
${trimTo(draftText, 5500)}

Return your final review decision now.`;

  const fullUserPrompt = composeStageUserPrompt(
    user,
    stageProfileContext.promptText,
    skillContext.promptText
  );

  const raw = await collectStreamText(
    provider.stream({
      model,
      system,
      messages: [{ role: 'user', content: fullUserPrompt }],
      maxTokens,
      temperature,
    })
  );

  const parsed = parseJsonObject<{
    approved?: unknown;
    score?: unknown;
    summary?: unknown;
    issues?: unknown;
    revisionBrief?: unknown;
  }>(raw);

  const approved = Boolean(parsed.approved);
  const score = Number(parsed.score ?? 0);
  const issues = parseStringArray(parsed.issues, 12);
  const revisionBrief = String(parsed.revisionBrief ?? '').trim();
  const summaryText =
    String(parsed.summary ?? '').trim() ||
    (approved ? 'Final SEO review approved.' : 'Final SEO review requires revisions.');

  if (approved) {
    await db
      .update(documents)
      .set({
        status: 'accepted',
        updatedAt: dbNow(),
      })
      .where(eq(documents.id, document.id));
  }

  return {
    summary: approved
      ? `${summaryText}${Number.isFinite(score) && score > 0 ? ` Score ${Math.round(score)}.` : ''}`
      : `${summaryText}${issues.length > 0 ? ` Issues: ${issues.slice(0, 3).join('; ')}.` : ''}`,
    artifactTitle: approved ? 'Final Review: Approved' : 'Final Review: Revisions Needed',
    artifactBody: trimTo(
      [
        summaryText,
        Number.isFinite(score) && score > 0 ? `Score: ${Math.round(score)}` : null,
        issues.length > 0 ? `Issues:\n${issues.map((issue) => `- ${issue}`).join('\n')}` : null,
        revisionBrief ? `Revision brief:\n${revisionBrief}` : null,
      ]
        .filter(Boolean)
        .join('\n\n'),
      4200
    ),
    artifactData: {
      approved,
      score: Number.isFinite(score) ? score : null,
      issues,
      revisionBrief,
      completeness: {
        wordCount: completeness.wordCount,
        minWords: completeness.minWords,
        maxWords: completeness.maxWords,
        headingCoverage: completeness.headingCoverage,
        reasons: completeness.reasons,
      },
      template: {
        key: templatePolicy.key,
        name: templatePolicy.name,
      },
    },
    model: {
      providerName,
      model,
      maxTokens,
      temperature,
    },
    control: {
      approved,
      revisionBrief,
    },
  };
}

async function runStage(
  task: Doc<'tasks'>,
  document: Awaited<ReturnType<typeof getDocumentById>>,
  stage: TopicStageKey,
  skillContext: SkillContext,
  stageProfileContext: StageProfileContext
): Promise<StageRunResult> {
  if (stage === 'research') {
    return runResearchStage(task, document, skillContext, stageProfileContext);
  }

  if (stage === 'seo_intel_review') {
    return runSeoIntelStage(task, document);
  }

  if (stage === 'outline_build') {
    return runOutlineStage(task, document, skillContext, stageProfileContext);
  }

  if (stage === 'prewrite_context') {
    return runPrewriteStage(task, document, skillContext, stageProfileContext);
  }

  if (stage === 'writing') {
    return runWritingStage(task, document, skillContext, stageProfileContext);
  }

  if (stage === 'editing') {
    return runEditingStage(task, document, skillContext, stageProfileContext);
  }

  if (stage === 'final_review') {
    return runFinalReviewStage(task, document, skillContext, stageProfileContext);
  }

  throw new Error(`Stage ${stage} is not runnable.`);
}

async function resolveStageProfileContext(
  task: Doc<'tasks'>,
  stage: TopicStageKey
): Promise<StageProfileContext> {
  const role = STAGE_PRIMARY_ROLE[stage] || 'lead';
  const laneKey = resolveTaskLaneKey(task);
  if (!task.projectId) {
    return {
      role,
      laneKey,
      promptText: '',
      roleSkillIds: [],
      profileName: role,
    };
  }

  try {
    const context = await buildRolePromptContext(
      task.projectId,
      role,
      role === 'writer' ? laneKey : undefined
    );
    const laneSkillIds = await resolveRoleSkillIds(task.projectId, 'writer', laneKey);
    const roleSkillIds =
      role === 'writer'
        ? context.roleSkillIds
        : Array.from(new Set([...laneSkillIds, ...context.roleSkillIds]));
    const laneContextBlock = `Lane context: ${laneKey} (apply lane specialization for this task).`;
    const promptText = context.promptContext
      ? `${context.promptContext}\n\n${laneContextBlock}`
      : laneContextBlock;
    const stageAction = stageActionKey(stage);
    const legacyAction = legacyActionKeyForStage(stage);
    const actionKeys = Array.from(
      new Set([
        stage,
        stageAction,
        stage === 'prewrite_context' ? 'workflow_prewrite' : '',
        stage === 'prewrite_context' ? 'workflow_pm' : '',
        `${stage}_stage`,
        legacyAction,
        'workflow',
      ].filter(Boolean))
    );
    const projectRoleModelOverride = resolveProjectRoleModelOverride(context.profile, [
      ...actionKeys,
    ]);

    return {
      role,
      laneKey,
      promptText,
      roleSkillIds,
      profileName: context.profile.displayName,
      profileUpdatedAt: context.profile.updatedAt,
      projectRoleModelOverride,
    };
  } catch (error) {
    console.error('Non-fatal stage profile context load error:', error);
    return {
      role,
      laneKey,
      promptText: '',
      roleSkillIds: [],
      profileName: role,
    };
  }
}

async function recordRoleProfileActivity(
  projectId: number | null | undefined,
  role: AgentRole,
  memoryEntry: string,
  workingState?: string,
  laneKey?: AgentLaneKey
) {
  if (!projectId) return;
  try {
    await appendMemoryEntry(projectId, role, memoryEntry, { userId: null, laneKey });
    if (workingState) {
      await setWorkingState(projectId, role, workingState, { userId: null, laneKey });
    }
  } catch (error) {
    console.error('Non-fatal role profile memory update error:', error);
  }
}

export async function runTopicWorkflow(
  input: RunTopicWorkflowInput
): Promise<RunTopicWorkflowResult> {
  await ensureDb();

  const autoContinue = input.autoContinue ?? true;

  const { convex } = await getWorkflowTaskForUser(input.user, input.taskId);

  const initialTask = (await convex.query(api.tasks.get, {
    id: input.taskId,
  })) as Doc<'tasks'> | null;
  if (!initialTask) {
    throw new Error('Task not found');
  }
  const workflowOps = await getWorkflowOpsSettings(initialTask.projectId ?? null);
  const maxStages = clamp(input.maxStages ?? workflowOps.maxStagesPerRun, 1, 24);
  const finalReviewMaxRevisions = clamp(
    workflowOps.finalReviewMaxRevisions || DEFAULT_FINAL_REVIEW_MAX_REVISIONS,
    1,
    8
  );
  let currentTask: Doc<'tasks'> = initialTask;

  const runs: WorkflowStageRun[] = [];
  let stoppedReason: string | undefined;

  for (let i = 0; i < maxStages; i += 1) {
    const stage = (currentTask.workflowCurrentStageKey || 'research') as TopicStageKey;
    const runNotBeforeAt = currentTask.workflowRunNotBeforeAt ?? null;
    if (
      stage === 'research' &&
      runNotBeforeAt &&
      runNotBeforeAt > Date.now() &&
      currentTask.workflowStageStatus !== 'blocked' &&
      currentTask.workflowStageStatus !== 'queued'
    ) {
      const seconds = Math.max(1, Math.ceil((runNotBeforeAt - Date.now()) / 1000));
      const planningSummary = `Planning in progress. Research will auto-start in ~${seconds}s.`;

      await convex.mutation(api.tasks.update, {
        id: currentTask._id,
        expectedProjectId: currentTask.projectId ?? undefined,
        status: 'PENDING',
        workflowStageStatus: 'active',
        workflowLastEventAt: Date.now(),
        workflowLastEventText: planningSummary,
      });

      if (!currentTask.workflowLastEventText?.includes('Planning in progress')) {
        await convex.mutation(api.topicWorkflow.recordStageProgress, {
          taskId: currentTask._id,
          stageKey: stage,
          summary: planningSummary,
          actorType: 'system',
          actorId: input.user.id,
          actorName: 'Workflow PM',
          payload: {
            status: 'active',
            reason: 'planned_start_delay',
            runNotBeforeAt,
            remainingSeconds: seconds,
          },
        });
      }

      runs.push({ stage, summary: planningSummary });
      stoppedReason = planningSummary;
      break;
    }

    if (stage === 'complete') {
      stoppedReason = 'Workflow already complete.';
      break;
    }

    if (stage === 'human_review') {
      stoppedReason = 'Paused at human review.';
      runs.push({ stage, summary: 'Waiting for human review.' });
      break;
    }

    if (stage === 'outline_review' || stage === 'prewrite_context') {
      const bridgeSummary = `Legacy stage ${stage} bridged to writing in strict routing workflow.`;
      await convex.mutation(api.topicWorkflow.recordStageProgress, {
        taskId: currentTask._id,
        stageKey: stage,
        summary: bridgeSummary,
        actorType: 'system',
        actorId: input.user.id,
        actorName: 'Workflow PM',
        payload: {
          status: 'bridged',
          reasonCode: 'legacy_stage_bridge',
          fromStage: stage,
          toStage: 'writing',
        },
      });
      await convex.mutation(api.topicWorkflow.advanceStage, {
        taskId: currentTask._id,
        toStage: 'writing',
        actorType: 'system',
        actorId: input.user.id,
        actorName: 'Workflow PM',
        note: bridgeSummary,
      });
      runs.push({
        stage,
        summary: bridgeSummary,
        nextStage: 'writing',
      });
      const refreshedLegacy = await convex.query(api.tasks.get, {
        id: currentTask._id,
        projectId: currentTask.projectId ?? undefined,
      });
      if (!refreshedLegacy) {
        throw new Error('Task not found after legacy stage bridge.');
      }
      currentTask = refreshedLegacy;
      continue;
    }

    if (RUNNABLE_STAGES.has(stage) && !isPlannedStageEnabled(currentTask, stage)) {
      const skipSummary = `Template sequencing skipped disabled stage ${stage}.`;
      const nextFromDisabled = resolveAutoAdvance(currentTask, stage);
      if (!nextFromDisabled) {
        runs.push({ stage, summary: skipSummary });
        stoppedReason = `Stage ${stage} is disabled and has no enabled downstream stage.`;
        break;
      }

      await convex.mutation(api.topicWorkflow.recordStageProgress, {
        taskId: currentTask._id,
        stageKey: stage,
        summary: skipSummary,
        actorType: 'system',
        actorId: input.user.id,
        actorName: 'Workflow PM',
        payload: {
          status: 'skipped',
          reasonCode: 'stage_disabled_by_template',
          toStage: nextFromDisabled.toStage,
        },
      });

      await convex.mutation(api.topicWorkflow.advanceStage, {
        taskId: currentTask._id,
        toStage: nextFromDisabled.toStage,
        actorType: 'system',
        actorId: input.user.id,
        actorName: 'Workflow PM',
        note: skipSummary,
      });

      runs.push({
        stage,
        summary: skipSummary,
        nextStage: nextFromDisabled.toStage,
      });

      const refreshedAfterSkip = await convex.query(api.tasks.get, {
        id: currentTask._id,
        projectId: currentTask.projectId ?? undefined,
      });
      if (!refreshedAfterSkip) {
        throw new Error('Task not found after disabled-stage skip.');
      }
      currentTask = refreshedAfterSkip;
      continue;
    }

    if (!RUNNABLE_STAGES.has(stage)) {
      stoppedReason = `No stage runner configured for ${stage}.`;
      break;
    }

    const ensuredOwner = await convex.mutation(api.topicWorkflow.ensureStageOwner, {
      taskId: currentTask._id,
      stageKey: stage,
    });
    const ensuredOwnerResult = ensuredOwner as {
      blocked?: boolean;
      queued?: boolean;
      queueReason?: string | null;
      configuredSlotKey?: string | null;
      configuredAgentName?: string | null;
      configuredWriterStatus?: string | null;
      repairAttempted?: boolean;
      repairOutcomeCode?: string | null;
      assignedAgentId?: Id<'agents'> | null;
      assignedAgentName?: string | null;
    };
    const refreshedTaskForOwner = await convex.query(api.tasks.get, {
      id: currentTask._id,
      projectId: currentTask.projectId ?? undefined,
    });
    if (!refreshedTaskForOwner) {
      throw new Error('Task not found after stage owner enforcement.');
    }
    currentTask = refreshedTaskForOwner;
    const stageProfileContext = await resolveStageProfileContext(currentTask, stage);
    let assignedAgentIdForStage =
      ensuredOwnerResult.assignedAgentId ?? currentTask.assignedAgentId ?? null;

    const waitingStageQueue =
      (Boolean(ensuredOwnerResult.queued) || currentTask.workflowStageStatus === 'queued') &&
      !assignedAgentIdForStage;

    if (waitingStageQueue) {
      const writerAvailability =
        stage === 'writing'
          ? await getWriterAvailabilityDiagnostics(
              convex,
              currentTask.projectId ?? null,
              stageProfileContext.laneKey
            )
          : undefined;
      const queueSummary =
        stage === 'writing'
          ? `Writing queued: waiting for an available ${stageProfileContext.laneKey || 'writer'} lane writer. The task remains in writer queue and will resume when a writer is online.`
          : `Stage ${stage} queued: waiting for configured owner slot ${ensuredOwnerResult.configuredSlotKey || 'unconfigured'} to become available.`;
      await convex.mutation(api.topicWorkflow.recordStageProgress, {
        taskId: currentTask._id,
        stageKey: stage,
        summary: queueSummary,
        actorType: 'system',
        actorId: input.user.id,
        actorName: 'Workflow PM',
        payload: {
          status: 'queued',
          reason: ensuredOwnerResult.queueReason || 'configured_agent_unavailable',
          reasonCode: ensuredOwnerResult.queueReason || 'configured_agent_unavailable',
          stage,
          laneKey: stageProfileContext.laneKey ?? null,
          ownerChain: TOPIC_STAGE_OWNER_CHAINS[stage],
          configuredSlotKey: ensuredOwnerResult.configuredSlotKey ?? null,
          configuredAgentName: ensuredOwnerResult.configuredAgentName ?? null,
          configuredWriterStatus: ensuredOwnerResult.configuredWriterStatus ?? null,
          repairAttempted: Boolean(ensuredOwnerResult.repairAttempted),
          repairOutcomeCode: ensuredOwnerResult.repairOutcomeCode ?? null,
          writerAvailability,
          roleProfile: {
            role: stageProfileContext.role,
            profileName: stageProfileContext.profileName ?? null,
            profileUpdatedAt: stageProfileContext.profileUpdatedAt ?? null,
            laneKey: stageProfileContext.laneKey ?? null,
          },
        },
      });
      await recordRoleProfileActivity(
        currentTask.projectId ?? null,
        stageProfileContext.role,
        queueSummary,
        queueSummary,
        stageProfileContext.laneKey
      );
      runs.push({ stage, summary: queueSummary });
      stoppedReason = queueSummary;
      break;
    }

    if (Boolean(ensuredOwnerResult.blocked) || !assignedAgentIdForStage) {
      const writerAvailability =
        stage === 'writing'
          ? await getWriterAvailabilityDiagnostics(
              convex,
              currentTask.projectId ?? null,
              stageProfileContext.laneKey
            )
          : undefined;
      const blockedSummary =
        `Stage ${stage} blocked: no available owner` +
        `${stage === 'writing' ? ` for lane ${stageProfileContext.laneKey || 'unknown'}` : ''} in ` +
        `${(TOPIC_STAGE_OWNER_CHAINS[stage] || []).join(' -> ')}.`;
      await convex.mutation(api.topicWorkflow.recordStageProgress, {
        taskId: currentTask._id,
        stageKey: stage,
        summary: blockedSummary,
        actorType: 'system',
        actorId: input.user.id,
        actorName: 'Workflow PM',
        payload: {
          status: 'blocked',
          reason: 'assignment_blocked',
          stage,
          laneKey: stageProfileContext.laneKey ?? null,
          ownerChain: TOPIC_STAGE_OWNER_CHAINS[stage],
          writerAvailability,
          roleProfile: {
            role: stageProfileContext.role,
            profileName: stageProfileContext.profileName ?? null,
            profileUpdatedAt: stageProfileContext.profileUpdatedAt ?? null,
            laneKey: stageProfileContext.laneKey ?? null,
          },
        },
      });
      await recordRoleProfileActivity(
        currentTask.projectId ?? null,
        stageProfileContext.role,
        blockedSummary,
        blockedSummary,
        stageProfileContext.laneKey
      );
      await logAlertEvent({
        source: 'topic_workflow',
        eventType: 'assignment_blocked',
        severity: 'warning',
        projectId: currentTask.projectId ?? null,
        resourceId: String(currentTask._id),
        message: blockedSummary,
        metadata: {
          taskId: String(currentTask._id),
          stage,
          ownerChain: TOPIC_STAGE_OWNER_CHAINS[stage],
        },
      });
      runs.push({ stage, summary: blockedSummary });
      stoppedReason = blockedSummary;
      break;
    }

    let assignedAgent = await convex.query(api.agents.get, {
      id: assignedAgentIdForStage as Id<'agents'>,
    });
    const laneMismatch =
      stage === 'writing'
        ? !stageProfileContext.laneKey || assignedAgent?.laneKey !== stageProfileContext.laneKey
        : false;
    if (!assignedAgent || !isRoleAllowedForStage(stage, assignedAgent.role) || laneMismatch) {
      const reEnsuredOwner = await convex.mutation(api.topicWorkflow.ensureStageOwner, {
        taskId: currentTask._id,
        stageKey: stage,
      });
      const reEnsuredOwnerResult = reEnsuredOwner as {
        assignedAgentId?: Id<'agents'> | null;
      };
      const reAssignedAgentId = reEnsuredOwnerResult.assignedAgentId ?? null;
      if (reAssignedAgentId) {
        assignedAgentIdForStage = reAssignedAgentId;
        assignedAgent = await convex.query(api.agents.get, {
          id: reAssignedAgentId as Id<'agents'>,
        });
      }
    }
    const laneMismatchAfterHealing =
      stage === 'writing'
        ? !stageProfileContext.laneKey || assignedAgent?.laneKey !== stageProfileContext.laneKey
        : false;
    if (
      !assignedAgent ||
      !isRoleAllowedForStage(stage, assignedAgent.role) ||
      laneMismatchAfterHealing
    ) {
      const blockedSummary = laneMismatchAfterHealing
        ? `Stage ${stage} blocked: assigned writer lane ${
            assignedAgent?.laneKey || 'unknown'
          } does not match task lane ${stageProfileContext.laneKey || 'unknown'}.`
        : `Stage ${stage} blocked: assigned role ${assignedAgent?.role || 'unknown'} is not allowed for this stage.`;
      await convex.mutation(api.tasks.update, {
        id: currentTask._id,
        expectedProjectId: currentTask.projectId ?? undefined,
        workflowStageStatus: 'blocked',
        workflowLastEventAt: Date.now(),
        workflowLastEventText: blockedSummary,
      });
      await convex.mutation(api.topicWorkflow.recordStageProgress, {
        taskId: currentTask._id,
        stageKey: stage,
        summary: blockedSummary,
        actorType: 'system',
        actorId: input.user.id,
        actorName: 'Workflow PM',
        payload: {
          status: 'blocked',
          reason: laneMismatchAfterHealing ? 'owner_lane_mismatch' : 'owner_role_mismatch',
          stage,
          ownerChain: TOPIC_STAGE_OWNER_CHAINS[stage],
          assignedAgentId: assignedAgentIdForStage,
          assignedAgentName: assignedAgent?.name ?? null,
          assignedAgentRole: assignedAgent?.role ?? null,
          assignedAgentLaneKey: assignedAgent?.laneKey ?? null,
          requiredLaneKey: stageProfileContext.laneKey ?? null,
          assignmentHealingAttempted: true,
          roleProfile: {
            role: stageProfileContext.role,
            profileName: stageProfileContext.profileName ?? null,
            profileUpdatedAt: stageProfileContext.profileUpdatedAt ?? null,
            laneKey: stageProfileContext.laneKey ?? null,
          },
        },
      });
      await recordRoleProfileActivity(
        currentTask.projectId ?? null,
        stageProfileContext.role,
        blockedSummary,
        blockedSummary,
        stageProfileContext.laneKey
      );
      await logAlertEvent({
        source: 'topic_workflow',
        eventType: 'owner_role_mismatch',
        severity: 'warning',
        projectId: currentTask.projectId ?? null,
        resourceId: String(currentTask._id),
        message: blockedSummary,
        metadata: {
          taskId: String(currentTask._id),
          stage,
          assignedAgentId: assignedAgentIdForStage ?? null,
          assignedAgentRole: assignedAgent?.role ?? null,
        },
      });
      runs.push({ stage, summary: blockedSummary });
      stoppedReason = blockedSummary;
      break;
    }
    if (currentTask.assignedAgentId !== assignedAgentIdForStage) {
      await convex.mutation(api.tasks.update, {
        id: currentTask._id,
        expectedProjectId: currentTask.projectId ?? undefined,
        assignedAgentId: assignedAgentIdForStage as Id<'agents'>,
      });
      const refreshedTaskForAssigned = await convex.query(api.tasks.get, {
        id: currentTask._id,
        projectId: currentTask.projectId ?? undefined,
      });
      if (refreshedTaskForAssigned) {
        currentTask = refreshedTaskForAssigned;
      }
    }

    const ensured = await ensureTaskDocument(currentTask, input.user);
    currentTask = ensured.task;
    await convex.mutation(api.tasks.update, {
      id: currentTask._id,
      expectedProjectId: currentTask.projectId ?? undefined,
      status: 'IN_PROGRESS',
      workflowStageStatus: 'in_progress',
      workflowRunNotBeforeAt: undefined,
      startedAt: currentTask.startedAt ?? Date.now(),
    });
    const refreshedForRun = await convex.query(api.tasks.get, {
      id: currentTask._id,
      projectId: currentTask.projectId ?? undefined,
    });
    if (refreshedForRun) {
      currentTask = refreshedForRun;
    }
    const freshDocument = await getDocumentById(ensured.document.id);
    const skillContext = await buildSkillContext(currentTask, stageProfileContext.roleSkillIds);
    const agent = await setAgentWorking(convex, currentTask, assignedAgent);

    const startedSummary = agent
      ? `${agent.name} started ${stage}.`
      : `Workflow PM started ${stage}.`;

    await convex.mutation(api.topicWorkflow.recordStageProgress, {
      taskId: currentTask._id,
      stageKey: stage,
      summary: startedSummary,
      actorType: agent ? 'agent' : 'system',
      actorId: agent ? String(currentTask.assignedAgentId) : input.user.id,
      actorName: agent?.name || 'Workflow PM',
      payload: {
        status: 'started',
        stage,
        assignedAgentId: currentTask.assignedAgentId ?? null,
        assignedAgentName: agent?.name ?? null,
        assignedAgentRole: agent?.role ?? null,
        ownerChain: TOPIC_STAGE_OWNER_CHAINS[stage],
        skillNames: skillContext.names,
        skills: skillContext.applied,
        roleProfile: {
          role: stageProfileContext.role,
          profileName: stageProfileContext.profileName ?? null,
          profileUpdatedAt: stageProfileContext.profileUpdatedAt ?? null,
          laneKey: stageProfileContext.laneKey ?? null,
          mappedSkillIds: stageProfileContext.roleSkillIds,
        },
      },
    });
    await recordRoleProfileActivity(
      currentTask.projectId ?? null,
      stageProfileContext.role,
      startedSummary,
      `${startedSummary}\nTask: ${currentTask.title}`,
      stageProfileContext.laneKey
    );

    let stageResult: StageRunResult;
    try {
      stageResult = await runStage(
        currentTask,
        freshDocument,
        stage,
        skillContext,
        stageProfileContext
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const incompleteDraftError =
        error instanceof IncompleteDraftError ? error : null;
      const failedSummary = `Stage ${stage} failed: ${errorMessage}`;
      const blockedBySafety =
        stage === 'writing' &&
        /incomplete|truncat|abrupt|minimum|maximum|overflow|coverage|style guard|outlineSnapshot/i.test(
          errorMessage
        );
      if (incompleteDraftError) {
        const { completion } = incompleteDraftError;
        await convex.mutation(api.topicWorkflow.recordStageArtifact, {
          taskId: currentTask._id,
          stageKey: stage,
          summary:
            `Partial draft captured. Missing ${completion.missingHeadings.length} outline heading(s), ` +
            `word gap ${completion.wordGap}, coverage ${(completion.headingCoverage * 100).toFixed(0)}%.`,
          actorType: 'system',
          actorId: input.user.id,
          actorName: 'Workflow PM',
          artifact: {
            title: 'Partial Draft (Incomplete)',
            body: trimTo(incompleteDraftError.partialPlainText, 1800),
            data: {
              type: 'partial_draft',
              html: incompleteDraftError.partialHtml,
              reasons: completion.reasons,
              wordCount: completion.wordCount,
              minWords: completion.minWords,
              wordGap: completion.wordGap,
              headingCoverage: completion.headingCoverage,
              missingHeadings: completion.missingHeadings,
              abruptEnding: completion.abruptEnding,
              continuationAttempts: incompleteDraftError.continuationAttempts,
              endingCompletionAttempted: incompleteDraftError.endingCompletionAttempted,
            },
          },
          payload: {
            status: 'blocked',
            reason: 'writing_incomplete',
            stage,
            outlineGap: completion.outlineGap,
            roleProfile: {
              role: stageProfileContext.role,
              profileName: stageProfileContext.profileName ?? null,
              profileUpdatedAt: stageProfileContext.profileUpdatedAt ?? null,
              laneKey: stageProfileContext.laneKey ?? null,
            },
          },
        });
      }
      if (blockedBySafety) {
        await convex.mutation(api.tasks.update, {
          id: currentTask._id,
          expectedProjectId: currentTask.projectId ?? undefined,
          workflowStageStatus: 'blocked',
          workflowLastEventAt: Date.now(),
          workflowLastEventText: failedSummary,
        });
      }
      await convex.mutation(api.topicWorkflow.recordStageProgress, {
        taskId: currentTask._id,
        stageKey: stage,
        summary: failedSummary,
        actorType: 'system',
        actorId: input.user.id,
        actorName: 'Workflow PM',
        payload: {
          status: blockedBySafety ? 'blocked' : 'failed',
          stage,
          ownerChain: TOPIC_STAGE_OWNER_CHAINS[stage],
          assignedAgentId: currentTask.assignedAgentId ?? null,
          assignedAgentRole: agent?.role ?? assignedAgent?.role ?? null,
          error: errorMessage,
          reason: incompleteDraftError ? 'writing_incomplete' : undefined,
          outlineGap: incompleteDraftError?.completion.outlineGap,
          roleProfile: {
            role: stageProfileContext.role,
            profileName: stageProfileContext.profileName ?? null,
            profileUpdatedAt: stageProfileContext.profileUpdatedAt ?? null,
            laneKey: stageProfileContext.laneKey ?? null,
          },
          diagnostics: incompleteDraftError
            ? {
                missingHeadings: incompleteDraftError.completion.missingHeadings,
                headingCoverage: incompleteDraftError.completion.headingCoverage,
                wordGap: incompleteDraftError.completion.wordGap,
                abruptEnding: incompleteDraftError.completion.abruptEnding,
                continuationAttempts: incompleteDraftError.continuationAttempts,
                endingCompletionAttempted: incompleteDraftError.endingCompletionAttempted,
              }
            : undefined,
        },
      });
      await recordRoleProfileActivity(
        currentTask.projectId ?? null,
        stageProfileContext.role,
        failedSummary,
        failedSummary,
        stageProfileContext.laneKey
      );
      if (blockedBySafety) {
        await logAlertEvent({
          source: 'topic_workflow',
          eventType: incompleteDraftError
            ? 'writing_incomplete_blocked'
            : 'workflow_stage_blocked',
          severity: 'warning',
          projectId: currentTask.projectId ?? null,
          resourceId: String(currentTask._id),
          message: failedSummary,
          metadata: {
            taskId: String(currentTask._id),
            stage,
            reason: incompleteDraftError ? 'writing_incomplete' : 'stage_safety_blocked',
            outlineGap: incompleteDraftError?.completion.outlineGap,
            diagnostics: incompleteDraftError
              ? {
                  missingHeadings: incompleteDraftError.completion.missingHeadings,
                  wordGap: incompleteDraftError.completion.wordGap,
                  headingCoverage: incompleteDraftError.completion.headingCoverage,
                  abruptEnding: incompleteDraftError.completion.abruptEnding,
                }
              : undefined,
          },
        });
      }
      await setAgentOnline(convex, currentTask);
      if (blockedBySafety) {
        runs.push({ stage, summary: failedSummary });
        stoppedReason = failedSummary;
        break;
      }
      throw error;
    }

    await setAgentOnline(convex, currentTask);

    const skillsSuffix =
      skillContext.names.length > 0
        ? ` Skills applied: ${skillContext.names.join(', ')}.`
        : '';
    const stageSummary = `${stageResult.summary}${skillsSuffix}`;

    await convex.mutation(api.topicWorkflow.recordStageArtifact, {
      taskId: currentTask._id,
      stageKey: stage,
      summary: stageSummary,
      actorType: 'system',
      actorId: input.user.id,
      actorName: 'Workflow PM',
      artifact: {
        title: stageResult.artifactTitle,
        body: stageResult.artifactBody,
        data: stageResult.artifactData,
      },
      deliverable: stageResult.deliverable,
      payload: {
        status: 'completed',
        stage,
        ownerChain: TOPIC_STAGE_OWNER_CHAINS[stage],
        stageRole: agent?.role ?? null,
        assignedAgentId: currentTask.assignedAgentId ?? null,
        assignedAgentName: agent?.name ?? null,
        model: stageResult.model,
        skillNames: skillContext.names,
        skills: skillContext.applied,
        roleProfile: {
          role: stageProfileContext.role,
          profileName: stageProfileContext.profileName ?? null,
          profileUpdatedAt: stageProfileContext.profileUpdatedAt ?? null,
          laneKey: stageProfileContext.laneKey ?? null,
          mappedSkillIds: stageProfileContext.roleSkillIds,
        },
      },
    });
    await recordRoleProfileActivity(
      currentTask.projectId ?? null,
      stageProfileContext.role,
      stageSummary,
      `${stageSummary}\nTask: ${currentTask.title}`,
      stageProfileContext.laneKey
    );

    const runRecord: WorkflowStageRun = {
      stage,
      summary: stageSummary,
    };

    if (stage === 'final_review') {
      if (stageResult.control?.approved) {
        await convex.mutation(api.topicWorkflow.recordApproval, {
          taskId: currentTask._id,
          gate: 'seo_final',
          approved: true,
          actorType: 'agent',
          actorId: currentTask.assignedAgentId ? String(currentTask.assignedAgentId) : 'workflow-pm',
          actorName: agent?.name || 'Workflow PM',
          note: `Automated final SEO approval. ${stageSummary}`,
        });
        const refreshedAfterApproval = await convex.query(api.tasks.get, {
          id: currentTask._id,
          projectId: currentTask.projectId ?? undefined,
        });
        if (!refreshedAfterApproval) {
          throw new Error('Task not found after final review approval.');
        }
        currentTask = refreshedAfterApproval;
        runRecord.nextStage = (currentTask.workflowCurrentStageKey || 'human_review') as TopicStageKey;
        runs.push(runRecord);
        if ((currentTask.workflowCurrentStageKey || 'human_review') === 'human_review') {
          stoppedReason = 'Paused at human review.';
          break;
        }
        continue;
      } else {
        if (!autoContinue) {
          runs.push(runRecord);
          stoppedReason = 'Final review requested revisions.';
          break;
        }

        const revisionAttempts = await countFinalReviewAutoRevisionAttempts(
          convex,
          currentTask._id
        );
        const revisionBrief =
          stageResult.control?.revisionBrief?.trim() ||
          'Final review requested improvements. Revise clarity, SEO alignment, and completeness.';

        if (revisionAttempts >= finalReviewMaxRevisions) {
          const blockedSummary =
            `Final review retry limit reached (${finalReviewMaxRevisions}). ` +
            `Workflow blocked for PM/Admin intervention.`;
          await convex.mutation(api.tasks.update, {
            id: currentTask._id,
            expectedProjectId: currentTask.projectId ?? undefined,
            workflowStageStatus: 'blocked',
            workflowLastEventAt: Date.now(),
            workflowLastEventText: blockedSummary,
            status: 'IN_REVIEW',
          });
          await convex.mutation(api.topicWorkflow.recordStageProgress, {
            taskId: currentTask._id,
            stageKey: 'final_review',
            summary: blockedSummary,
            actorType: 'system',
            actorId: input.user.id,
            actorName: 'Workflow PM',
            payload: {
              status: 'blocked',
              reasonCode: 'final_review_retry_exhausted',
              maxRetries: finalReviewMaxRevisions,
              revisionAttempts,
              revisionBrief,
            },
          });
          await logAlertEvent({
            source: 'topic_workflow',
            eventType: 'final_review_retry_exhausted',
            severity: 'warning',
            projectId: currentTask.projectId ?? null,
            resourceId: String(currentTask._id),
            message: blockedSummary,
            metadata: {
              taskId: String(currentTask._id),
              stage: 'final_review',
              maxRetries: finalReviewMaxRevisions,
              revisionAttempts,
            },
          });
          runs.push({ ...runRecord, summary: blockedSummary });
          stoppedReason = blockedSummary;
          break;
        }

        const rerouteSummary =
          `Final review requested revision #${revisionAttempts + 1}. ` +
          `Routing back to writing.`;
        await convex.mutation(api.topicWorkflow.recordStageProgress, {
          taskId: currentTask._id,
          stageKey: 'final_review',
          summary: rerouteSummary,
          actorType: 'system',
          actorId: input.user.id,
          actorName: 'Workflow PM',
          payload: {
            status: 'revision_required',
            reasonCode: 'final_review_auto_revision',
            revisionAttempt: revisionAttempts + 1,
            maxRetries: finalReviewMaxRevisions,
            revisionBrief,
          },
        });
        await convex.mutation(api.topicWorkflow.resetFromStage, {
          taskId: currentTask._id,
          fromStage: 'writing',
          actorType: 'system',
          actorId: input.user.id,
          actorName: 'Workflow PM',
          note: `Auto-revision from final review. ${revisionBrief}`,
        });

        runRecord.nextStage = 'writing';
        runs.push(runRecord);

        const refreshedAfterRevision = await convex.query(api.tasks.get, {
          id: currentTask._id,
          projectId: currentTask.projectId ?? undefined,
        });
        if (!refreshedAfterRevision) {
          throw new Error('Task not found after final review auto-revision reset.');
        }
        currentTask = refreshedAfterRevision;
        continue;
      }
    }

    if (!autoContinue) {
      runs.push(runRecord);
      stoppedReason = 'Stopped after current stage (autoContinue=false).';
      break;
    }

    const next = resolveAutoAdvance(currentTask, stage);
    if (!next) {
      runs.push(runRecord);
      stoppedReason = `No automatic transition after ${stage}.`;
      break;
    }

    if (next.skippedStages && next.skippedStages.length > 0) {
      await convex.mutation(api.topicWorkflow.recordStageProgress, {
        taskId: currentTask._id,
        stageKey: stage,
        summary: `Template sequencing bypassed: ${next.skippedStages.join(' -> ')}.`,
        actorType: 'system',
        actorId: input.user.id,
        actorName: 'Workflow PM',
        payload: {
          status: 'skipped',
          reasonCode: 'stage_disabled_by_template',
          skippedStages: next.skippedStages,
          toStage: next.toStage,
        },
      });
    }

    await convex.mutation(api.topicWorkflow.advanceStage, {
      taskId: currentTask._id,
      toStage: next.toStage,
      actorType: 'system',
      actorId: input.user.id,
      actorName: 'Workflow PM',
      note: `${stageSummary} Moving to ${next.toStage}.`,
      skipOptionalOutlineReview: next.skipOptionalOutlineReview,
    });

    runRecord.nextStage = next.toStage;
    runs.push(runRecord);

    const refreshedTask = await convex.query(api.tasks.get, {
      id: currentTask._id,
      projectId: currentTask.projectId ?? undefined,
    });

    if (!refreshedTask) {
      throw new Error('Task not found after stage transition.');
    }

    currentTask = refreshedTask;

    const currentStage = (currentTask.workflowCurrentStageKey || 'research') as TopicStageKey;
    if (currentStage === 'human_review') {
      stoppedReason = 'Paused at human review.';
      break;
    }
    if (currentStage === 'complete') {
      stoppedReason = 'Workflow completed.';
      break;
    }
  }

  return {
    taskId: String(currentTask._id),
    currentStage: (currentTask.workflowCurrentStageKey || 'research') as TopicStageKey,
    runs,
    stoppedReason,
    documentId: currentTask.documentId,
  };
}
