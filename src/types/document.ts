export type DocumentStatus = 'draft' | 'in_progress' | 'review' | 'published';

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
  published: 'Published',
};

export interface Document {
  id: number;
  projectId: number | null;
  authorId: string | null;
  title: string;
  content: any;
  plainText: string | null;
  status: DocumentStatus;
  contentType: ContentFormat;
  targetKeyword: string | null;
  wordCount: number;
  aiDetectionScore: number | null;
  aiRiskLevel: string | null;
  semanticScore: number | null;
  contentQualityScore: number | null;
  createdAt: string;
  updatedAt: string;
}
