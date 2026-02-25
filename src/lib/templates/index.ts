import { ContentTemplate } from '@/types/template';

import { blogPostTemplate } from './blog-post';
import { productReviewTemplate } from './product-review';
import { howToGuideTemplate } from './how-to-guide';
import { listicleTemplate } from './listicle';
import { comparisonTemplate } from './comparison';
import { newsArticleTemplate } from './news-article';

export const templates: ContentTemplate[] = [
  blogPostTemplate,
  productReviewTemplate,
  howToGuideTemplate,
  listicleTemplate,
  comparisonTemplate,
  newsArticleTemplate,
];

export const templateMap: Record<string, ContentTemplate> = Object.fromEntries(
  templates.map((template) => [template.id, template]),
);

export function getTemplateById(id: string): ContentTemplate | undefined {
  // Try exact match first, then try with underscore/hyphen variants
  return templateMap[id] || templateMap[id.replace(/_/g, '-')];
}

export {
  blogPostTemplate,
  productReviewTemplate,
  howToGuideTemplate,
  listicleTemplate,
  comparisonTemplate,
  newsArticleTemplate,
};
