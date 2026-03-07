import type { ContentFormat, DocumentStatus } from '@/types/document';
import type { AgentLaneKey } from '@/types/agent-runtime';

export const TASK_STATUS_ORDER = [
  'BACKLOG',
  'PENDING',
  'IN_PROGRESS',
  'IN_REVIEW',
  'ACCEPTED',
  'COMPLETED',
] as const;

export type TaskStatus = (typeof TASK_STATUS_ORDER)[number];

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  BACKLOG: 'Inbox',
  PENDING: 'Assigned',
  IN_PROGRESS: 'Working',
  IN_REVIEW: 'Review',
  ACCEPTED: 'Accepted',
  COMPLETED: 'Done',
};

export const TASK_STATUS_COLUMNS: ReadonlyArray<{
  id: TaskStatus;
  label: string;
  color: string;
}> = [
  { id: 'BACKLOG', label: TASK_STATUS_LABELS.BACKLOG, color: 'var(--mc-backlog)' },
  { id: 'PENDING', label: TASK_STATUS_LABELS.PENDING, color: 'var(--mc-pending)' },
  { id: 'IN_PROGRESS', label: TASK_STATUS_LABELS.IN_PROGRESS, color: 'var(--mc-progress)' },
  { id: 'IN_REVIEW', label: TASK_STATUS_LABELS.IN_REVIEW, color: 'var(--mc-review)' },
  { id: 'ACCEPTED', label: TASK_STATUS_LABELS.ACCEPTED, color: 'var(--mc-accepted)' },
  { id: 'COMPLETED', label: TASK_STATUS_LABELS.COMPLETED, color: 'var(--mc-complete)' },
];

export const TOPIC_STAGES = [
  'research',
  'seo_intel_review',
  'outline_build',
  'writing',
  'editing',
  'final_review',
  'human_review',
  'complete',
] as const;

export type TopicStageKey =
  | (typeof TOPIC_STAGES)[number]
  | 'outline_review'
  | 'prewrite_context';

export const TOPIC_STAGE_LABELS: Record<TopicStageKey, string> = {
  research: 'Research',
  seo_intel_review: 'SEO Intel',
  outline_build: 'Outline',
  outline_review: 'Outline Review',
  prewrite_context: 'Prewrite',
  writing: 'Writing',
  editing: 'Editing',
  final_review: 'SEO Review',
  human_review: 'Human Review',
  complete: 'Complete',
};

export const TOPIC_STAGE_NEXT: Record<TopicStageKey, TopicStageKey | null> = {
  research: 'seo_intel_review',
  seo_intel_review: 'outline_build',
  outline_build: 'writing',
  outline_review: 'writing',
  prewrite_context: 'writing',
  writing: 'editing',
  editing: 'final_review',
  final_review: 'human_review',
  human_review: 'complete',
  complete: null,
};

export const TOPIC_STAGE_OWNERS: Record<TopicStageKey, string> = {
  research: 'researcher -> seo -> lead',
  seo_intel_review: 'seo -> seo-reviewer -> lead',
  outline_build: 'outliner -> content -> lead',
  outline_review: 'human + seo-reviewer',
  writing: 'writer',
  prewrite_context: 'project-manager',
  editing: 'editor',
  final_review: 'seo-reviewer -> seo -> lead',
  human_review: 'human review',
  complete: 'pm handoff closed',
};

export const TOPIC_STAGE_OWNER_CHAINS: Record<TopicStageKey, string[]> = {
  research: ['researcher', 'seo', 'lead'],
  seo_intel_review: ['seo', 'seo-reviewer', 'lead'],
  outline_build: ['outliner', 'content', 'lead'],
  outline_review: ['human', 'seo-reviewer'],
  writing: ['writer'],
  prewrite_context: ['project-manager'],
  editing: ['editor'],
  final_review: ['seo-reviewer', 'seo', 'lead'],
  human_review: ['human'],
  complete: [],
};

export const WORKFLOW_RUNTIME_STATE_ORDER = [
  'active',
  'working',
  'needs_input',
  'queued',
  'blocked',
  'complete',
] as const;

export type WorkflowRuntimeState = (typeof WORKFLOW_RUNTIME_STATE_ORDER)[number];

