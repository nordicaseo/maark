import { NextRequest, NextResponse } from 'next/server';
import { db, ensureDb } from '@/db';
import { documents, documentComments } from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import { getProviderForAction } from '@/lib/ai';
import { PerplexityProvider } from '@/lib/ai/providers/perplexity';
import { dbNow } from '@/db/utils';

/**
 * POST /api/agent/process-feedback
 * When a task in IN_REVIEW has unresolved comments, the agent processes
 * them and revises the article.
 *
 * Flow:
 *  1. Fetch document + unresolved comments
 *  2. Optionally query Perplexity for research
 *  3. Revise article via AI
 *  4. Save revised content
 *  5. Mark comments as resolved
 *  6. Run quality checks
 *  7. Return updated metrics
 *
 * Body: {
 *   taskId: string (Convex ID),
 *   documentId: number (Drizzle ID),
 *   useResearch?: boolean,
 * }
 */
export async function POST(req: NextRequest) {
  try {
    const { taskId, documentId, useResearch } = await req.json();

    if (!taskId || !documentId) {
      return NextResponse.json(
        { error: 'taskId and documentId are required' },
        { status: 400 }
      );
    }

    await ensureDb();

    // ─── Step 1: Fetch document ─────────────────────────────────────
    const [doc] = await db
      .select()
      .from(documents)
      .where(eq(documents.id, documentId))
      .limit(1);

    if (!doc) {
      return NextResponse.json(
        { error: 'Document not found' },
        { status: 404 }
      );
    }

    // ─── Step 2: Fetch unresolved comments ──────────────────────────
    const comments = await db
      .select()
      .from(documentComments)
      .where(
        and(
          eq(documentComments.documentId, documentId),
          eq(documentComments.isResolved, 0)
        )
      );

    if (comments.length === 0) {
      return NextResponse.json({
        success: true,
        taskId,
        documentId,
        message: 'No unresolved comments to process',
        revisionsApplied: 0,
      });
    }

    // Build comment instructions
    const commentInstructions = comments
      .map((c: any, i: number) => {
        const parts = [`Comment ${i + 1}: "${c.content}"`];
        if (c.quotedText) {
          parts.push(`  Referenced text: "${c.quotedText}"`);
        }
        return parts.join('\n');
      })
      .join('\n\n');

    // ─── Step 3: Optional Perplexity research ───────────────────────
    let researchContext = '';
    if (useResearch) {
      const perplexityKey = process.env.PERPLEXITY_API_KEY;
      if (perplexityKey) {
        try {
          const perplexity = new PerplexityProvider(perplexityKey);
          const researchQuery = comments
            .map((c: any) => c.content)
            .join('. ')
            .substring(0, 500);

          const keyword = doc.targetKeyword || '';
          const query = `Research the following topics in the context of "${keyword}": ${researchQuery}. Provide specific facts, data, and statistics.`;

          researchContext = await perplexity.research(query);
        } catch (err) {
          console.error('Perplexity research error (non-fatal):', err);
        }
      }
    }

    // ─── Step 4: Revise article via AI ──────────────────────────────
    const { provider, model, maxTokens, temperature } = await getProviderForAction('writing');

    const systemPrompt = `You are an expert editor revising an article based on reviewer feedback.

Critical formatting rules:
- The article is provided in HTML format. You MUST preserve the exact HTML structure
- Do NOT add extra whitespace, blank lines, or <br> tags between sections
- Do NOT add extra <p>&nbsp;</p> or empty paragraphs between headings and content
- Keep the same heading hierarchy (h1, h2, h3) without adding spacing elements
- Only modify the specific text or sections that the comments reference
- Leave all other content EXACTLY as-is, including formatting, tags, and attributes

Instructions:
- Apply each comment's requested change to the article
- For inline comments referencing specific text, modify ONLY that specific section
- For general comments, apply changes minimally where appropriate
- Maintain the article's overall tone, style, and structure
- Output the COMPLETE revised article as clean HTML — same structure as input
- Do NOT include any meta-commentary, explanations, or markdown fences
${researchContext ? `\nResearch data to incorporate where relevant:\n${researchContext}\n` : ''}`;

    const userMessage = `Here is the article in HTML format — preserve this exact structure:

${doc.content || doc.plainText || '(No content available)'}

---

Here are the reviewer comments to address:

${commentInstructions}

Revise the article to address all comments. Output the COMPLETE article in the same HTML format as above. Do not add extra spacing or empty paragraphs.`;

    const stream = provider.stream({
      model,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
      maxTokens,
      temperature,
    });

    // Collect full response
    const reader = (stream as ReadableStream).getReader();
    const decoder = new TextDecoder();
    let revisedContent = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      revisedContent += decoder.decode(value, { stream: true });
    }

    if (!revisedContent.trim()) {
      return NextResponse.json(
        { error: 'AI generated empty revision' },
        { status: 500 }
      );
    }

    // ─── Step 5: Save revised content ───────────────────────────────
    const plainText = stripHtml(revisedContent);
    const wordCount = plainText.split(/\s+/).filter(Boolean).length;

    await db
      .update(documents)
      .set({
        content: revisedContent,
        plainText,
        wordCount,
        updatedAt: dbNow(),
      })
      .where(eq(documents.id, documentId));

    // ─── Step 6: Mark comments as resolved ──────────────────────────
    for (const comment of comments) {
      await db
        .update(documentComments)
        .set({ isResolved: 1 })
        .where(eq(documentComments.id, comment.id));
    }

    // ─── Step 7: Run quality checks ─────────────────────────────────
    let aiDetectionScore: number | null = null;
    let contentQualityScore: number | null = null;

    try {
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
          .where(eq(documents.id, documentId));
      }

      if (plainText.length >= 20) {
        const { analyzeContentQuality } = await import('@/lib/analyzers/content-quality');
        const qualityResult = analyzeContentQuality(plainText, doc.contentType || 'blog_post');
        contentQualityScore = qualityResult.score;

        await db
          .update(documents)
          .set({
            contentQualityScore: qualityResult.score,
            updatedAt: dbNow(),
          })
          .where(eq(documents.id, documentId));
      }
    } catch (err) {
      console.error('Quality check error (non-fatal):', err);
    }

    // ─── Step 8: Return result ──────────────────────────────────────
    return NextResponse.json({
      success: true,
      taskId,
      documentId,
      revisionsApplied: comments.length,
      wordCount,
      aiDetectionScore,
      contentQualityScore,
    });
  } catch (error) {
    console.error('Agent feedback processing error:', error);
    return NextResponse.json(
      { error: 'Feedback processing failed' },
      { status: 500 }
    );
  }
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
