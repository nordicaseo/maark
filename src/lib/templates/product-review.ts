import { ContentTemplate } from '@/types/template';

export const productReviewTemplate: ContentTemplate = {
  id: 'product-review',
  name: 'Product Review',
  description:
    'A thorough product review covering features, performance, pros and cons, and a final verdict. Perfect for affiliate content and buyer guides.',
  icon: 'Star',
  suggestedStructure: [
    {
      heading: 'Title',
      level: 1,
      description:
        'Include the product name and a hint at the verdict, e.g. "Product X Review: Is It Worth the Hype?"',
      optional: false,
    },
    {
      heading: 'Introduction',
      level: 2,
      description:
        'Briefly introduce the product, its manufacturer, and why it matters in its category.',
      optional: false,
    },
    {
      heading: 'Specifications & Overview',
      level: 2,
      description:
        'List key technical specifications, pricing, and availability details.',
      optional: false,
    },
    {
      heading: 'Design & Build Quality',
      level: 2,
      description:
        'Describe the physical design, materials, ergonomics, and first impressions.',
      optional: false,
    },
    {
      heading: 'Features & Functionality',
      level: 2,
      description:
        'Walk through the core features, unique selling points, and how they perform in practice.',
      optional: false,
    },
    {
      heading: 'Performance & Testing',
      level: 2,
      description:
        'Share real-world test results, benchmarks, or hands-on usage impressions.',
      optional: false,
    },
    {
      heading: 'Pros & Cons',
      level: 2,
      description:
        'Provide a balanced summary of strengths and weaknesses in a scannable format.',
      optional: false,
    },
    {
      heading: 'Comparison to Alternatives',
      level: 2,
      description:
        'Briefly compare the product to one or two key competitors.',
      optional: true,
    },
    {
      heading: 'Who Is This For?',
      level: 2,
      description:
        'Define the ideal buyer persona — who benefits most from this product.',
      optional: true,
    },
    {
      heading: 'Final Verdict',
      level: 2,
      description:
        'Deliver a clear recommendation with a rating or score and a final call-to-action.',
      optional: false,
    },
  ],
  targetWordCount: { min: 1200, max: 3000 },
  defaultTiptapContent: {
    type: 'doc',
    content: [
      {
        type: 'heading',
        attrs: { level: 1 },
        content: [{ type: 'text', text: 'Product Name Review: Your Verdict Here' }],
      },
      {
        type: 'heading',
        attrs: { level: 2 },
        content: [{ type: 'text', text: 'Introduction' }],
      },
      { type: 'paragraph' },
      {
        type: 'heading',
        attrs: { level: 2 },
        content: [{ type: 'text', text: 'Specifications & Overview' }],
      },
      { type: 'paragraph' },
      {
        type: 'heading',
        attrs: { level: 2 },
        content: [{ type: 'text', text: 'Design & Build Quality' }],
      },
      { type: 'paragraph' },
      {
        type: 'heading',
        attrs: { level: 2 },
        content: [{ type: 'text', text: 'Features & Functionality' }],
      },
      { type: 'paragraph' },
      {
        type: 'heading',
        attrs: { level: 2 },
        content: [{ type: 'text', text: 'Performance & Testing' }],
      },
      { type: 'paragraph' },
      {
        type: 'heading',
        attrs: { level: 2 },
        content: [{ type: 'text', text: 'Pros & Cons' }],
      },
      { type: 'paragraph' },
      {
        type: 'heading',
        attrs: { level: 2 },
        content: [{ type: 'text', text: 'Comparison to Alternatives' }],
      },
      { type: 'paragraph' },
      {
        type: 'heading',
        attrs: { level: 2 },
        content: [{ type: 'text', text: 'Who Is This For?' }],
      },
      { type: 'paragraph' },
      {
        type: 'heading',
        attrs: { level: 2 },
        content: [{ type: 'text', text: 'Final Verdict' }],
      },
      { type: 'paragraph' },
    ],
  },
};
