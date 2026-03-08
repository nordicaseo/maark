import { NextRequest, NextResponse } from 'next/server';
import { db, ensureDb } from '@/db';
import { documents, skills, skillParts } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { randomBytes } from 'crypto';
import { dbNow } from '@/db/utils';
import { normalizeGeneratedHtml } from '@/lib/utils/html-normalize';
import { logAlertEvent, logAuditEvent } from '@/lib/observability';
import { requireRole } from '@/lib/auth';
import { userCanAccessDocument, userCanAccessProject, userCanAccessSkill } from '@/lib/access';
import { resolveProviderForAction, type ModelOverride } from '@/lib/ai/model-resolution';
import { getConvexClient } from '@/lib/convex/server';
import { api } from '../../../../../convex/_generated/api';
import {
  appendMemoryEntry,
  buildRolePromptContext,
  resolveProjectRoleModelOverride,
  setWorkingState,
} from '@/lib/agents/project-agent-profiles';
import {
  buildEndingCompletionPrompt,
  buildContinuationPrompt,
  evaluateWritingCompleteness,
  extractOutlineHeadings,
  stripHtmlForCompleteness,
} from '@/lib/workflow/writing-completeness';
import { resolveTaskLinkedPageCleanContent } from '@/lib/pages/artifacts';
import { applyStyleGuard, styleGuardPassed } from '@/lib/workflow/style-guard';
import { resolveTemplatePolicy } from '@/lib/workflow/content-templates';
import { isAgentLaneKey, resolveLaneFromContentType } from '@/lib/content-workflow-taxonomy';
import { resolveTrustedAgentId } from '@/lib/workflow/agent-scope';
import type { ContentFormat } from '@/types/document';
import type { Id } from '../../../../../convex/_generated/dataModel';

/**
 * POST /api/agent/execute
 * Main AI agent orchestrator: takes a task and produces a complete article.
 *
 * Flow:
 *  1. Receive taskId + Convex task metadata (passed from client)
 *  2. Load or create Drizzle document
 *  3. Load Skill (if skillId provided)
 *  4. Generate content via AI
 *  5. Save content to document
 *  6. Run quality checks
 *  7. Generate preview token
 *  8. Return deliverable info for Convex task update
 *
 * Body: {
 *   taskId: string (Convex ID),
 *   title: string,
 *   description?: string,
 *   documentId?: number,
 *   projectId?: number,
 *   skillId?: number,
 *   contentType?: string,
 *   targetKeyword?: string,
 * }
 */
