import OpenAI from 'openai';
import type { AIProviderInterface, AIStreamOptions } from '../types';

export class OpenAIProvider implements AIProviderInterface {
  private client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey });
  }

  stream(options: AIStreamOptions): ReadableStream<Uint8Array> {
    const client = this.client;
    const encoder = new TextEncoder();

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
            ...(options.temperature !== undefined && { temperature: options.temperature }),
          });

          for await (const chunk of stream) {
            const text = chunk.choices[0]?.delta?.content;
            if (text) {
              controller.enqueue(encoder.encode(text));
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
