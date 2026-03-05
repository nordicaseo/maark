import { NextRequest } from 'next/server';
import { db, ensureDb } from '@/db';
import { documents, documentComments } from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import { requireRole } from '@/lib/auth';
import { getProviderForAction } from '@/lib/ai';
import { PerplexityProvider } from '@/lib/ai/providers/perplexity';
import { contentToHtml } from '@/lib/tiptap/to-html';
import { normalizeGeneratedHtml, validateRevisedHtmlOutput } from '@/lib/utils/html-normalize';
import { userCanAccessDocument } from '@/lib/access';
import { logAuditEvent } from '@/lib/observability';

/**
 * POST /api/ai/process-comments
 * AI processes unresolved comments on a document, applying edits.
 * Body: { documentId: number, commentIds?: number[], useResearch?: boolean }
 * Returns: streamed revised HTML content.
 */
export async function POST(req: NextRequest) {
  const auth = await requireRole('editor');
  if (auth.error) return auth.error;

  try {
    const { documentId, commentIds, useResearch } = await req.json();

    if (!documentId) {
      return new Response(JSON.stringify({ error: 'documentId is required' }), { status: 400 });
    }

    await ensureDb();

    if (!(await userCanAccessDocument(auth.user, Number(documentId)))) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
    }

    // Fetch document
    const [doc] = await db
      .select()
      .from(documents)
      .where(eq(documents.id, documentId))
      .limit(1);

    if (!doc) {
      return new Response(JSON.stringify({ error: 'Document not found' }), { status: 404 });
    }

    // Fetch unresolved comments
    let comments;
    if (commentIds && commentIds.length > 0) {
      comments = await db
        .select()
        .from(documentComments)
        .where(
          and(
            eq(documentComments.documentId, documentId),
            eq(documentComments.isResolved, 0)
          )
        );
      // Filter to requested IDs
      comments = comments.filter((c: { id: number }) => commentIds.includes(c.id));
    } else {
      comments = await db
        .select()
        .from(documentComments)
        .where(
          and(
            eq(documentComments.documentId, documentId),
            eq(documentComments.isResolved, 0)
          )
        );
    }

    if (comments.length === 0) {
      return new Response(JSON.stringify({ error: 'No unresolved comments to process' }), { status: 400 });
    }

    // Build comment instructions
    const commentInstructions = comments.map((c: { content: string; quotedText: string | null }, i: number) => {
      const parts = [`Comment ${i + 1}: "${c.content}"`];
      if (c.quotedText) {
        parts.push(`  Referenced text: "${c.quotedText}"`);
      }
      return parts.join('\n');
    }).join('\n\n');

    // Optional: use Perplexity for research
    let researchContext = '';
    if (useResearch) {
      const perplexityKey = process.env.PERPLEXITY_API_KEY;
      if (perplexityKey) {
        try {
          const perplexity = new PerplexityProvider(perplexityKey);
          // Extract research topics from comments
          const researchQuery = comments
            .map((c: { content: string }) => c.content)
            .join('. ')
            .substring(0, 500);

          const keyword = doc.targetKeyword || '';
          const query = `Research the following topics in the context of "${keyword}": ${researchQuery}. Provide specific facts, data, and statistics.`;

          researchContext = await perplexity.research(query);
        } catch (err) {
          console.error('Perplexity research error:', err);
          // Continue without research
        }
      }
    }

    // Get AI provider
    const { provider, model, maxTokens, temperature } = await getProviderForAction('writing');

    const sourceHtml = contentToHtml(doc.content, doc.plainText) || '(No text content available)';

    const systemPrompt = `You are an expert editor. You will receive an article and a list of reviewer comments.
Your job is to revise the article to address ALL the comments.

Instructions:
- Apply each comment's requested change to the article
- For inline comments referencing specific text, modify that specific section
- For general comments, apply changes where appropriate
- Maintain the article's overall tone and style
- Preserve all existing formatting (headings, lists, tables, etc.)
- Output the COMPLETE revised article in clean HTML format
- Never truncate the document and never stop early
- Keep heading structure and section coverage unless a comment explicitly asks to remove a section
- Do NOT include any meta-commentary about the changes — just output the revised article

${researchContext ? `\nResearch data to incorporate where relevant:\n${researchContext}\n` : ''}`;

    const userMessage = `Here is the article to revise:

${sourceHtml}

---

Here are the reviewer comments to address:

${commentInstructions}

Please revise the article to address all comments. Output the complete revised article in HTML format.`;

    const stream = provider.stream({
      model,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
      maxTokens,
      temperature,
    });

    const reader = (stream as ReadableStream).getReader();
    const decoder = new TextDecoder();
    let revisedContent = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      revisedContent += decoder.decode(value, { stream: true });
    }

    const normalizedHtml = normalizeGeneratedHtml(revisedContent)
      .replace(/[ \t\u00a0]{5,}/g, ' ')
      .trim();
    const validation = validateRevisedHtmlOutput(sourceHtml, normalizedHtml);
    if (!validation.ok) {
      await logAuditEvent({
        userId: auth.user.id,
        action: 'ai.process_comments_rejected',
        resourceType: 'document',
        resourceId: documentId,
        projectId: doc.projectId ?? null,
        metadata: {
          reason: validation.reason,
          processedCommentCount: comments.length,
          selectedCommentCount: Array.isArray(commentIds) ? commentIds.length : null,
          useResearch: Boolean(useResearch),
          model,
          metrics: validation.metrics,
        },
      });
      return new Response(
        JSON.stringify({
          error: validation.reason || 'AI revision was rejected due to possible truncation.',
          code: 'REVISION_REJECTED',
          metrics: validation.metrics,
        }),
        { status: 422, headers: { 'Content-Type': 'application/json' } }
      );
    }

    await logAuditEvent({
      userId: auth.user.id,
      action: 'ai.process_comments',
      resourceType: 'document',
      resourceId: documentId,
      projectId: doc.projectId ?? null,
      metadata: {
        processedCommentCount: comments.length,
        selectedCommentCount: Array.isArray(commentIds) ? commentIds.length : null,
        useResearch: Boolean(useResearch),
        model,
        metrics: validation.metrics,
      },
    });

    return new Response(normalizedHtml, {
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  } catch (error) {
    console.error('Process comments error:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to process comments' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