export async function POST(req: NextRequest) {
  const auth = await requireRole('writer');
  if (auth.error) return auth.error;

  try {
    const body = await req.json();
    const {
      taskId,
      title,
      description,
      documentId: existingDocId,
      projectId,
      skillId,
      contentType = 'blog_post',
      targetKeyword,
      agentId,
    } = body;

    if (!taskId || !title) {
      return NextResponse.json(
        { error: 'taskId and title are required' },
        { status: 400 }
      );
    }
    const taskIdString = String(taskId).trim();
    const convexTaskId = taskIdString as Id<'tasks'>;

    await ensureDb();
    const convex = getConvexClient();
    if (!convex) {
      return NextResponse.json(
        { error: 'Mission Control is not configured (Convex URL missing)' },
        { status: 500 }
      );
    }

    if (
      existingDocId !== undefined &&
      existingDocId !== null &&
      !(await userCanAccessDocument(auth.user, Number(existingDocId)))
    ) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (
      skillId !== undefined &&
      skillId !== null &&
      !(await userCanAccessSkill(auth.user, Number(skillId)))
    ) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    let taskRecord: {
      projectId?: number | null;
      assignedAgentId?: Id<'agents'> | null;
    } | null = null;
    try {
      taskRecord = await convex.query(api.tasks.get, { id: convexTaskId });
    } catch {
      return NextResponse.json({ error: 'Invalid taskId' }, { status: 400 });
    }
    if (!taskRecord) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }
    if (
      taskRecord.projectId !== undefined &&
      taskRecord.projectId !== null &&
      !(await userCanAccessProject(auth.user, Number(taskRecord.projectId)))
    ) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (
      projectId !== undefined &&
      projectId !== null &&
      taskRecord.projectId !== undefined &&
      taskRecord.projectId !== null &&
      Number(projectId) !== Number(taskRecord.projectId)
    ) {
      return NextResponse.json(
        { error: 'projectId does not match task project scope' },
        { status: 400 }
      );
    }
    const taskProjectId = Number(taskRecord.projectId ?? projectId ?? 0) || null;

    // ─── Auto-resolve skillId if not provided ─────────────────────
    let resolvedSkillId = skillId;
    if (!resolvedSkillId) {
      if (taskProjectId) {
        // Try first skill for this project
        const [projectSkill] = await db
          .select({ id: skills.id })
          .from(skills)
          .where(eq(skills.projectId, taskProjectId))
          .limit(1);
        if (projectSkill) {
          resolvedSkillId = projectSkill.id;
        }
      }
      if (!resolvedSkillId) {
        // Fallback to first global skill
        const [globalSkill] = await db
          .select({ id: skills.id })
          .from(skills)
          .where(eq(skills.isGlobal, 1))
          .limit(1);
        if (globalSkill) {
          resolvedSkillId = globalSkill.id;
        }
      }
    }

    // ─── Step 1: Load or create document ────────────────────────────
    let docId = existingDocId;
    let doc;

    if (docId) {
      const [existing] = await db
        .select()
        .from(documents)
        .where(eq(documents.id, docId))
        .limit(1);
      doc = existing;
    }

    if (!doc) {
      // Create a new document
      const [newDoc] = await db
        .insert(documents)
        .values({
          title,
          status: 'draft',
          contentType,
          targetKeyword: targetKeyword || null,
          projectId: taskProjectId,
          authorId: auth.user.id,
          content: null,
          plainText: null,
        })
        .returning();
      doc = newDoc;
      docId = newDoc.id;
    }

    if (
      doc &&
      (doc as { projectId?: number | null }).projectId !== null &&
      (doc as { projectId?: number | null }).projectId !== undefined &&
      taskRecord.projectId !== null &&
      taskRecord.projectId !== undefined &&
      Number((doc as { projectId?: number | null }).projectId) !== Number(taskRecord.projectId)
    ) {
      return NextResponse.json(
        { error: 'Document does not belong to the task project scope' },
        { status: 400 }
      );
    }

    const effectiveProjectId =
      Number(
        taskRecord.projectId ??
          (doc as { projectId?: number | null }).projectId ??
          (projectId ?? null)
      ) || null;
    const writerLaneKey = isAgentLaneKey(body.laneKey)
      ? body.laneKey
      : resolveLaneFromContentType(
          (doc as { contentType?: string | null }).contentType || contentType
        );

    let writerRolePromptContext = '';
    let writerRoleProfileName = 'Writer';
    let projectRoleOverride: ModelOverride | undefined;

    if (effectiveProjectId) {
      try {
        const writerContext = await buildRolePromptContext(
          effectiveProjectId,
          'writer',
          writerLaneKey
        );
        writerRolePromptContext = writerContext.promptContext;
        writerRoleProfileName = writerContext.profile.displayName || writerRoleProfileName;
        projectRoleOverride = resolveProjectRoleModelOverride(writerContext.profile, [
          'workflow_writing',
          'writing',
          'writing_stage',
          'workflow',
        ]);
      } catch (error) {
        console.error('Non-fatal writer role profile context load error:', error);
      }
    }

    const outlineMarkdown = String(
      (doc as { outlineSnapshot?: { markdown?: string } }).outlineSnapshot?.markdown || ''
    ).trim();
    const outlineHeadings = extractOutlineHeadings(outlineMarkdown);
    if (!outlineMarkdown || outlineHeadings.length === 0) {
      if (effectiveProjectId) {
        await appendMemoryEntry(
          effectiveProjectId,
          'writer',
          `Manual writing blocked for "${title}": outline missing or invalid.`,
          { userId: auth.user.id, laneKey: writerLaneKey }
        );
      }
      return NextResponse.json(
        {
          ok: false,
          code: 'OUTLINE_REQUIRED',
          error:
            'Outline is required before writing. Generate/approve an outline and rerun writing.',
        },
        { status: 409 }
      );
    }

    const normalizedContentType = normalizeContentFormat(
      (doc as { contentType?: string | null }).contentType || contentType
    );
    const templatePolicy = await resolveTemplatePolicy({
      projectId: effectiveProjectId ?? null,
      contentFormat: normalizedContentType,
    });

    // ─── Step 2: Load Skill (if provided or auto-resolved) ──────────
    let skillContent = '';
    if (resolvedSkillId) {
      const [skill] = await db
        .select()
        .from(skills)
        .where(eq(skills.id, resolvedSkillId))
        .limit(1);

      if (skill) {
        // Fetch skill parts and concatenate
        const parts = await db
          .select()
          .from(skillParts)
          .where(eq(skillParts.skillId, resolvedSkillId));

        if (parts.length > 0) {
          const orderedParts = (parts as Array<{ sortOrder?: number | null; content: string }>)
            .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
          skillContent = orderedParts
            .map((p) => p.content)
            .join('\n\n');
        } else if (skill.content) {
          skillContent = skill.content;
        }
      }
    }

    // ─── Step 3: Build instruction and generate content ─────────────
    const linkedPageContext = await resolveTaskLinkedPageCleanContent({
      taskId: String(taskId),
      projectId: effectiveProjectId ?? null,
    }).catch(() => null);

    const pageContextBlock = linkedPageContext
      ? `Linked page clean HTML context:
Headings:
${linkedPageContext.headings.slice(0, 12).map((heading) => `- ${heading}`).join('\n') || '-'}

Page text excerpt:
${trimTo(linkedPageContext.text, 1500)}`
      : '';

    const instruction = [
      buildInstruction(
        title,
        description,
        targetKeyword,
        normalizedContentType,
        templatePolicy.wordRange.min,
        templatePolicy.wordRange.max
      ),
      pageContextBlock,
    ]
      .filter(Boolean)
      .join('\n\n');

    let modelOverride: ModelOverride | undefined;
    const trustedAgentId = resolveTrustedAgentId({
      requestedAgentId: agentId,
      assignedAgentId: taskRecord.assignedAgentId ? String(taskRecord.assignedAgentId) : null,
    });
    if (trustedAgentId) {
      try {
        const agent = await convex.query(api.agents.get, {
          id: trustedAgentId as Id<'agents'>,
        });
        const agentProjectId =
          agent?.projectId !== undefined && agent?.projectId !== null
            ? Number(agent.projectId)
            : null;
        if (
          agent &&
          (effectiveProjectId === null || agentProjectId === null || agentProjectId === effectiveProjectId)
        ) {
          modelOverride = agent.modelOverrides?.workflow_writing || agent.modelOverrides?.writing;
        }
      } catch (error) {
        console.error('Failed to resolve agent model override:', error);
      }
    }

    const { provider, model, maxTokens, temperature } = await resolveProviderForAction(
      'writing',
      undefined,
      {
        projectRoleOverride,
        agentOverride: modelOverride,
      }
    );

    const systemPrompt = buildSystemPrompt(
      skillContent,
      normalizedContentType,
      targetKeyword,
      writerRolePromptContext,
      templatePolicy.styleGuard
    );

    if (effectiveProjectId) {
      await setWorkingState(
        effectiveProjectId,
        'writer',
        `${writerRoleProfileName} started manual writing for "${title}" (task ${String(taskId)}).`,
        { userId: auth.user.id, laneKey: writerLaneKey }
      );
      await appendMemoryEntry(
        effectiveProjectId,
        'writer',
        `${writerRoleProfileName} started manual writing for "${title}" using model ${model}.`,
        { userId: auth.user.id, laneKey: writerLaneKey }
      );
    }

    const stream = provider.stream({
      model,
      system: systemPrompt,
      messages: [{ role: 'user', content: instruction }],
      maxTokens,
      temperature,
    });

    // Collect the full streamed response
    const reader = (stream as ReadableStream).getReader();
    const decoder = new TextDecoder();
    let generatedContent = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      generatedContent += decoder.decode(value, { stream: true });
    }

    if (!generatedContent.trim()) {
      return NextResponse.json(
        { ok: false, code: 'EMPTY_DRAFT', error: 'AI generated empty content' },
        { status: 500 }
      );
    }

    let finalHtml = normalizeGeneratedHtml(generatedContent);
    let plainText = stripHtmlForCompleteness(finalHtml);
    let completion = evaluateWritingCompleteness({
      html: finalHtml,
      plainText,
      outlineHeadings,
      minimumWords: templatePolicy.wordRange.min,
      maximumWords: templatePolicy.wordRange.max,
    });
    const MAX_CONTINUATION_ATTEMPTS = 3;
    let continuationAttempts = 0;
    let endingCompletionAttempted = false;
    let compressionAttempts = 0;
    let styleAdjusted = false;
    let styleFixAttempts = 0;

    while (!completion.complete && continuationAttempts < MAX_CONTINUATION_ATTEMPTS) {
      continuationAttempts += 1;
      const continuationPrompt = buildContinuationPrompt({
        reasons: completion.reasons,
        missingHeadings: completion.missingHeadings,
        currentHtml: trimTo(finalHtml, 9000),
      });

      const continuationStream = provider.stream({
        model,
        system: systemPrompt,
        messages: [{ role: 'user', content: continuationPrompt }],
        maxTokens,
        temperature,
      });
      const continuationReader = (continuationStream as ReadableStream).getReader();
      let continuationChunk = '';
      while (true) {
        const { done, value } = await continuationReader.read();
        if (done) break;
        continuationChunk += decoder.decode(value, { stream: true });
      }
      if (!continuationChunk.trim()) {
        break;
      }
      finalHtml = normalizeGeneratedHtml(`${finalHtml}\n${continuationChunk}`);
      plainText = stripHtmlForCompleteness(finalHtml);
      completion = evaluateWritingCompleteness({
        html: finalHtml,
        plainText,
        outlineHeadings,
        minimumWords: templatePolicy.wordRange.min,
        maximumWords: templatePolicy.wordRange.max,
      });
    }

    if (
      !completion.complete &&
      completion.abruptEnding &&
      completion.reasons.length === 1
    ) {
      endingCompletionAttempted = true;
      const endingPrompt = buildEndingCompletionPrompt({
        currentHtml: trimTo(finalHtml, 9000),
      });
      const endingStream = provider.stream({
        model,
        system: systemPrompt,
        messages: [{ role: 'user', content: endingPrompt }],
        maxTokens,
        temperature,
      });
      const endingReader = (endingStream as ReadableStream).getReader();
      let endingChunk = '';
      while (true) {
        const { done, value } = await endingReader.read();
        if (done) break;
        endingChunk += decoder.decode(value, { stream: true });
      }
      if (endingChunk.trim()) {
        finalHtml = normalizeGeneratedHtml(`${finalHtml}\n${endingChunk}`);
        plainText = stripHtmlForCompleteness(finalHtml);
        completion = evaluateWritingCompleteness({
          html: finalHtml,
          plainText,
          outlineHeadings,
          minimumWords: templatePolicy.wordRange.min,
          maximumWords: templatePolicy.wordRange.max,
        });
      }
    }

    while (
      !completion.complete &&
      completion.wordOverflow > 0 &&
      compressionAttempts < 2
    ) {
      compressionAttempts += 1;
      const compressionPrompt = buildCompressionPrompt({
        currentHtml: trimTo(finalHtml, 9000),
        minimumWords: templatePolicy.wordRange.min,
        maximumWords: templatePolicy.wordRange.max,
        missingHeadings: completion.missingHeadings,
      });
      const compressionStream = provider.stream({
        model,
        system: systemPrompt,
        messages: [{ role: 'user', content: compressionPrompt }],
        maxTokens,
        temperature,
      });
      const compressionReader = (compressionStream as ReadableStream).getReader();
      let compressed = '';
      while (true) {
        const { done, value } = await compressionReader.read();
        if (done) break;
        compressed += decoder.decode(value, { stream: true });
      }
      if (!compressed.trim()) break;
      finalHtml = normalizeGeneratedHtml(compressed);
      plainText = stripHtmlForCompleteness(finalHtml);
      completion = evaluateWritingCompleteness({
        html: finalHtml,
        plainText,
        outlineHeadings,
        minimumWords: templatePolicy.wordRange.min,
        maximumWords: templatePolicy.wordRange.max,
      });
    }

    let styleResult = applyStyleGuard(finalHtml, templatePolicy.styleGuard);
    if (styleResult.changed) {
      styleAdjusted = true;
      finalHtml = normalizeGeneratedHtml(styleResult.html);
      plainText = stripHtmlForCompleteness(finalHtml);
      completion = evaluateWritingCompleteness({
        html: finalHtml,
        plainText,
        outlineHeadings,
        minimumWords: templatePolicy.wordRange.min,
        maximumWords: templatePolicy.wordRange.max,
      });
      styleResult = applyStyleGuard(finalHtml, templatePolicy.styleGuard);
    }

    while (
      !styleGuardPassed(styleResult.metrics, templatePolicy.styleGuard) &&
      styleFixAttempts < 1
    ) {
      styleFixAttempts += 1;
      const styleFixPrompt = buildStyleFixPrompt({
        currentHtml: trimTo(finalHtml, 9000),
        emDash: templatePolicy.styleGuard.emDash,
        colon: templatePolicy.styleGuard.colon,
        maxNarrativeColons: templatePolicy.styleGuard.maxNarrativeColons || 0,
      });
      const styleFixStream = provider.stream({
        model,
        system: systemPrompt,
        messages: [{ role: 'user', content: styleFixPrompt }],
        maxTokens,
        temperature,
      });
      const styleFixReader = (styleFixStream as ReadableStream).getReader();
      let fixed = '';
      while (true) {
        const { done, value } = await styleFixReader.read();
        if (done) break;
        fixed += decoder.decode(value, { stream: true });
      }
      if (!fixed.trim()) break;
      finalHtml = normalizeGeneratedHtml(fixed);
      styleResult = applyStyleGuard(finalHtml, templatePolicy.styleGuard);
      styleAdjusted = styleAdjusted || styleResult.changed;
      finalHtml = normalizeGeneratedHtml(styleResult.html);
      plainText = stripHtmlForCompleteness(finalHtml);
      completion = evaluateWritingCompleteness({
        html: finalHtml,
        plainText,
        outlineHeadings,
        minimumWords: templatePolicy.wordRange.min,
        maximumWords: templatePolicy.wordRange.max,
      });
      styleResult = applyStyleGuard(finalHtml, templatePolicy.styleGuard);
    }

    if (!styleGuardPassed(styleResult.metrics, templatePolicy.styleGuard)) {
      return NextResponse.json(
        {
          ok: false,
          code: 'STYLE_GUARD_FAILED',
          error:
            'Generated draft violates style guard policy after automated fix attempts and was not saved.',
          diagnostics: {
            styleMetrics: styleResult.metrics,
            stylePolicy: templatePolicy.styleGuard,
          },
        },
        { status: 422 }
      );
    }

    if (!completion.complete) {
      if (effectiveProjectId) {
        const incompleteSummary =
          `Manual writing incomplete for "${title}". ` +
          `Missing headings: ${completion.missingHeadings.length}, word gap: ${completion.wordGap}.`;
        await appendMemoryEntry(
          effectiveProjectId,
          'writer',
          incompleteSummary,
          { userId: auth.user.id, laneKey: writerLaneKey }
        );
        await setWorkingState(
          effectiveProjectId,
          'writer',
          incompleteSummary,
          { userId: auth.user.id, laneKey: writerLaneKey }
        );
      }
      return NextResponse.json(
        {
          ok: false,
          code: 'DRAFT_INCOMPLETE',
          error:
            'Generated draft is incomplete and was not saved to the document.',
          diagnostics: {
            reasons: completion.reasons,
            missingHeadings: completion.missingHeadings,
            headingCoverage: completion.headingCoverage,
            wordCount: completion.wordCount,
            minWords: completion.minWords,
            maxWords: completion.maxWords,
            wordGap: completion.wordGap,
            wordOverflow: completion.wordOverflow,
            abruptEnding: completion.abruptEnding,
            continuationAttempts,
            endingCompletionAttempted,
            compressionAttempts,
            styleAdjusted,
            styleFixAttempts,
          },
          partialDraft: {
            preview: trimTo(plainText, 1200),
          },
        },
        { status: 422 }
      );
    }

    // ─── Step 4: Save content to document ───────────────────────────
    const wordCount = completion.wordCount;

    await db
      .update(documents)
      .set({
        content: finalHtml,
        plainText,
        wordCount,
        status: 'draft',
        updatedAt: dbNow(),
      })
      .where(eq(documents.id, docId));

    // ─── Step 5: Run quality checks ─────────────────────────────────
    let aiDetectionScore: number | null = null;
    let contentQualityScore: number | null = null;

    try {
      // AI detection
      if (plainText.length >= 50) {
        const { analyzeAiDetection } = await import('@/lib/analyzers/ai-detection');
        const aiResult = analyzeAiDetection(plainText);
        aiDetectionScore = aiResult.compositeScore;

        await db
          .update(documents)
          .set({
            aiDetectionScore: aiResult.compositeScore,
            aiRiskLevel: aiResult.riskLevel,
            updatedAt: dbNow(),
          })
          .where(eq(documents.id, docId));
      }

      // Content quality
      if (plainText.length >= 20) {
        const { analyzeContentQuality } = await import('@/lib/analyzers/content-quality');
        const qualityResult = analyzeContentQuality(plainText, normalizedContentType);
        contentQualityScore = qualityResult.score;

        await db
          .update(documents)
          .set({
            contentQualityScore: qualityResult.score,
            updatedAt: dbNow(),
          })
          .where(eq(documents.id, docId));
      }
    } catch (err) {
      console.error('Quality check error (non-fatal):', err);
    }

    // ─── Step 6: Generate preview token ─────────────────────────────
    let previewToken = doc.previewToken;
    if (!previewToken) {
      previewToken = randomBytes(24).toString('hex');
      await db
        .update(documents)
        .set({ previewToken })
        .where(eq(documents.id, docId));
    }

    // ─── Step 7: Return result ──────────────────────────────────────
    await logAuditEvent({
      userId: auth.user.id,
      action: 'agent.execute',
      resourceType: 'document',
      resourceId: docId,
      projectId: effectiveProjectId,
      metadata: {
        taskId: String(taskId),
        skillId: resolvedSkillId ?? null,
        agentId: agentId ?? null,
        model,
        projectRoleProfile: writerRoleProfileName,
      },
    });

    if (effectiveProjectId) {
      const successSummary =
        `${writerRoleProfileName} completed manual writing for "${title}" ` +
        `(${wordCount} words, coverage ${(completion.headingCoverage * 100).toFixed(0)}%).`;
      await appendMemoryEntry(
        effectiveProjectId,
        'writer',
        successSummary,
        { userId: auth.user.id, laneKey: writerLaneKey }
      );
      await setWorkingState(
        effectiveProjectId,
        'writer',
        `${successSummary}\nPreview: /preview/${previewToken}`,
        { userId: auth.user.id, laneKey: writerLaneKey }
      );
    }

    return NextResponse.json({
      ok: true,
      code: 'DRAFT_SAVED',
      success: true,
      taskId,
      documentId: docId,
      wordCount,
      aiDetectionScore,
      contentQualityScore,
      previewToken,
      previewUrl: `/preview/${previewToken}`,
      continuationAttempts,
      completeness: {
        minWords: completion.minWords,
        maxWords: completion.maxWords,
        headingCoverage: completion.headingCoverage,
      },
      endingCompletionAttempted,
      compressionAttempts,
      styleAdjusted,
      styleFixAttempts,
      deliverable: {
        id: `del_${Date.now()}`,
        type: 'preview_link',
        title: `Preview: ${title}`,
        url: `/preview/${previewToken}`,
        createdAt: Date.now(),
      },
    });
  } catch (error) {
    await logAlertEvent({
      source: 'agent',
      eventType: 'execute_failed',
      severity: 'error',
      message: 'Agent execution failed.',
      metadata: { error: error instanceof Error ? error.message : 'Unknown error' },
    });
    console.error('Agent execution error:', error);
    return NextResponse.json(
      { error: 'Agent execution failed' },
      { status: 500 }
    );
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────

function buildInstruction(
  title: string,
  description: string | undefined,
  targetKeyword: string | undefined,
  contentType: string,
  minimumWords: number,
  maximumWords: number
): string {
  const parts = [`Write a complete ${contentType.replace(/_/g, ' ')} titled: "${title}"`];

  if (description) {
    parts.push(`\nBrief: ${description}`);
  }

  if (targetKeyword) {
    parts.push(`\nTarget keyword: ${targetKeyword}`);
    parts.push('Naturally incorporate this keyword and related terms throughout the article.');
  }

  parts.push('\nWrite a comprehensive, well-structured article. Include:');
  parts.push('- An engaging introduction');
  parts.push('- Clear section headings (H2, H3)');
  parts.push('- Substantive, detailed content in each section');
  parts.push('- Data, examples, or expert insights where appropriate');
  parts.push('- A concise conclusion');
  parts.push(`\nTarget ${minimumWords}-${maximumWords} words. Output clean HTML format.`);

  return parts.join('\n');
}

function buildSystemPrompt(
  skillContent: string,
  contentType: string,
  targetKeyword: string | undefined,
  rolePromptContext?: string,
  stylePolicy?: {
    emDash?: string;
    colon?: string;
    maxNarrativeColons?: number;
  }
): string {
  const keywordStr = targetKeyword
    ? `The target keyword is "${targetKeyword}". Naturally incorporate it and related terms.`
    : '';
  const roleContext = rolePromptContext?.trim()
    ? `\n\nRole profile context:\n${rolePromptContext.trim()}`
    : '';
  const styleRules = [
    stylePolicy?.emDash === 'forbid'
      ? '- Do not use em dash or en dash punctuation.'
      : '- Em dash usage is allowed.',
    stylePolicy?.colon === 'forbid'
      ? '- Avoid colons entirely.'
      : stylePolicy?.colon === 'structural_only'
        ? `- Use colons only in structural contexts (headings/labels). Narrative colons max ${Math.max(0, stylePolicy?.maxNarrativeColons || 0)}.`
        : '- Colon usage is allowed.',
  ].join('\n');

  if (skillContent) {
    return `${skillContent}\n\n${keywordStr}

${roleContext}

Additional writing guidelines:
- Write naturally, varying sentence length and structure
- Avoid AI cliches: "delve", "landscape", "furthermore", "moreover", "comprehensive", "it's worth noting"
- Use contractions naturally (don't, can't, won't)
- Avoid excessive adverbs (significantly, effectively, ultimately)
- When presenting comparative data, specs, pricing, or pros/cons, use HTML tables
- Prefer natural transitions without formulaic punctuation.
${styleRules}
- Output clean HTML. No meta-commentary about the writing task.`;
  }

  return `You are a skilled content writer specializing in ${contentType.replace(/_/g, ' ')} content. ${keywordStr}${roleContext}

Important writing guidelines:
- Write naturally, varying sentence length and structure
- Avoid AI cliches: "delve", "landscape", "furthermore", "moreover", "comprehensive", "it's worth noting"
- Use contractions naturally (don't, can't, won't)
- Include first-person perspective where appropriate
- Avoid excessive adverbs (significantly, effectively, ultimately)
- Don't start with "In today's..." or "In this article..."
- When presenting comparative data, specs, pricing, or pros/cons, use HTML tables
- Prefer natural transitions without formulaic punctuation.
${styleRules}
- Output clean, well-structured HTML. No meta-commentary about the writing task.`;
}

function trimTo(input: string, maxChars: number): string {
  if (input.length <= maxChars) return input;
  return `${input.slice(0, maxChars).trimEnd()}…`;
}

function normalizeContentFormat(value: string | null | undefined): ContentFormat {
  const allowed = new Set<ContentFormat>([
    'blog_post',
    'blog_listicle',
    'blog_buying_guide',
    'blog_how_to',
    'blog_review',
    'product_category',
    'product_description',
    'comparison',
    'news_article',
  ]);
  const normalized = String(value || '').trim();
  return allowed.has(normalized as ContentFormat)
    ? (normalized as ContentFormat)
    : 'blog_post';
}

function buildCompressionPrompt(args: {
  currentHtml: string;
  minimumWords: number;
  maximumWords: number;
  missingHeadings: string[];
}): string {
  return `Compress and refine this article to fit strict length constraints.

Constraints:
- Keep all required headings and section intent.
- Target total words between ${args.minimumWords} and ${args.maximumWords}.
- Remove repetition and filler transitions.
- Return clean HTML only.

Missing headings to preserve:
${args.missingHeadings.slice(0, 10).join(', ') || 'none'}

Current article HTML:
${args.currentHtml}

Return full revised article HTML.`;
}

function buildStyleFixPrompt(args: {
  currentHtml: string;
  emDash: string;
  colon: string;
  maxNarrativeColons: number;
}): string {
  const colonInstruction =
    args.colon === 'forbid'
      ? 'Remove all colons from both headings and narrative.'
      : args.colon === 'structural_only'
        ? `Keep colons only in structural heading/list-label contexts. Narrative colons max ${Math.max(0, args.maxNarrativeColons)}.`
        : 'Colon usage is allowed.';

  return `Rewrite this article HTML for style compliance.
- Replace every em dash and en dash with natural punctuation.
- ${colonInstruction}
- Preserve meaning and heading structure.
- Return clean HTML only.

Article HTML:
${args.currentHtml}`;
}