export const WORKFLOW_RUNTIME_STATE_LABELS: Record<WorkflowRuntimeState, string> = {
  active: 'Active',
  working: 'Working',
  needs_input: 'Needs Input',
  queued: 'Queued',
  blocked: 'Blocked',
  complete: 'Complete',
};

export const WORKFLOW_RUNTIME_STATE_STYLES: Record<
  WorkflowRuntimeState,
  { background: string; color: string; borderColor: string }
> = {
  active: { background: '#ecfdf5', color: '#047857', borderColor: '#a7f3d0' },
  working: { background: '#eff6ff', color: '#1d4ed8', borderColor: '#bfdbfe' },
  needs_input: { background: '#fff7ed', color: '#c2410c', borderColor: '#fed7aa' },
  queued: { background: '#fefce8', color: '#a16207', borderColor: '#fde68a' },
  blocked: { background: '#fef2f2', color: '#b91c1c', borderColor: '#fecaca' },
  complete: { background: '#ecfdf5', color: '#065f46', borderColor: '#bbf7d0' },
};

export function resolveWorkflowRuntimeState(task: {
  workflowTemplateKey?: string;
  workflowCurrentStageKey?: string;
  workflowStageStatus?: string;
  status?: string;
}): WorkflowRuntimeState | null {
  if (task.workflowTemplateKey !== 'topic_production_v1') return null;

  const stageStatus = (task.workflowStageStatus || '').toLowerCase();
  const stage = task.workflowCurrentStageKey || 'research';
  const taskStatus = task.status || 'BACKLOG';

  if (stage === 'complete' || stageStatus === 'complete' || taskStatus === 'COMPLETED') {
    return 'complete';
  }
  if (stageStatus === 'blocked') return 'blocked';
  if (stageStatus === 'queued') return 'queued';
  if (stage === 'outline_review' || stage === 'human_review') {
    return 'needs_input';
  }
  if (taskStatus === 'IN_PROGRESS' || stageStatus === 'in_progress') return 'working';
  return 'active';
}

export const PAGE_TYPE_OPTIONS = [
  { value: 'product', label: 'Product' },
  { value: 'collection', label: 'Collection' },
  { value: 'blog', label: 'Blog' },
  { value: 'landing_page', label: 'Landing Page' },
  { value: 'homepage', label: 'Homepage' },
  { value: 'faq', label: 'FAQ' },
] as const;

export type PageType = (typeof PAGE_TYPE_OPTIONS)[number]['value'];

export const BLOG_SUBTYPE_OPTIONS = [
  { value: 'blog_post', label: 'Standard Post', contentType: 'blog_post' as ContentFormat },
  { value: 'how_to_guide', label: 'How-to Guide', contentType: 'blog_how_to' as ContentFormat },
  { value: 'best_of', label: 'Best-of', contentType: 'blog_listicle' as ContentFormat },
  { value: 'listicle', label: 'Listicle', contentType: 'blog_listicle' as ContentFormat },
  { value: 'buying_guide', label: 'Buying Guide', contentType: 'blog_buying_guide' as ContentFormat },
  { value: 'review', label: 'Review', contentType: 'blog_review' as ContentFormat },
  { value: 'comparison', label: 'Comparison', contentType: 'comparison' as ContentFormat },
] as const;

export type BlogSubtype = (typeof BLOG_SUBTYPE_OPTIONS)[number]['value'];

export const COLLECTION_SUBTYPE_OPTIONS = [
  { value: 'both', label: 'Both (Default)' },
  { value: 'above', label: 'Above' },
  { value: 'below', label: 'Below' },
] as const;

export type CollectionSubtype = (typeof COLLECTION_SUBTYPE_OPTIONS)[number]['value'];
export type PageSubtype = BlogSubtype | CollectionSubtype | 'standard';

export const DEFAULT_PAGE_TYPE: PageType = 'blog';
export const DEFAULT_BLOG_SUBTYPE: BlogSubtype = 'blog_post';
export const DEFAULT_COLLECTION_SUBTYPE: CollectionSubtype = 'both';

