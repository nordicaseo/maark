import OpenAI from 'openai';
import type { AIProviderInterface, AIStreamOptions } from '../types';

/**
 * Perplexity AI provider — uses the OpenAI-compatible API at api.perplexity.ai.
 * Model: sonar-pro (or sonar for lighter queries).
 * Requires PERPLEXITY_API_KEY env var.
 */
export class PerplexityProvider implements AIProviderInterface {
  private client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({
      apiKey,
      baseURL: 'https://api.perplexity.ai',
      timeout: 180_000,
    });
  }

  stream(options: AIStreamOptions): ReadableStream<Uint8Array> {
    const client = this.client;
    const encoder = new TextEncoder();
    const onUsage = options.onUsage;

    return new ReadableStream({
      async start(controller) {
        try {
          const stream = await client.chat.completions.create({
            model: options.model || 'sonar-pro',
            max_tokens: options.maxTokens,
            messages: [
              { role: 'system', content: options.system },
              ...options.messages.map((m) => ({
                role: m.role as 'user' | 'assistant',
                content: m.content,
              })),
            ],
            stream: true,
            stream_options: onUsage ? { include_usage: true } : undefined,
          });

          for await (const chunk of stream) {
            const text = chunk.choices[0]?.delta?.content;
            if (text) {
              controller.enqueue(encoder.encode(text));
            }
            if (onUsage && chunk.usage) {
              onUsage({
                inputTokens: chunk.usage.prompt_tokens ?? 0,
                outputTokens: chunk.usage.completion_tokens ?? 0,
              });
            }
          }
          controller.close();
        } catch (error) {
          controller.error(error);
        }
      },
    });
  }

  /**
   * Non-streaming helper for research queries.
   * Returns the full text response.
   */
  async research(query: string): Promise<string> {
    const response = await this.client.chat.completions.create({
      model: 'sonar-pro',
      messages: [
        {
          role: 'system',
          content: 'You are a research assistant. Provide accurate, well-sourced information. Include specific facts, statistics, and data points.',
        },
        { role: 'user', content: query },
      ],
      max_tokens: 2048,
    });

    return response.choices[0]?.message?.content || '';
  }
}
