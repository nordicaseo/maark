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

export const AI_ACTIONS: readonly AIAction[] = [
  'writing',
  'rewriting',
  'formatting',
  'skill_generation',
  'comment_processing',
  'research',
  'workflow_research',
  'workflow_serp',
  'workflow_outline',
  'workflow_prewrite',
  'workflow_writing',
  'workflow_editing',
  'workflow_final_review',
  'workflow_pm',
] as const;

export const AI_ACTION_LABELS: Record<AIAction, string> = {
  writing: 'Content Writing',
  rewriting: 'AI Rewriting',
  formatting: 'Format Fixing',
  skill_generation: 'Skill Generation',
  comment_processing: 'Comment Processing',
  research: 'Research',
  workflow_research: 'Workflow: Research Stage',
  workflow_serp: 'Workflow: SERP Intel Stage',
  workflow_outline: 'Workflow: Outline Stage',
  workflow_prewrite: 'Workflow: PM Prewrite Stage',
  workflow_writing: 'Workflow: Writing Stage',
  workflow_editing: 'Workflow: Editing Stage',
  workflow_final_review: 'Workflow: Final SEO Review',
  workflow_pm: 'Workflow: PM General',
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
