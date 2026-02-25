import { ContentTemplate } from '@/types/template';

export const blogPostTemplate: ContentTemplate = {
  id: 'blog-post',
  name: 'Blog Post',
  description:
    'A standard blog post with an engaging introduction, well-structured body sections, and a compelling conclusion. Ideal for thought leadership, tutorials, and opinion pieces.',
  icon: 'FileText',
  suggestedStructure: [
    {
      heading: 'Title',
      level: 1,
      description: 'A compelling, SEO-friendly title that captures the main topic.',
      optional: false,
    },
    {
      heading: 'Introduction',
      level: 2,
      description:
        'Hook the reader with a relatable problem, surprising statistic, or bold statement. Establish what the post will cover.',
      optional: false,
    },
    {
      heading: 'Background / Context',
      level: 2,
      description:
        'Provide necessary context or background information so readers understand the topic fully.',
      optional: true,
    },
    {
      heading: 'Main Point 1',
      level: 2,
      description:
        'Present your first key argument, insight, or piece of advice with supporting evidence.',
      optional: false,
    },
    {
      heading: 'Main Point 2',
      level: 2,
      description:
        'Expand on a second key argument or insight, building on the previous section.',
      optional: false,
    },
    {
      heading: 'Main Point 3',
      level: 2,
      description:
        'Address a third supporting argument, counter-argument, or additional perspective.',
      optional: true,
    },
    {
      heading: 'Practical Takeaways',
      level: 2,
      description:
        'Summarize actionable tips or lessons the reader can apply immediately.',
      optional: true,
    },
    {
      heading: 'Conclusion',
      level: 2,
      description:
        'Recap the key points, reinforce the main message, and include a call-to-action.',
      optional: false,
    },
  ],
  targetWordCount: { min: 800, max: 2000 },
  defaultTiptapContent: {
    type: 'doc',
    content: [
      {
        type: 'heading',
        attrs: { level: 1 },
        content: [{ type: 'text', text: 'Your Blog Post Title' }],
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
        content: [{ type: 'text', text: 'Background / Context' }],
      },
      { type: 'paragraph' },
      {
        type: 'heading',
        attrs: { level: 2 },
        content: [{ type: 'text', text: 'Main Point 1' }],
      },
      { type: 'paragraph' },
      {
        type: 'heading',
        attrs: { level: 2 },
        content: [{ type: 'text', text: 'Main Point 2' }],
      },
      { type: 'paragraph' },
      {
        type: 'heading',
        attrs: { level: 2 },
        content: [{ type: 'text', text: 'Main Point 3' }],
      },
      { type: 'paragraph' },
      {
        type: 'heading',
        attrs: { level: 2 },
        content: [{ type: 'text', text: 'Practical Takeaways' }],
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
