import { ContentTemplate } from '@/types/template';

export const howToGuideTemplate: ContentTemplate = {
  id: 'how-to-guide',
  name: 'How-To Guide',
  description:
    'A step-by-step instructional guide that walks readers through a process from start to finish. Great for tutorials, DIY content, and educational articles.',
  icon: 'BookOpen',
  suggestedStructure: [
    {
      heading: 'Title',
      level: 1,
      description:
        'Start with "How to..." followed by a clear description of the outcome the reader will achieve.',
      optional: false,
    },
    {
      heading: 'Introduction',
      level: 2,
      description:
        'Explain what the reader will learn, why it matters, and what they will be able to do by the end.',
      optional: false,
    },
    {
      heading: 'What You Will Need',
      level: 2,
      description:
        'List prerequisites, tools, materials, software, or knowledge required before starting.',
      optional: false,
    },
    {
      heading: 'Step 1: Getting Started',
      level: 2,
      description:
        'Describe the first action the reader must take, with clear and specific instructions.',
      optional: false,
    },
    {
      heading: 'Step 2: Core Process',
      level: 2,
      description:
        'Walk through the main body of the process with detailed instructions.',
      optional: false,
    },
    {
      heading: 'Step 3: Refinement',
      level: 2,
      description:
        'Cover additional steps, adjustments, or fine-tuning needed to complete the task.',
      optional: false,
    },
    {
      heading: 'Step 4: Final Touches',
      level: 2,
      description:
        'Describe the last steps to finish the process and verify the result.',
      optional: true,
    },
    {
      heading: 'Tips & Best Practices',
      level: 2,
      description:
        'Share expert tips, common mistakes to avoid, and ways to get better results.',
      optional: true,
    },
    {
      heading: 'Troubleshooting',
      level: 2,
      description:
        'Address common problems readers might encounter and how to resolve them.',
      optional: true,
    },
    {
      heading: 'Conclusion',
      level: 2,
      description:
        'Summarize what was accomplished and suggest next steps or related guides.',
      optional: false,
    },
  ],
  targetWordCount: { min: 1000, max: 2500 },
  defaultTiptapContent: {
    type: 'doc',
    content: [
      {
        type: 'heading',
        attrs: { level: 1 },
        content: [{ type: 'text', text: 'How to [Achieve Your Goal]' }],
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
        content: [{ type: 'text', text: 'What You Will Need' }],
      },
      { type: 'paragraph' },
      {
        type: 'heading',
        attrs: { level: 2 },
        content: [{ type: 'text', text: 'Step 1: Getting Started' }],
      },
      { type: 'paragraph' },
      {
        type: 'heading',
        attrs: { level: 2 },
        content: [{ type: 'text', text: 'Step 2: Core Process' }],
      },
      { type: 'paragraph' },
      {
        type: 'heading',
        attrs: { level: 2 },
        content: [{ type: 'text', text: 'Step 3: Refinement' }],
      },
      { type: 'paragraph' },
      {
        type: 'heading',
        attrs: { level: 2 },
        content: [{ type: 'text', text: 'Step 4: Final Touches' }],
      },
      { type: 'paragraph' },
      {
        type: 'heading',
        attrs: { level: 2 },
        content: [{ type: 'text', text: 'Tips & Best Practices' }],
      },
      { type: 'paragraph' },
      {
        type: 'heading',
        attrs: { level: 2 },
        content: [{ type: 'text', text: 'Troubleshooting' }],
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
