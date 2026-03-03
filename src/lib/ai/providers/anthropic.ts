import Anthropic from '@anthropic-ai/sdk';
import type { AIProviderInterface, AIStreamOptions } from '../types';

export class AnthropicProvider implements AIProviderInterface {
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  stream(options: AIStreamOptions): ReadableStream<Uint8Array> {
    const client = this.client;
    const encoder = new TextEncoder();

    return new ReadableStream({
      async start(controller) {
        try {
          const stream = client.messages.stream({
            model: options.model,
            max_tokens: options.maxTokens,
            system: options.system,
            messages: options.messages.map((m) => ({
              role: m.role,
              content: m.content,
            })),
            ...(options.temperature !== undefined && { temperature: options.temperature }),
          });

          for await (const event of stream) {
            if (
              event.type === 'content_block_delta' &&
              event.delta.type === 'text_delta'
            ) {
              controller.enqueue(encoder.encode(event.delta.text));
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
