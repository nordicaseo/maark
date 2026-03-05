import { randomBytes } from 'crypto';
import { marked } from 'marked';
import { eq } from 'drizzle-orm';
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
  resolveProviderForAction,
  type ModelOverride,
} from '@/lib/ai/model-resolution';
import { contentToHtml } from '@/lib/tiptap/to-html';
import { normalizeGeneratedHtml } from '@/lib/utils/html-normalize';
import { getConvexClient } from '@/lib/convex/server';

interface StageRunResult {
  summary: string;
  artifactTitle: string;
  artifactBody: string;
  artifactData?: unknown;
  deliverable?: {
    type: string;
    title: string;
    url?: string;
  };
}

interface SkillContext {
  names: string[];
  promptText: string;
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
  'outline_build',
  'prewrite_context',
  'writing',
]);

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

function trimTo(input: string, maxChars: number): string {
  if (input.length <= maxChars) return input;
  return `${input.slice(0, maxChars).trimEnd()}…`;
}

async function buildSkillContext(task: Doc<'tasks'>): Promise<SkillContext> {
  if (!task.projectId && !task.skillId) {
    return { names: [], promptText: '' };
  }

  const selectedSkills: Array<{
    id: number;
    name: string;
    content: string;
  }> = [];

  if (task.skillId) {
    const [explicit] = await db
      .select({
        id: skills.id,
        name: skills.name,
        content: skills.content,
      })
      .from(skills)
      .where(eq(skills.id, task.skillId))
      .limit(1);

    if (explicit) {
      selectedSkills.push(explicit);
    }
  }

  if (selectedSkills.length === 0 && task.projectId) {
    const projectSkills = await db
      .select({
        id: skills.id,
        name: skills.name,
        content: skills.content,
      })
      .from(skills)
      .where(eq(skills.projectId, task.projectId))
      .limit(3);

    selectedSkills.push(...projectSkills);
  }

  if (selectedSkills.length === 0) {
    return { names: [], promptText: '' };
  }

  const sections: string[] = [];
  const names: string[] = [];

  for (const skill of selectedSkills) {
    names.push(skill.name);
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

    const mergedContent = orderedParts.length > 0
      ? orderedParts.join('\n\n')
      : String(skill.content || '').trim();

    if (!mergedContent) continue;

    sections.push(`Skill: ${skill.name}\n${mergedContent}`);
  }

  const promptText = trimTo(sections.join('\n\n---\n\n'), 7000);
  return { names, promptText };
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

async function resolveStageModelOverride(
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

  if (stage === 'prewrite_context') {
    return { toStage: 'writing' };
  }

  if (stage === 'writing') {
    return { toStage: 'final_review' };
  }

  return null;
}

async function setAgentWorking(
  convex: ReturnType<typeof getConvexClient>,
  task: Doc<'tasks'>
) {
  if (!convex || !task.assignedAgentId) return null;

  const agent = await convex.query(api.agents.get, { id: task.assignedAgentId });
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
  skillContext: SkillContext
): Promise<StageRunResult> {
  const modelOverride = await resolveStageModelOverride(task, 'research', 'research');
  const { provider, model, maxTokens, temperature } = await resolveProviderForAction(
    'research',
    modelOverride
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

  const fullUserPrompt = skillContext.promptText
    ? `${user}\n\nProject skills and rules:\n${skillContext.promptText}`
    : user;

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
    deliverable: {
      type: 'research_brief',
      title: 'Research Brief',
    },
  };
}

async function runOutlineStage(
  task: Doc<'tasks'>,
  document: Awaited<ReturnType<typeof getDocumentById>>,
  skillContext: SkillContext
): Promise<StageRunResult> {
  const modelOverride = await resolveStageModelOverride(task, 'outline_build', 'research');
  const { provider, model, maxTokens, temperature } = await resolveProviderForAction(
    'research',
    modelOverride
  );

  const researchSummary = document.researchSnapshot?.summary || 'No research summary provided.';
  const researchFacts = parseStringArray(document.researchSnapshot?.facts, 8);

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

Generate the production outline now.`;

  const fullUserPrompt = skillContext.promptText
    ? `${user}\n\nProject skills and rules:\n${skillContext.promptText}`
    : user;

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
  const plainText = stripHtml(outlineHtml);
  const wordCount = plainText.split(/\s+/).filter(Boolean).length;

  await db
    .update(documents)
    .set({
      content: outlineHtml,
      plainText,
      wordCount,
      status: 'in_progress',
      updatedAt: dbNow(),
    })
    .where(eq(documents.id, document.id));

  const sectionCount = (outlineMarkdown.match(/^##\s+/gm) || []).length;

  return {
    summary: `Outline completed (${sectionCount} sections).`,
    artifactTitle: 'Outline Draft',
    artifactBody: trimTo(outlineMarkdown, 4000),
    artifactData: {
      sections: sectionCount,
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
  skillContext: SkillContext
): Promise<StageRunResult> {
  const modelOverride = await resolveStageModelOverride(task, 'prewrite_context', 'research');
  const { provider, model, maxTokens, temperature } = await resolveProviderForAction(
    'research',
    modelOverride
  );

  const outlineText = stripHtml(contentToHtml(document.content, document.plainText));

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

  const fullUserPrompt = skillContext.promptText
    ? `${user}\n\nProject skills and rules:\n${skillContext.promptText}`
    : user;

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
    deliverable: {
      type: 'prewrite_context',
      title: 'Prewrite Context',
    },
  };
}

async function runWritingStage(
  task: Doc<'tasks'>,
  document: Awaited<ReturnType<typeof getDocumentById>>,
  skillContext: SkillContext
): Promise<StageRunResult> {
  const modelOverride = await resolveStageModelOverride(task, 'writing', 'writing');
  const { provider, model, maxTokens, temperature } = await resolveProviderForAction(
    'writing',
    modelOverride
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
  const outline = stripHtml(contentToHtml(document.content, document.plainText));

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

Outline to follow:
${trimTo(outline, 2500)}

Write the final article now.`;

  const fullUserPrompt = skillContext.promptText
    ? `${user}\n\nProject skills and rules:\n${skillContext.promptText}`
    : user;

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

  const normalizedHtml = normalizeGeneratedHtml(raw);
  const plainText = stripHtml(normalizedHtml);
  const wordCount = plainText.split(/\s+/).filter(Boolean).length;

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
      aiDetectionScore,
      contentQualityScore,
      previewToken,
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
  skillContext: SkillContext
): Promise<StageRunResult> {
  if (stage === 'research') {
    return runResearchStage(task, document.id, skillContext);
  }

  if (stage === 'outline_build') {
    return runOutlineStage(task, document, skillContext);
  }

  if (stage === 'prewrite_context') {
    return runPrewriteStage(task, document, skillContext);
  }

  if (stage === 'writing') {
    return runWritingStage(task, document, skillContext);
  }

  throw new Error(`Stage ${stage} is not runnable.`);
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

    const ensured = await ensureTaskDocument(currentTask, input.user);
    currentTask = ensured.task;
    const freshDocument = await getDocumentById(ensured.document.id);
    const skillContext = await buildSkillContext(currentTask);
    const agent = await setAgentWorking(convex, currentTask);

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
        skillNames: skillContext.names,
      },
    });

    let stageResult: StageRunResult;
    try {
      stageResult = await runStage(currentTask, freshDocument, stage, skillContext);
    } catch (error) {
      const failedSummary = `Stage ${stage} failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
      await convex.mutation(api.topicWorkflow.recordStageProgress, {
        taskId: currentTask._id,
        stageKey: stage,
        summary: failedSummary,
        actorType: 'system',
        actorId: input.user.id,
        actorName: 'Workflow PM',
        payload: {
          status: 'failed',
          stage,
        },
      });
      await setAgentOnline(convex, currentTask);
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
    });

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
      stoppedReason = `No automatic transition after ${stage}.`;
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
