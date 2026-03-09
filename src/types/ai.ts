export interface AIProvider {
  id: number;
  name: string;
  displayName: string | null;
  apiKey: string;
  isActive: boolean | number;
  createdAt: string;
  updatedAt: string;
}

export interface AIModelConfig {
  id: number;
  action: AIAction;
  providerId: number;
  model: string;
  maxTokens: number;
  temperature: number;
  createdAt: string;
  updatedAt: string;
}

export type AIAction =
  | 'writing'
  | 'rewriting'
  | 'formatting'
  | 'skill_generation'
  | 'comment_processing'
  | 'research'
  | 'workflow_research'
  | 'workflow_serp'
  | 'workflow_outline'
  | 'workflow_prewrite'
  | 'workflow_writing'
  | 'workflow_editing'
  | 'workflow_final_review'
  | 'workflow_pm';

/** Primary workflow stage actions — these are what the pipeline uses. */
export const WORKFLOW_ACTIONS: readonly AIAction[] = [
  'workflow_research',
  'workflow_serp',
  'workflow_outline',
  'workflow_prewrite',
  'workflow_pm',
  'workflow_writing',
  'workflow_editing',
  'workflow_final_review',
] as const;

/** Legacy/editor actions — kept for backward compatibility as fallbacks. */
export const LEGACY_ACTIONS: readonly AIAction[] = [
  'writing',
  'rewriting',
  'formatting',
  'skill_generation',
  'comment_processing',
  'research',
] as const;

export const AI_ACTIONS: readonly AIAction[] = [
  ...WORKFLOW_ACTIONS,
  ...LEGACY_ACTIONS,
] as const;

export const AI_ACTION_LABELS: Record<AIAction, string> = {
  workflow_research: 'Research Stage',
  workflow_serp: 'SERP Intel Stage',
  workflow_outline: 'Outline Stage',
  workflow_prewrite: 'PM Prewrite Stage',
  workflow_pm: 'PM General',
  workflow_writing: 'Writing Stage',
  workflow_editing: 'Editing Stage',
  workflow_final_review: 'Final SEO Review',
  writing: 'Content Writing (legacy)',
  rewriting: 'AI Rewriting (legacy)',
  formatting: 'Format Fixing (legacy)',
  skill_generation: 'Skill Generation (legacy)',
  comment_processing: 'Comment Processing (legacy)',
  research: 'Research (legacy)',
};

export const KNOWN_PROVIDERS: Record<string, { displayName: string; models: string[] }> = {
  anthropic: {
    displayName: 'Anthropic (Claude)',
    models: [
      'claude-opus-4-6',
      'claude-sonnet-4-6',
      'claude-sonnet-4-5-20250514',
      'claude-opus-4-20250514',
      'claude-sonnet-4-20250514',
      'claude-haiku-4-5-20251001',
      'claude-haiku-4-20250414',
    ],
  },
  openai: {
    displayName: 'OpenAI',
    models: [
      'o3-pro',
      'o3-mini',
      'gpt-4.1',
      'gpt-4.1-mini',
      'gpt-4.1-nano',
      'gpt-4o',
      'gpt-4o-mini',
      'gpt-4-turbo',
    ],
  },
  perplexity: {
    displayName: 'Perplexity',
    models: [
      'sonar-pro',
      'sonar',
    ],
  },
};
