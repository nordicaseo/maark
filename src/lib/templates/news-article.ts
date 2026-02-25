import { ContentTemplate } from '@/types/template';

export const newsArticleTemplate: ContentTemplate = {
  id: 'news-article',
  name: 'News Article',
  description:
    'A timely news article following the inverted pyramid structure. Delivers the most important information first, then expands with details and context.',
  icon: 'Newspaper',
  suggestedStructure: [
    {
      heading: 'Headline',
      level: 1,
      description:
        'A concise, factual headline that conveys the core news in under 15 words.',
      optional: false,
    },
    {
      heading: 'Lead Paragraph',
      level: 2,
      description:
        'Answer the five Ws (Who, What, When, Where, Why) in the opening paragraph to deliver the essential facts immediately.',
      optional: false,
    },
    {
      heading: 'Key Details',
      level: 2,
      description:
        'Expand on the lead with the most important supporting details, data points, and quotes.',
      optional: false,
    },
    {
      heading: 'Background & Context',
      level: 2,
      description:
        'Provide historical context, prior events, or industry background that helps readers understand the significance.',
      optional: false,
    },
    {
      heading: 'Expert Reactions',
      level: 2,
      description:
        'Include quotes or statements from relevant experts, officials, or stakeholders.',
      optional: true,
    },
    {
      heading: 'Impact & Implications',
      level: 2,
      description:
        'Analyze what this news means for the industry, community, or affected parties.',
      optional: false,
    },
    {
      heading: 'What Comes Next',
      level: 2,
      description:
        'Outline expected next steps, upcoming events, or developments to watch.',
      optional: true,
    },
  ],
  targetWordCount: { min: 500, max: 1500 },
  defaultTiptapContent: {
    type: 'doc',
    content: [
      {
        type: 'heading',
        attrs: { level: 1 },
        content: [{ type: 'text', text: 'Breaking: Your News Headline Here' }],
      },
      {
        type: 'heading',
        attrs: { level: 2 },
        content: [{ type: 'text', text: 'Lead Paragraph' }],
      },
      { type: 'paragraph' },
      {
        type: 'heading',
        attrs: { level: 2 },
        content: [{ type: 'text', text: 'Key Details' }],
      },
      { type: 'paragraph' },
      {
        type: 'heading',
        attrs: { level: 2 },
        content: [{ type: 'text', text: 'Background & Context' }],
      },
      { type: 'paragraph' },
      {
        type: 'heading',
        attrs: { level: 2 },
        content: [{ type: 'text', text: 'Expert Reactions' }],
      },
      { type: 'paragraph' },
      {
        type: 'heading',
        attrs: { level: 2 },
        content: [{ type: 'text', text: 'Impact & Implications' }],
      },
      { type: 'paragraph' },
      {
        type: 'heading',
        attrs: { level: 2 },
        content: [{ type: 'text', text: 'What Comes Next' }],
      },
      { type: 'paragraph' },
    ],
  },
};