export const DOCUMENT_TO_TASK_STATUS: Record<DocumentStatus, TaskStatus> = {
  draft: 'BACKLOG',
  in_progress: 'IN_PROGRESS',
  review: 'IN_REVIEW',
  accepted: 'ACCEPTED',
  publish: 'COMPLETED',
  live: 'COMPLETED',
};

export const TASK_TO_DOCUMENT_STATUS: Record<TaskStatus, DocumentStatus> = {
  BACKLOG: 'draft',
  PENDING: 'draft',
  IN_PROGRESS: 'in_progress',
  IN_REVIEW: 'review',
  ACCEPTED: 'accepted',
  COMPLETED: 'publish',
};

export function pageTypeLabel(pageType: PageType): string {
  return PAGE_TYPE_OPTIONS.find((option) => option.value === pageType)?.label || pageType;
}

export function pageSubtypeLabel(pageType: PageType, subtype: string): string {
  if (pageType === 'blog') {
    return BLOG_SUBTYPE_OPTIONS.find((option) => option.value === subtype)?.label || subtype;
  }
  if (pageType === 'collection') {
    return COLLECTION_SUBTYPE_OPTIONS.find((option) => option.value === subtype)?.label || subtype;
  }
  return subtype;
}

export function hasPageSubtype(pageType: PageType): boolean {
  return pageType === 'blog' || pageType === 'collection';
}

export function resolveDefaultPageSubtype(pageType: PageType): PageSubtype {
  if (pageType === 'blog') return DEFAULT_BLOG_SUBTYPE;
  if (pageType === 'collection') return DEFAULT_COLLECTION_SUBTYPE;
  return 'standard';
}

export function resolveDefaultContentType(pageType: PageType, subtype: string): ContentFormat {
  if (pageType === 'blog') {
    return (
      BLOG_SUBTYPE_OPTIONS.find((option) => option.value === subtype)?.contentType ||
      'blog_post'
    );
  }
  if (pageType === 'collection') return 'product_category';
  if (pageType === 'product') return 'product_description';
  if (pageType === 'landing_page') return 'product_description';
  if (pageType === 'homepage') return 'blog_post';
  if (pageType === 'faq') return 'blog_how_to';
  return 'blog_post';
}

export function resolveLaneFromPageSelection(
  pageType: PageType,
  subtype: PageSubtype
): AgentLaneKey {
  if (pageType === 'collection') return 'collection';
  if (pageType === 'product') return 'product';
  if (pageType === 'landing_page' || pageType === 'homepage' || pageType === 'faq') {
    return 'landing';
  }
  if (pageType === 'blog') {
    if (subtype === 'standard') return 'blog';
    return 'blog';
  }
  return 'blog';
}

export function resolveLaneFromContentType(contentType: ContentFormat | string | null | undefined): AgentLaneKey {
  const value = String(contentType || '').trim().toLowerCase();
  if (value === 'product_category') return 'collection';
  if (value === 'product_description') return 'product';
  if (value === 'blog_how_to' || value === 'blog_listicle' || value === 'blog_buying_guide' || value === 'blog_review' || value === 'blog_post' || value === 'comparison' || value === 'news_article') {
    return 'blog';
  }
  return 'blog';
}

export function isAgentLaneKey(value: unknown): value is AgentLaneKey {
  return value === 'blog' || value === 'collection' || value === 'product' || value === 'landing';
}

export function isPageType(value: unknown): value is PageType {
  if (typeof value !== 'string') return false;
  return PAGE_TYPE_OPTIONS.some((option) => option.value === value);
}

export function isBlogSubtype(value: unknown): value is BlogSubtype {
  if (typeof value !== 'string') return false;
  return BLOG_SUBTYPE_OPTIONS.some((option) => option.value === value);
}

export function isCollectionSubtype(value: unknown): value is CollectionSubtype {
  if (typeof value !== 'string') return false;
  return COLLECTION_SUBTYPE_OPTIONS.some((option) => option.value === value);
}

export function getPageSelectionTags(pageType: PageType, subtype: PageSubtype): string[] {
  if (!hasPageSubtype(pageType)) return [`page:${pageType}`];
  return [`page:${pageType}`, `subtype:${subtype}`];
}
