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
import { TOPIC_STAGE_OWNER_CHAINS } from '@/lib/content-workflow-taxonomy';
import {
  resolveProviderForAction,
  type ModelOverride,
} from '@/lib/ai/model-resolution';
import {
  appendMemoryEntry,
  buildRolePromptContext,
  resolveProjectRoleModelOverride,
  setWorkingState,
} from '@/lib/agents/project-agent-profiles';
import { getSerpIntelSnapshot } from '@/lib/serp/serp-intel';
import { contentToHtml } from '@/lib/tiptap/to-html';
import { normalizeGeneratedHtml } from '@/lib/utils/html-normalize';
import { getConvexClient } from '@/lib/convex/server';
import {
  buildEndingCompletionPrompt,
  buildContinuationPrompt,
  evaluateWritingCompleteness,
  extractOutlineHeadings,
  stripHtmlForCompleteness,
  type WritingCompletenessResult,
} from '@/lib/workflow/writing-completeness';
import type { AgentRole } from '@/types/agent-profile';

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
  'prewrite_context',
  'writing',
]);

const ROLE_ALIASES: Record<string, string[]> = {
  researcher: ['researcher', 'seo', 'editor'],
  outliner: ['outliner', 'editor', 'writer', 'content'],
  writer: ['writer'],
  'seo-reviewer': ['seo-reviewer', 'seo', 'editor'],
  'project-manager': ['project-manager', 'lead', 'editor'],
  seo: ['seo', 'seo-reviewer', 'editor'],
  content: ['content', 'writer', 'editor'],
  lead: ['lead', 'project-manager', 'editor', 'seo-reviewer'],
};

const STAGE_PRIMARY_ROLE: Record<TopicStageKey, AgentRole> = {
  research: 'researcher',
  seo_intel_review: 'seo-reviewer',
  outline_build: 'outliner',
  outline_review: 'seo-reviewer',
  prewrite_context: 'project-manager',
  writing: 'writer',
  final_review: 'seo-reviewer',
  complete: 'lead',
};

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
  stage: TopicStageKey,
  action: 'research' | 'writing'
): Promise<ModelOverride | undefined> {
  if (!task.assignedAgentId) return undefined;

  const convex = getConvexClient();
  if (!convex) return undefined;

  const agent = await convex.query(api.agents.get, { id: task.assignedAgentId });
  const overrides = agent?.modelOverrides;
  if (!overrides) return undefined;

  return (
    overrides[stage] ||
    overrides[action] ||
    overrides[`${stage}_stage`] ||
    overrides.workflow
  );
}

