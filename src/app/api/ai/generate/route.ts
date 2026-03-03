import { NextRequest } from 'next/server';
import { getProviderForAction } from '@/lib/ai';

const CONTENT_TYPE_PROMPTS: Record<string, string> = {
  blog_post: 'Write in a conversational, informative blog style. Use personal anecdotes where appropriate. Vary sentence length naturally.',
  blog_listicle: 'Write an engaging list article. Each item should have a heading and supporting detail. Vary the depth of each point.',
  blog_buying_guide: 'Write a detailed buying guide. Include criteria, recommendations, and practical advice for making purchase decisions.',
  blog_how_to: 'Write clear, step-by-step instructions. Use numbered steps for processes. Include practical tips and warnings.',
  blog_review: 'Write an honest, detailed review. Include pros and cons. Be specific about features and real-world usage.',
  product_category: 'Write informative product category content. Cover the range of products, key differences, and help users navigate their options.',
  product_description: 'Write compelling product descriptions. Highlight key features, benefits, and use cases. Be specific and persuasive.',
  comparison: 'Write a balanced comparison. Use specific criteria. Include a clear recommendation at the end.',
  news_article: 'Write in a journalistic style with the inverted pyramid structure. Lead with the most important information.',
};

export async function POST(req: NextRequest) {
  try {
    const { instruction, contentType, targetKeyword, existingContent, tone, skillContent } =
      await req.json();

    const { provider, model, maxTokens, temperature } = await getProviderForAction('writing');

    const typePrompt = CONTENT_TYPE_PROMPTS[contentType] || CONTENT_TYPE_PROMPTS.blog_post;
    const toneStr = tone ? `Write in a ${tone} tone.` : '';
    const keywordStr = targetKeyword
      ? `The target keyword is "${targetKeyword}". Naturally incorporate it and related terms.`
      : '';

    // If a skill is provided, use it as the primary system prompt
    const systemPrompt = skillContent
      ? `${skillContent}\n\n${toneStr} ${keywordStr}

Additional writing guidelines:
- Write naturally, varying sentence length and structure
- Avoid AI cliches: "delve", "landscape", "furthermore", "moreover", "comprehensive", "it's worth noting"
- Use contractions naturally (don't, can't, won't)
- Avoid excessive adverbs (significantly, effectively, ultimately)
- Output clean prose or markdown. No meta-commentary about the writing task.`
      : `You are a skilled content writer. ${typePrompt} ${toneStr} ${keywordStr}

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
    console.error('AI generation error:', error);
    return new Response(
      JSON.stringify({ error: 'Generation failed' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
