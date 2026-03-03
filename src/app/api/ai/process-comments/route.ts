import { NextRequest } from 'next/server';
import { db, ensureDb } from '@/db';
import { documents, documentComments } from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import { getAuthUser } from '@/lib/auth';
import { getProviderForAction } from '@/lib/ai';
import { PerplexityProvider } from '@/lib/ai/providers/perplexity';

/**
 * POST /api/ai/process-comments
 * AI processes unresolved comments on a document, applying edits.
 * Body: { documentId: number, commentIds?: number[], useResearch?: boolean }
 * Returns: streamed revised HTML content.
 */
export async function POST(req: NextRequest) {
  const user = await getAuthUser();
  if (!user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  try {
    const { documentId, commentIds, useResearch } = await req.json();

    if (!documentId) {
      return new Response(JSON.stringify({ error: 'documentId is required' }), { status: 400 });
    }

    await ensureDb();

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
      comments = comments.filter((c: any) => commentIds.includes(c.id));
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
    const commentInstructions = comments.map((c: any, i: number) => {
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
            .map((c: any) => c.content)
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

    const systemPrompt = `You are an expert editor. You will receive an article and a list of reviewer comments.
Your job is to revise the article to address ALL the comments.

Instructions:
- Apply each comment's requested change to the article
- For inline comments referencing specific text, modify that specific section
- For general comments, apply changes where appropriate
- Maintain the article's overall tone and style
- Preserve all existing formatting (headings, lists, tables, etc.)
- Output the COMPLETE revised article in clean HTML format
- Do NOT include any meta-commentary about the changes — just output the revised article

${researchContext ? `\nResearch data to incorporate where relevant:\n${researchContext}\n` : ''}`;

    const userMessage = `Here is the article to revise:

${doc.plainText || '(No text content available)'}

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

    return new Response(stream, {
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
