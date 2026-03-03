export interface AIStreamOptions {
  system: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
  maxTokens: number;
  temperature?: number;
  model: string;
}

export interface AIProviderInterface {
  stream(options: AIStreamOptions): ReadableStream<Uint8Array>;
}
