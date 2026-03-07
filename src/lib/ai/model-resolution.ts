import { and, eq } from 'drizzle-orm';
import { db, ensureDb } from '@/db/index';
import { aiModelConfig, aiProviders } from '@/db/schema';
import type { AIProviderInterface } from './types';
import { AnthropicProvider } from './providers/anthropic';
import { OpenAIProvider } from './providers/openai';
import { PerplexityProvider } from './providers/perplexity';
import type { AIAction } from '@/types/ai';
import { getProviderForAction } from './index';

export interface ModelOverride {
  provider?: string;
  modelId?: string;
  temperature?: number;
}

export interface ResolveModelPriorityInput {
  projectRoleOverride?: ModelOverride;
  agentOverride?: ModelOverride;
}

export interface ResolvedModelConfig {
  provider: AIProviderInterface;
  providerName: string;
  model: string;
  maxTokens: number;
  temperature: number;
}

const LEGACY_ACTION_FALLBACK: Partial<Record<AIAction, AIAction>> = {
  workflow_research: 'research',
  workflow_serp: 'research',
  workflow_outline: 'research',
  workflow_prewrite: 'research',
  workflow_pm: 'workflow_prewrite',
  workflow_writing: 'writing',
  workflow_editing: 'writing',
  workflow_final_review: 'writing',
};

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

function mergeModelOverrides(
  ...overrides: Array<ModelOverride | undefined>
): ModelOverride | undefined {
  const merged: ModelOverride = {};
  for (const override of overrides) {
    if (!override) continue;
    if (override.provider) merged.provider = override.provider;
    if (override.modelId) merged.modelId = override.modelId;
    if (override.temperature !== undefined) merged.temperature = override.temperature;
  }
  return Object.keys(merged).length > 0 ? merged : undefined;
}

async function fetchConfiguredAction(action: AIAction) {
  const [baseConfig] = await db
    .select({
      model: aiModelConfig.model,
      maxTokens: aiModelConfig.maxTokens,
      temperature: aiModelConfig.temperature,
      providerName: aiProviders.name,
      providerApiKey: aiProviders.apiKey,
    })
    .from(aiModelConfig)
    .innerJoin(aiProviders, eq(aiModelConfig.providerId, aiProviders.id))
    .where(eq(aiModelConfig.action, action))
    .limit(1);
  return baseConfig;
}

export async function resolveProviderForAction(
  action: AIAction,
  override?: ModelOverride,
  priority?: ResolveModelPriorityInput
): Promise<ResolvedModelConfig> {
  await ensureDb();
  const effectiveOverride = mergeModelOverrides(
    priority?.agentOverride,
    override,
    priority?.projectRoleOverride
  );

  const actionCandidates: AIAction[] = [action];
  let fallback = LEGACY_ACTION_FALLBACK[action];
  while (fallback && !actionCandidates.includes(fallback)) {
    actionCandidates.push(fallback);
    fallback = LEGACY_ACTION_FALLBACK[fallback];
  }

  let baseConfig:
    | {
        model: string;
        maxTokens: number | null;
        temperature: number | null;
        providerName: string;
        providerApiKey: string;
      }
    | undefined;
  for (const candidate of actionCandidates) {
    const hit = await fetchConfiguredAction(candidate);
    if (hit) {
      baseConfig = hit;
      break;
    }
  }

  if (!baseConfig) {
    const fallback = await getProviderForAction(action);
    return {
      provider: fallback.provider,
      providerName: 'anthropic',
      model: effectiveOverride?.modelId || fallback.model,
      maxTokens: fallback.maxTokens,
      temperature: effectiveOverride?.temperature ?? fallback.temperature,
    };
  }

  let providerName = baseConfig.providerName;
  let providerApiKey = baseConfig.providerApiKey;
  if (effectiveOverride?.provider && effectiveOverride.provider !== providerName) {
    const [overrideProvider] = await db
      .select({
        name: aiProviders.name,
        apiKey: aiProviders.apiKey,
      })
      .from(aiProviders)
      .where(
        and(
          eq(aiProviders.name, effectiveOverride.provider),
          eq(aiProviders.isActive, 1)
        )
      )
      .limit(1);
    if (overrideProvider) {
      providerName = overrideProvider.name;
      providerApiKey = overrideProvider.apiKey;
    }
  }

  return {
    provider: createProvider(providerName, providerApiKey),
    providerName,
    model: effectiveOverride?.modelId || baseConfig.model,
    maxTokens: baseConfig.maxTokens ?? 4096,
    temperature: effectiveOverride?.temperature ?? baseConfig.temperature ?? 1.0,
  };
}
