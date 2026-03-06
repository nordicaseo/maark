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

    await ensureDb();

    if (
      existingDocId !== undefined &&
      existingDocId !== null &&
      !(await userCanAccessDocument(auth.user, Number(existingDocId)))
    ) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (
      projectId !== undefined &&
      projectId !== null &&
      !(await userCanAccessProject(auth.user, Number(projectId)))
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

    // ─── Auto-resolve skillId if not provided ─────────────────────
    let resolvedSkillId = skillId;
    if (!resolvedSkillId) {
      if (projectId) {
        // Try first skill for this project
        const [projectSkill] = await db
          .select({ id: skills.id })
          .from(skills)
          .where(eq(skills.projectId, projectId))
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
          projectId: projectId || null,
          authorId: auth.user.id,
          content: null,
          plainText: null,
        })
        .returning();
      doc = newDoc;
      docId = newDoc.id;
    }

    const effectiveProjectId =
      Number(
        (doc as { projectId?: number | null }).projectId ??
          (projectId ?? null)
      ) || null;

    let writerRolePromptContext = '';
    let writerRoleProfileName = 'Writer';
    let projectRoleOverride: ModelOverride | undefined;

    if (effectiveProjectId) {
      try {
        const writerContext = await buildRolePromptContext(effectiveProjectId, 'writer');
        writerRolePromptContext = writerContext.promptContext;
        writerRoleProfileName = writerContext.profile.displayName || writerRoleProfileName;
        projectRoleOverride = resolveProjectRoleModelOverride(writerContext.profile, [
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
          auth.user.id
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
      buildInstruction(title, description, targetKeyword, contentType),
      pageContextBlock,
    ]
      .filter(Boolean)
      .join('\n\n');

    let modelOverride: ModelOverride | undefined;
    if (agentId) {
      try {
        const convex = getConvexClient();
        if (convex) {
          const agent = await convex.query(api.agents.get, { id: agentId });
          modelOverride = agent?.modelOverrides?.writing;
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
      contentType,
      targetKeyword,
      writerRolePromptContext
    );

    if (effectiveProjectId) {
      await setWorkingState(
        effectiveProjectId,
        'writer',
        `${writerRoleProfileName} started manual writing for "${title}" (task ${String(taskId)}).`,
        auth.user.id
      );
      await appendMemoryEntry(
        effectiveProjectId,
        'writer',
        `${writerRoleProfileName} started manual writing for "${title}" using model ${model}.`,
        auth.user.id
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

    const normalizedHtml = normalizeGeneratedHtml(generatedContent);
    let plainText = stripHtmlForCompleteness(normalizedHtml);
    let completion = evaluateWritingCompleteness({
      html: normalizedHtml,
      plainText,
      outlineHeadings,
    });
    let finalHtml = normalizedHtml;
    const MAX_CONTINUATION_ATTEMPTS = 3;
    let continuationAttempts = 0;
    let endingCompletionAttempted = false;

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
        });
      }
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
          auth.user.id
        );
        await setWorkingState(
          effectiveProjectId,
          'writer',
          incompleteSummary,
          auth.user.id
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
            wordGap: completion.wordGap,
            abruptEnding: completion.abruptEnding,
            continuationAttempts,
            endingCompletionAttempted,
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
        const qualityResult = analyzeContentQuality(plainText, contentType);
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
        auth.user.id
      );
      await setWorkingState(
        effectiveProjectId,
        'writer',
        `${successSummary}\nPreview: /preview/${previewToken}`,
        auth.user.id
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
        headingCoverage: completion.headingCoverage,
      },
      endingCompletionAttempted,
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
  contentType: string
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
  parts.push('\nAim for 1500-2500 words. Output clean HTML format.');

  return parts.join('\n');
}

function buildSystemPrompt(
  skillContent: string,
  contentType: string,
  targetKeyword: string | undefined,
  rolePromptContext?: string
): string {
  const keywordStr = targetKeyword
    ? `The target keyword is "${targetKeyword}". Naturally incorporate it and related terms.`
    : '';
  const roleContext = rolePromptContext?.trim()
    ? `\n\nRole profile context:\n${rolePromptContext.trim()}`
    : '';

  if (skillContent) {
    return `${skillContent}\n\n${keywordStr}

${roleContext}

Additional writing guidelines:
- Write naturally, varying sentence length and structure
- Avoid AI cliches: "delve", "landscape", "furthermore", "moreover", "comprehensive", "it's worth noting"
- Use contractions naturally (don't, can't, won't)
- Avoid excessive adverbs (significantly, effectively, ultimately)
- When presenting comparative data, specs, pricing, or pros/cons, use HTML tables
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
- Output clean, well-structured HTML. No meta-commentary about the writing task.`;
}

function trimTo(input: string, maxChars: number): string {
  if (input.length <= maxChars) return input;
  return `${input.slice(0, maxChars).trimEnd()}…`;
}
