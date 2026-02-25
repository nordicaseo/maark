export type DocumentStatus = 'draft' | 'in_progress' | 'review' | 'published';

export type ContentType =
  | 'blog_post'
  | 'product_review'
  | 'how_to_guide'
  | 'listicle'
  | 'comparison'
  | 'news_article';

export const CONTENT_TYPE_LABELS: Record<ContentType, string> = {
  blog_post: 'Blog Post',
  product_review: 'Product Review',
  how_to_guide: 'How-To Guide',
  listicle: 'Listicle',
  comparison: 'Comparison',
  news_article: 'News Article',
};

export const STATUS_LABELS: Record<DocumentStatus, string> = {
  draft: 'Draft',
  in_progress: 'In Progress',
  review: 'Review',
  published: 'Published',
};

export interface Document {
  id: number;
  title: string;
  content: any;
  plainText: string | null;
  status: DocumentStatus;
  contentType: ContentType;
  targetKeyword: string | null;
  wordCount: number;
  aiDetectionScore: number | null;
  aiRiskLevel: string | null;
  semanticScore: number | null;
  contentQualityScore: number | null;
  createdAt: string;
  updatedAt: string;
}
