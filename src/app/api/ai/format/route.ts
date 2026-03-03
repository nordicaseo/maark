import { NextRequest } from 'next/server';
import { getProviderForAction } from '@/lib/ai';

export async function POST(req: NextRequest) {
  try {
    const { html } = await req.json();

    if (!html || html.trim().length < 20) {
      return new Response(
        JSON.stringify({ error: 'Content too short to format' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const { provider, model, maxTokens, temperature } = await getProviderForAction('formatting');

    const systemPrompt = `You are a professional content formatter. Your job is to take messy HTML content and return cleanly formatted HTML.

## FORMATTING RULES:
1. Fix excessive spacing — remove redundant empty paragraphs, double line breaks, and unnecessary whitespace
2. Convert any data that looks like it should be a table into proper HTML <table> with <thead>/<tbody>/<tr>/<th>/<td>
3. Ensure proper heading hierarchy (h1 > h2 > h3 > h4)
4. Fix broken or inconsistent list formatting (ul/ol/li)
5. Clean up paragraph structure — merge overly fragmented paragraphs, split overly long ones
6. Preserve all actual content, links, bold, italic, and other inline formatting
7. Remove any empty or meaningless HTML tags
8. Ensure consistent spacing between sections

## OUTPUT:
Return ONLY the cleaned HTML content. No wrapping <html>/<body> tags. No commentary or explanation. Just the formatted content HTML that can be inserted directly into an editor.`;

    const stream = provider.stream({
      model,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: `Fix the formatting of this HTML content:\n\n${html}`,
        },
      ],
      maxTokens: Math.max(maxTokens, 8192),
      temperature,
    });

    return new Response(stream, {
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  } catch (error) {
    console.error('AI format error:', error);
    return new Response(
      JSON.stringify({ error: 'Formatting failed' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
