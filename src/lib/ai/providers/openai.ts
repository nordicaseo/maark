import OpenAI from 'openai';
import type { AIProviderInterface, AIStreamOptions } from '../types';

export class OpenAIProvider implements AIProviderInterface {
  private client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey, timeout: 180_000 });
  }

  stream(options: AIStreamOptions): ReadableStream<Uint8Array> {
    const client = this.client;
    const encoder = new TextEncoder();
    const onUsage = options.onUsage;

    return new ReadableStream({
      async start(controller) {
        try {
          const stream = await client.chat.completions.create({
            model: options.model,
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
            ...(options.temperature !== undefined && { temperature: options.temperature }),
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
}
