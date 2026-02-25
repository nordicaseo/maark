import { ContentTemplate } from '@/types/template';

export const listicleTemplate: ContentTemplate = {
  id: 'listicle',
  name: 'Listicle',
  description:
    'A list-based article that presents information as numbered or ranked items. Highly scannable and shareable, perfect for roundups, tips, and curated collections.',
  icon: 'ListOrdered',
  suggestedStructure: [
    {
      heading: 'Title',
      level: 1,
      description:
        'Include a number and a benefit, e.g. "10 Proven Ways to Boost Your Productivity".',
      optional: false,
    },
    {
      heading: 'Introduction',
      level: 2,
      description:
        'Set the stage by explaining why this list matters and what criteria were used for selection.',
      optional: false,
    },
    {
      heading: '1. First Item',
      level: 2,
      description:
        'Present the first list item with a descriptive subheading and a supporting paragraph.',
      optional: false,
    },
    {
      heading: '2. Second Item',
      level: 2,
      description:
        'Present the second list item with context, examples, or data.',
      optional: false,
    },
    {
      heading: '3. Third Item',
      level: 2,
      description:
        'Continue the pattern with the third list item.',
      optional: false,
    },
    {
      heading: '4. Fourth Item',
      level: 2,
      description:
        'Add the fourth list item with supporting details.',
      optional: false,
    },
    {
      heading: '5. Fifth Item',
      level: 2,
      description:
        'Present the fifth list item. Add more items as needed to reach your target count.',
      optional: false,
    },
    {
      heading: 'Honorable Mentions',
      level: 2,
      description:
        'Briefly mention additional items that did not make the main list but are still noteworthy.',
      optional: true,
    },
    {
      heading: 'Conclusion',
      level: 2,
      description:
        'Wrap up with a summary of the top picks and encourage the reader to take action.',
      optional: false,
    },
  ],
  targetWordCount: { min: 800, max: 2500 },
  defaultTiptapContent: {
    type: 'doc',
    content: [
      {
        type: 'heading',
        attrs: { level: 1 },
        content: [{ type: 'text', text: 'X Best [Items] for [Purpose]' }],
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
        content: [{ type: 'text', text: '1. First Item' }],
      },
      { type: 'paragraph' },
      {
        type: 'heading',
        attrs: { level: 2 },
        content: [{ type: 'text', text: '2. Second Item' }],
      },
      { type: 'paragraph' },
      {
        type: 'heading',
        attrs: { level: 2 },
        content: [{ type: 'text', text: '3. Third Item' }],
      },
      { type: 'paragraph' },
      {
        type: 'heading',
        attrs: { level: 2 },
        content: [{ type: 'text', text: '4. Fourth Item' }],
      },
      { type: 'paragraph' },
      {
        type: 'heading',
        attrs: { level: 2 },
        content: [{ type: 'text', text: '5. Fifth Item' }],
      },
      { type: 'paragraph' },
      {
        type: 'heading',
        attrs: { level: 2 },
        content: [{ type: 'text', text: 'Honorable Mentions' }],
      },
      { type: 'paragraph' },
      {
        type: 'heading',
        attrs: { level: 2 },
        content: [{ type: 'text', text: 'Conclusion' }],
      },
      { type: 'paragraph' },
    ],
  },
};
