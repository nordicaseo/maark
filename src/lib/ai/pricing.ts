/** Per-million-token pricing in USD for known models. */
const PRICING_PER_MILLION: Record<string, { input: number; output: number }> = {
  // Anthropic
  'claude-sonnet-4-20250514': { input: 3.0, output: 15.0 },
  'claude-sonnet-4-6': { input: 3.0, output: 15.0 },
  'claude-haiku-4-5-20251001': { input: 0.25, output: 1.25 },
  'claude-haiku-4-20250414': { input: 0.25, output: 1.25 },
  'claude-opus-4-20250514': { input: 15.0, output: 75.0 },
  'claude-opus-4-6': { input: 15.0, output: 75.0 },
  // OpenAI
  'o3-pro': { input: 20.0, output: 80.0 },
  'o3-mini': { input: 1.1, output: 4.4 },
  'gpt-4.1': { input: 2.0, output: 8.0 },
  'gpt-4.1-mini': { input: 0.4, output: 1.6 },
  'gpt-4.1-nano': { input: 0.1, output: 0.4 },
  'gpt-4o': { input: 2.5, output: 10.0 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'gpt-4-turbo': { input: 10.0, output: 30.0 },
  // Perplexity
  'sonar-pro': { input: 3.0, output: 15.0 },
  'sonar': { input: 1.0, output: 1.0 },
};

/** Default pricing when model is not in the lookup table. */
const DEFAULT_PRICING = { input: 3.0, output: 15.0 };

/**
 * Calculate cost in cents for a given AI call.
 */
export function calculateCostCents(
  model: string,
  inputTokens: number,
  outputTokens: number
): number {
  const pricing = PRICING_PER_MILLION[model] || DEFAULT_PRICING;
  return ((inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000) * 100;
}
