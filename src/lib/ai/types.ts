export interface AIUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface AIStreamOptions {
  system: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
  maxTokens: number;
  temperature?: number;
  model: string;
  /** Called once when the stream completes with token usage data. */
  onUsage?: (usage: AIUsage) => void;
}

export interface AIProviderInterface {
  stream(options: AIStreamOptions): ReadableStream<Uint8Array>;
}
