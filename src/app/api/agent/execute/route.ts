import { NextRequest, NextResponse } from 'next/server';
import { db, ensureDb } from '@/db';
import { documents, skills, skillParts } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { getProviderForAction } from '@/lib/ai';
import { randomBytes } from 'crypto';
import { dbNow } from '@/db/utils';
import { normalizeGeneratedHtml } from '@/lib/utils/html-normalize';

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
    } = body;

    if (!taskId || !title) {
      return NextResponse.json(
        { error: 'taskId and title are required' },
        { status: 400 }
      );
    }

    await ensureDb();

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
          content: null,
          plainText: null,
        })
        .returning();
      doc = newDoc;
      docId = newDoc.id;
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
          skillContent = parts
            .sort((a: any, b: any) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
            .map((p: any) => p.content)
            .join('\n\n');
        } else if (skill.content) {
          skillContent = skill.content;
        }
      }
    }

    // ─── Step 3: Build instruction and generate content ─────────────
    const instruction = buildInstruction(title, description, targetKeyword, contentType);

    const { provider, model, maxTokens, temperature } = await getProviderForAction('writing');

    const systemPrompt = buildSystemPrompt(skillContent, contentType, targetKeyword);

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
        { error: 'AI generated empty content' },
        { status: 500 }
      );
    }

    // ─── Step 4: Save content to document ───────────────────────────
    const normalizedHtml = normalizeGeneratedHtml(generatedContent);
    const plainText = stripHtml(normalizedHtml);
    const wordCount = plainText.split(/\s+/).filter(Boolean).length;

    await db
      .update(documents)
      .set({
        content: normalizedHtml,
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
    return NextResponse.json({
      success: true,
      taskId,
      documentId: docId,
      wordCount,
      aiDetectionScore,
      contentQualityScore,
      previewToken,
      previewUrl: `/preview/${previewToken}`,
      deliverable: {
        id: `del_${Date.now()}`,
        type: 'preview_link',
        title: `Preview: ${title}`,
        url: `/preview/${previewToken}`,
        createdAt: Date.now(),
      },
    });
  } catch (error) {
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
  targetKeyword: string | undefined
): string {
  const keywordStr = targetKeyword
    ? `The target keyword is "${targetKeyword}". Naturally incorporate it and related terms.`
    : '';

  if (skillContent) {
    return `${skillContent}\n\n${keywordStr}

Additional writing guidelines:
- Write naturally, varying sentence length and structure
- Avoid AI cliches: "delve", "landscape", "furthermore", "moreover", "comprehensive", "it's worth noting"
- Use contractions naturally (don't, can't, won't)
- Avoid excessive adverbs (significantly, effectively, ultimately)
- When presenting comparative data, specs, pricing, or pros/cons, use HTML tables
- Output clean HTML. No meta-commentary about the writing task.`;
  }

  return `You are a skilled content writer specializing in ${contentType.replace(/_/g, ' ')} content. ${keywordStr}

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

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}
