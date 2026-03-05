export type DocumentStatus = 'draft' | 'in_progress' | 'review' | 'accepted' | 'publish' | 'live';

export type ContentFormat =
  | 'blog_post'
  | 'blog_listicle'
  | 'blog_buying_guide'
  | 'blog_how_to'
  | 'blog_review'
  | 'product_category'
  | 'product_description'
  | 'comparison'
  | 'news_article';

// Backward compatibility alias
export type ContentType = ContentFormat;

export const CONTENT_FORMAT_GROUPS: Record<string, { label: string; formats: ContentFormat[] }> = {
  blog: {
    label: 'Blog',
    formats: ['blog_post', 'blog_listicle', 'blog_buying_guide', 'blog_how_to', 'blog_review'],
  },
  product: {
    label: 'Product',
    formats: ['product_category', 'product_description'],
  },
  other: {
    label: 'Other',
    formats: ['comparison', 'news_article'],
  },
};

export const CONTENT_FORMAT_LABELS: Record<ContentFormat, string> = {
  blog_post: 'Blog Post',
  blog_listicle: 'Listicle',
  blog_buying_guide: 'Buying Guide',
  blog_how_to: 'How-to Guide',
  blog_review: 'Review',
  product_category: 'Product Category',
  product_description: 'Product Description',
  comparison: 'Comparison',
  news_article: 'News Article',
};

// Backward compat
export const CONTENT_TYPE_LABELS = CONTENT_FORMAT_LABELS;

export const STATUS_LABELS: Record<DocumentStatus, string> = {
  draft: 'Draft',
  in_progress: 'In Progress',
  review: 'Review',
  accepted: 'Accepted',
  publish: 'Publish',
  live: 'Live',
};

export interface Document {
  id: number;
  projectId: number | null;
  authorId: string | null;
  authorName?: string | null;
  title: string;
  content: unknown;
  plainText: string | null;
  status: DocumentStatus;
  contentType: ContentFormat;
  targetKeyword: string | null;
  wordCount: number;
  aiDetectionScore: number | null;
  aiRiskLevel: string | null;
  semanticScore: number | null;
  contentQualityScore: number | null;
  previewToken?: string | null;
  researchSnapshot?: {
    summary?: string;
    facts?: string[];
    statistics?: Array<{ stat: string; source?: string }>;
    sources?: Array<{ url: string; title?: string }>;
    analyzedAt?: number;
  } | null;
  outlineSnapshot?: {
    markdown?: string;
    html?: string;
    headingCount?: number;
    headings?: string[];
    generatedAt?: number;
  } | null;
  prewriteChecklist?: {
    brandContextReady: boolean;
    internalLinksReady: boolean;
    unresolvedQuestions: number;
    completedAt?: number;
  } | null;
  agentQuestions?: Array<{
    id: string;
    question: string;
    askedByAgentId?: string;
    status: 'open' | 'answered';
    answer?: string;
    createdAt: number;
    answeredAt?: number;
  }> | null;
  createdAt: string;
  updatedAt: string;
}
