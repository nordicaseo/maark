export const WORKFLOW_STAGE_TRANSITIONS = {
  research: ['seo_intel_review'],
  seo_intel_review: ['outline_build'],
  outline_build: ['writing'],
  outline_review: ['writing'],
  prewrite_context: ['writing'],
  writing: ['editing'],
  editing: ['final_review'],
  final_review: ['human_review'],
  human_review: ['complete'],
  complete: [],
} as const;

export const WORKFLOW_STAGE_OWNER_CHAINS = {
  research: ['researcher', 'seo', 'lead'],
  seo_intel_review: ['seo', 'seo-reviewer', 'lead'],
  outline_build: ['outliner', 'content', 'lead'],
  outline_review: ['human', 'seo-reviewer'],
  prewrite_context: ['project-manager'],
  writing: ['writer'],
  editing: ['editor'],
  final_review: ['seo-reviewer', 'seo', 'lead'],
  human_review: ['human'],
  complete: [],
} as const;

export const WORKFLOW_ROLE_ALIASES = {
  researcher: ['researcher', 'seo', 'editor'],
  outliner: ['outliner', 'editor', 'content'],
  writer: ['writer'],
  editor: ['editor', 'content'],
  'seo-reviewer': ['seo-reviewer', 'seo', 'editor'],
  'project-manager': ['project-manager', 'lead', 'editor'],
  seo: ['seo', 'seo-reviewer', 'editor'],
  content: ['content', 'editor'],
  lead: ['lead', 'project-manager', 'editor', 'seo-reviewer'],
} as const;