function resolveAutoAdvance(
  task: Doc<'tasks'>,
  stage: TopicStageKey
): { toStage: TopicStageKey; skipOptionalOutlineReview?: boolean } | null {
  if (stage === 'research') {
    return { toStage: 'seo_intel_review' };
  }

  if (stage === 'seo_intel_review') {
    return { toStage: 'outline_build' };
  }

  if (stage === 'outline_build') {
    const outlineReviewOptional = task.workflowFlags?.outlineReviewOptional ?? true;
    if (outlineReviewOptional) {
      return {
        toStage: 'prewrite_context',
        skipOptionalOutlineReview: true,
      };
    }
    return { toStage: 'outline_review' };
  }

  if (stage === 'writing') {
    return { toStage: 'final_review' };
  }

  return null;
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

async function runResearchStage(
  task: Doc<'tasks'>,
  documentId: number,
  skillContext: SkillContext,
  stageProfileContext: StageProfileContext
): Promise<StageRunResult> {
  const modelOverride = await resolveAgentStageModelOverride(task, 'research', 'research');
  const { provider, providerName, model, maxTokens, temperature } = await resolveProviderForAction(
    'research',
    undefined,
    {
      projectRoleOverride: stageProfileContext.projectRoleModelOverride,
      agentOverride: modelOverride,
    }
  );

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
Target keyword: ${task.title}

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

  const researchSnapshot = {
    summary,
    facts,
    statistics,
    sources,
    analyzedAt: Date.now(),
  };

  await db
    .update(documents)
    .set({
      researchSnapshot,
      updatedAt: dbNow(),
    })
    .where(eq(documents.id, documentId));

  const bodyLines: string[] = [summary];
  if (facts.length > 0) {
    bodyLines.push('', 'Facts:', ...facts.map((fact) => `- ${fact}`));
  }
  if (statistics.length > 0) {
    bodyLines.push('', 'Statistics:', ...statistics.map((stat) => `- ${stat.stat}${stat.source ? ` (${stat.source})` : ''}`));
  }

  return {
    summary: `Research completed (${facts.length} facts, ${sources.length} sources).`,
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

  const serpIntel = await getSerpIntelSnapshot({
    keyword,
    projectId: task.projectId ?? undefined,
    preferFresh: true,
  });

  const existingResearch =
    document.researchSnapshot && typeof document.researchSnapshot === 'object'
      ? (document.researchSnapshot as Record<string, unknown>)
      : {};

  const mergedResearchSnapshot = {
    ...existingResearch,
    seoIntel: {
      ...serpIntel,
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

  const competitorsPreview = serpIntel.competitors
    .slice(0, 5)
    .map((item) => `- #${item.rank} ${item.domain} — ${item.title}`)
    .join('\n');
  const entitiesPreview = serpIntel.entities
    .slice(0, 8)
    .map((item) => `- ${item.term}`)
    .join('\n');
  const lsiPreview = serpIntel.lsiKeywords
    .slice(0, 8)
    .map((item) => `- ${item.term}`)
    .join('\n');
  const suggestionsPreview = serpIntel.suggestions
    .slice(0, 6)
    .map((item) => `- ${item}`)
    .join('\n');

  const body = [
    `Provider: ${serpIntel.provider}`,
    `Keyword: ${serpIntel.keyword}`,
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
  ].join('\n');

  return {
    summary:
      `SEO intel review completed (${serpIntel.competitors.length} competitors, ` +
      `${serpIntel.entities.length} entities, ${serpIntel.lsiKeywords.length} related terms).`,
    artifactTitle: 'SEO Intel Brief',
    artifactBody: trimTo(body, 5000),
    artifactData: serpIntel,
    model: {
      providerName: serpIntel.provider,
      model: 'serp-intel',
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
  const modelOverride = await resolveAgentStageModelOverride(task, 'outline_build', 'research');
  const { provider, providerName, model, maxTokens, temperature } = await resolveProviderForAction(
    'research',
    undefined,
    {
      projectRoleOverride: stageProfileContext.projectRoleModelOverride,
      agentOverride: modelOverride,
    }
  );

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
- Keep it actionable for a writer.`;

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

Generate the production outline now.`;

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

  const outlineMarkdown = stripCodeFences(outlineRaw) || `# ${task.title}\n\n## Introduction\n- Add key context`;
  const outlineHtml = normalizeGeneratedHtml(marked.parse(outlineMarkdown, { async: false }) as string);
  const sectionCount = (outlineMarkdown.match(/^##\s+/gm) || []).length;
  const headingList = extractOutlineHeadings(outlineMarkdown);
  const outlineSnapshot = {
    markdown: outlineMarkdown,
    html: outlineHtml,
    headingCount: sectionCount,
    headings: headingList,
    generatedAt: Date.now(),
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
    summary: `Outline completed (${sectionCount} sections).`,
    artifactTitle: 'Outline Draft',
    artifactBody: trimTo(outlineMarkdown, 4000),
    artifactData: {
      sections: sectionCount,
      headings: headingList,
      outlineSnapshot,
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
  const modelOverride = await resolveAgentStageModelOverride(task, 'prewrite_context', 'research');
  const { provider, providerName, model, maxTokens, temperature } = await resolveProviderForAction(
    'research',
    undefined,
    {
      projectRoleOverride: stageProfileContext.projectRoleModelOverride,
      agentOverride: modelOverride,
    }
  );

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
  const modelOverride = await resolveAgentStageModelOverride(task, 'writing', 'writing');
  const { provider, providerName, model, maxTokens, temperature } = await resolveProviderForAction(
    'writing',
    undefined,
    {
      projectRoleOverride: stageProfileContext.projectRoleModelOverride,
      agentOverride: modelOverride,
    }
  );

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
- Do not truncate; finish the full article.`;

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
      });
    }
  }

  if (!completion.complete) {
    throw new IncompleteDraftError({
      message:
        `Writing output incomplete after ${continuationAttempts} continuation attempt(s)` +
        `${endingCompletionAttempted ? ' + ending recovery pass' : ''}: ` +
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
      headingCoverage: completion.headingCoverage,
      continuationAttempts,
      endingCompletionAttempted,
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
    return runResearchStage(task, document.id, skillContext, stageProfileContext);
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

  throw new Error(`Stage ${stage} is not runnable.`);
}

async function resolveStageProfileContext(
  task: Doc<'tasks'>,
  stage: TopicStageKey
): Promise<StageProfileContext> {
  const role = STAGE_PRIMARY_ROLE[stage] || 'lead';
  if (!task.projectId) {
    return {
      role,
      promptText: '',
      roleSkillIds: [],
      profileName: role,
    };
  }

  try {
    const context = await buildRolePromptContext(task.projectId, role);
    const actionKey = stage === 'writing' ? 'writing' : 'research';
    const projectRoleModelOverride = resolveProjectRoleModelOverride(context.profile, [
      stage,
      `${stage}_stage`,
      actionKey,
      'workflow',
    ]);

    return {
      role,
      promptText: context.promptContext,
      roleSkillIds: context.roleSkillIds,
      profileName: context.profile.displayName,
      profileUpdatedAt: context.profile.updatedAt,
      projectRoleModelOverride,
    };
  } catch (error) {
    console.error('Non-fatal stage profile context load error:', error);
    return {
      role,
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
  workingState?: string
) {
  if (!projectId) return;
  try {
    await appendMemoryEntry(projectId, role, memoryEntry, null);
    if (workingState) {
      await setWorkingState(projectId, role, workingState, null);
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
  const maxStages = clamp(input.maxStages ?? 6, 1, 10);

  const { convex } = await getWorkflowTaskForUser(input.user, input.taskId);

  let currentTask = (await convex.query(api.tasks.get, { id: input.taskId })) as Doc<'tasks'> | null;
  if (!currentTask) {
    throw new Error('Task not found');
  }

  const runs: WorkflowStageRun[] = [];
  let stoppedReason: string | undefined;

  for (let i = 0; i < maxStages; i += 1) {
    const stage = (currentTask.workflowCurrentStageKey || 'research') as TopicStageKey;

    if (stage === 'complete') {
      stoppedReason = 'Workflow already complete.';
      break;
    }

    if (stage === 'outline_review') {
      stoppedReason = 'Waiting for outline approvals.';
      break;
    }

    if (stage === 'final_review') {
      stoppedReason = 'Waiting for final SEO review.';
      break;
    }

    if (!RUNNABLE_STAGES.has(stage)) {
      stoppedReason = `No stage runner configured for ${stage}.`;
      break;
    }

    const ensuredOwner = await convex.mutation(api.topicWorkflow.ensureStageOwner, {
      taskId: currentTask._id,
      stageKey: stage,
    });
    const refreshedTaskForOwner = await convex.query(api.tasks.get, {
      id: currentTask._id,
      projectId: currentTask.projectId ?? undefined,
    });
    if (!refreshedTaskForOwner) {
      throw new Error('Task not found after stage owner enforcement.');
    }
    currentTask = refreshedTaskForOwner;
    const stageProfileContext = await resolveStageProfileContext(currentTask, stage);

    const waitingWriterQueue =
      stage === 'writing' &&
      (ensuredOwner.queued || currentTask.workflowStageStatus === 'queued') &&
      !currentTask.assignedAgentId;

    if (waitingWriterQueue) {
      const queueSummary =
        'Writing queued: waiting for an available writer. The task remains in writer queue and will resume when a writer is online.';
      await convex.mutation(api.topicWorkflow.recordStageProgress, {
        taskId: currentTask._id,
        stageKey: stage,
        summary: queueSummary,
        actorType: 'system',
        actorId: input.user.id,
        actorName: 'Workflow PM',
        payload: {
          status: 'queued',
          reason: 'writer_queue_waiting',
          stage,
          ownerChain: TOPIC_STAGE_OWNER_CHAINS[stage],
          roleProfile: {
            role: stageProfileContext.role,
            profileName: stageProfileContext.profileName ?? null,
            profileUpdatedAt: stageProfileContext.profileUpdatedAt ?? null,
          },
        },
      });
      await recordRoleProfileActivity(
        currentTask.projectId ?? null,
        stageProfileContext.role,
        queueSummary,
        queueSummary
      );
      runs.push({ stage, summary: queueSummary });
      stoppedReason = queueSummary;
      break;
    }

    if (ensuredOwner.blocked || !currentTask.assignedAgentId) {
      const blockedSummary =
        `Stage ${stage} blocked: no available owner in ` +
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
          ownerChain: TOPIC_STAGE_OWNER_CHAINS[stage],
          roleProfile: {
            role: stageProfileContext.role,
            profileName: stageProfileContext.profileName ?? null,
            profileUpdatedAt: stageProfileContext.profileUpdatedAt ?? null,
          },
        },
      });
      await recordRoleProfileActivity(
        currentTask.projectId ?? null,
        stageProfileContext.role,
        blockedSummary,
        blockedSummary
      );
      runs.push({ stage, summary: blockedSummary });
      stoppedReason = blockedSummary;
      break;
    }

    const assignedAgent = await convex.query(api.agents.get, {
      id: currentTask.assignedAgentId,
    });
    if (!assignedAgent || !isRoleAllowedForStage(stage, assignedAgent.role)) {
      const blockedSummary = `Stage ${stage} blocked: assigned role ${assignedAgent?.role || 'unknown'} is not allowed for this stage.`;
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
          reason: 'owner_role_mismatch',
          stage,
          ownerChain: TOPIC_STAGE_OWNER_CHAINS[stage],
          assignedAgentId: currentTask.assignedAgentId,
          assignedAgentName: assignedAgent?.name ?? null,
          assignedAgentRole: assignedAgent?.role ?? null,
          roleProfile: {
            role: stageProfileContext.role,
            profileName: stageProfileContext.profileName ?? null,
            profileUpdatedAt: stageProfileContext.profileUpdatedAt ?? null,
          },
        },
      });
      await recordRoleProfileActivity(
        currentTask.projectId ?? null,
        stageProfileContext.role,
        blockedSummary,
        blockedSummary
      );
      runs.push({ stage, summary: blockedSummary });
      stoppedReason = blockedSummary;
      break;
    }

    const ensured = await ensureTaskDocument(currentTask, input.user);
    currentTask = ensured.task;
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
          mappedSkillIds: stageProfileContext.roleSkillIds,
        },
      },
    });
    await recordRoleProfileActivity(
      currentTask.projectId ?? null,
      stageProfileContext.role,
      startedSummary,
      `${startedSummary}\nTask: ${currentTask.title}`
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
        /incomplete|truncat|abrupt|minimum|coverage/i.test(errorMessage);
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
        failedSummary
      );
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
          mappedSkillIds: stageProfileContext.roleSkillIds,
        },
      },
    });
    await recordRoleProfileActivity(
      currentTask.projectId ?? null,
      stageProfileContext.role,
      stageSummary,
      `${stageSummary}\nTask: ${currentTask.title}`
    );

    const runRecord: WorkflowStageRun = {
      stage,
      summary: stageSummary,
    };

    if (!autoContinue) {
      runs.push(runRecord);
      stoppedReason = 'Stopped after current stage (autoContinue=false).';
      break;
    }

    const next = resolveAutoAdvance(currentTask, stage);
    if (!next) {
      runs.push(runRecord);
      if (stage === 'prewrite_context') {
        stoppedReason = 'Prewrite complete. Waiting for explicit approval to start writing.';
      } else {
        stoppedReason = `No automatic transition after ${stage}.`;
      }
      break;
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
    if (currentStage === 'outline_review') {
      stoppedReason = 'Waiting for outline approvals.';
      break;
    }
    if (currentStage === 'final_review') {
      stoppedReason = 'Waiting for final SEO review.';
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
