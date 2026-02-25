import { NextRequest } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

const CONTENT_TYPE_PROMPTS: Record<string, string> = {
  blog_post: 'Write in a conversational, informative blog style. Use personal anecdotes where appropriate. Vary sentence length naturally.',
  product_review: 'Write an honest, detailed product review. Include pros and cons. Be specific about features and real-world usage.',
  how_to_guide: 'Write clear, step-by-step instructions. Use numbered steps for processes. Include practical tips and warnings.',
  listicle: 'Write an engaging list article. Each item should have a heading and supporting detail. Vary the depth of each point.',
  comparison: 'Write a balanced comparison. Use specific criteria. Include a clear recommendation at the end.',
  news_article: 'Write in a journalistic style with the inverted pyramid structure. Lead with the most important information.',
};

export async function POST(req: NextRequest) {
  try {
    const { instruction, contentType, targetKeyword, existingContent, tone } =
      await req.json();

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const anthropic = new Anthropic({ apiKey });

    const typePrompt = CONTENT_TYPE_PROMPTS[contentType] || CONTENT_TYPE_PROMPTS.blog_post;
    const toneStr = tone ? `Write in a ${tone} tone.` : '';
    const keywordStr = targetKeyword
      ? `The target keyword is "${targetKeyword}". Naturally incorporate it and related terms.`
      : '';

    const systemPrompt = `You are a skilled content writer. ${typePrompt} ${toneStr} ${keywordStr}

Important writing guidelines:
- Write naturally, varying sentence length and structure
- Avoid AI cliches: "delve", "landscape", "furthermore", "moreover", "comprehensive", "it's worth noting"
- Use contractions naturally (don't, can't, won't)
- Include first-person perspective where appropriate
- Avoid excessive adverbs (significantly, effectively, ultimately)
- Don't start with "In today's..." or "In this article..."
- Output clean prose or markdown. No meta-commentary about the writing task.`;

    const userMessage = existingContent
      ? `${instruction}\n\nExisting content for context:\n${existingContent.slice(0, 2000)}`
      : instruction;

    const stream = anthropic.messages.stream({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    });

    const readableStream = new ReadableStream({
      async start(controller) {
        try {
          for await (const event of stream) {
            if (
              event.type === 'content_block_delta' &&
              event.delta.type === 'text_delta'
            ) {
              controller.enqueue(
                new TextEncoder().encode(event.delta.text)
              );
            }
          }
          controller.close();
        } catch (error) {
          controller.error(error);
        }
      },
    });

    return new Response(readableStream, {
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  } catch (error) {
    console.error('AI generation error:', error);
    return new Response(
      JSON.stringify({ error: 'Generation failed' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
