import { db, ensureDb } from '@/db/index';
import { aiProviders, aiModelConfig } from '@/db/schema';
import { eq } from 'drizzle-orm';
import type { AIProviderInterface } from './types';
import { AnthropicProvider } from './providers/anthropic';
import { OpenAIProvider } from './providers/openai';
import { PerplexityProvider } from './providers/perplexity';
import type { AIAction } from '@/types/ai';

interface ProviderForAction {
  provider: AIProviderInterface;
  model: string;
  maxTokens: number;
  temperature: number;
}

/**
 * Get the configured AI provider and model for a specific action.
 * Falls back to ANTHROPIC_API_KEY env var if no provider is configured in DB.
 */
export async function getProviderForAction(action: AIAction): Promise<ProviderForAction> {
  await ensureDb();

  // Try to get config from DB
  const configs = await db
    .select()
    .from(aiModelConfig)
    .where(eq(aiModelConfig.action, action))
    .limit(1);

  if (configs.length > 0) {
    const config = configs[0];
    const providers = await db
      .select()
      .from(aiProviders)
      .where(eq(aiProviders.id, config.providerId))
      .limit(1);

    if (providers.length > 0) {
      const providerRow = providers[0];
      const provider = createProvider(providerRow.name, providerRow.apiKey);
      return {
        provider,
        model: config.model,
        maxTokens: config.maxTokens ?? 4096,
        temperature: config.temperature ?? 1.0,
      };
    }
  }

  // Fallback: use ANTHROPIC_API_KEY from env
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('No AI provider configured. Set up a provider in Admin > AI Models or set ANTHROPIC_API_KEY.');
  }

  return {
    provider: new AnthropicProvider(apiKey),
    model: 'claude-sonnet-4-20250514',
    maxTokens: 4096,
    temperature: 1.0,
  };
}

function createProvider(name: string, apiKey: string): AIProviderInterface {
  switch (name) {
    case 'anthropic':
      return new AnthropicProvider(apiKey);
    case 'openai':
      return new OpenAIProvider(apiKey);
    case 'perplexity':
      return new PerplexityProvider(apiKey);
    default:
      throw new Error(`Unknown AI provider: ${name}`);
  }
}

/**
 * Seed default provider from env var if no providers exist in DB.
 */
export async function seedDefaultProvider() {
  await ensureDb();

  const existing = await db.select().from(aiProviders).limit(1);
  if (existing.length > 0) return;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return;

  const [provider] = await db
    .insert(aiProviders)
    .values({
      name: 'anthropic',
      displayName: 'Anthropic (Claude)',
      apiKey,
    })
    .returning();

  if (!provider) return;

  const defaults: { action: string; model: string }[] = [
    { action: 'writing', model: 'claude-sonnet-4-20250514' },
    { action: 'rewriting', model: 'claude-sonnet-4-20250514' },
    { action: 'formatting', model: 'claude-sonnet-4-20250514' },
    { action: 'skill_generation', model: 'claude-sonnet-4-20250514' },
    { action: 'comment_processing', model: 'claude-sonnet-4-20250514' },
    { action: 'research', model: 'claude-sonnet-4-20250514' },
    { action: 'workflow_research', model: 'claude-sonnet-4-20250514' },
    { action: 'workflow_outline', model: 'claude-sonnet-4-20250514' },
    { action: 'workflow_prewrite', model: 'claude-sonnet-4-20250514' },
    { action: 'workflow_writing', model: 'claude-sonnet-4-20250514' },
    { action: 'workflow_final_review', model: 'claude-sonnet-4-20250514' },
    { action: 'workflow_pm', model: 'claude-sonnet-4-20250514' },
  ];

  for (const d of defaults) {
    await db.insert(aiModelConfig).values({
      action: d.action,
      providerId: provider.id,
      model: d.model,
    }).onConflictDoNothing();
  }
}
