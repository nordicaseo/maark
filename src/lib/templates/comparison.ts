import { ContentTemplate } from '@/types/template';

export const comparisonTemplate: ContentTemplate = {
  id: 'comparison',
  name: 'Comparison Article',
  description:
    'A side-by-side comparison of two or more products, services, or approaches. Helps readers make informed decisions with objective analysis.',
  icon: 'GitCompare',
  suggestedStructure: [
    {
      heading: 'Title',
      level: 1,
      description:
        'Use "X vs Y" format, e.g. "React vs Vue: Which Framework Should You Choose in 2026?"',
      optional: false,
    },
    {
      heading: 'Introduction',
      level: 2,
      description:
        'Introduce the options being compared, why the comparison matters, and what criteria will be evaluated.',
      optional: false,
    },
    {
      heading: 'Overview of Option A',
      level: 2,
      description:
        'Provide a brief overview of the first option including its history, purpose, and target audience.',
      optional: false,
    },
    {
      heading: 'Overview of Option B',
      level: 2,
      description:
        'Provide a brief overview of the second option including its history, purpose, and target audience.',
      optional: false,
    },
    {
      heading: 'Feature Comparison',
      level: 2,
      description:
        'Compare the core features of each option side by side, ideally in a table or structured format.',
      optional: false,
    },
    {
      heading: 'Performance & Reliability',
      level: 2,
      description:
        'Evaluate how each option performs under real-world conditions with benchmarks or test data.',
      optional: false,
    },
    {
      heading: 'Pricing & Value',
      level: 2,
      description:
        'Compare pricing models, plans, and overall value for money.',
      optional: false,
    },
    {
      heading: 'Ease of Use',
      level: 2,
      description:
        'Assess the learning curve, user experience, and onboarding process for each option.',
      optional: true,
    },
    {
      heading: 'Use Cases: When to Choose Each',
      level: 2,
      description:
        'Define specific scenarios where each option is the better choice.',
      optional: false,
    },
    {
      heading: 'Summary Table',
      level: 2,
      description:
        'Present a quick-reference comparison table summarizing all evaluated criteria.',
      optional: true,
    },
    {
      heading: 'Final Verdict',
      level: 2,
      description:
        'Deliver a clear recommendation based on different reader needs and priorities.',
      optional: false,
    },
  ],
  targetWordCount: { min: 1500, max: 3500 },
  defaultTiptapContent: {
    type: 'doc',
    content: [
      {
        type: 'heading',
        attrs: { level: 1 },
        content: [{ type: 'text', text: 'Option A vs Option B: Which Is Right for You?' }],
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
        content: [{ type: 'text', text: 'Overview of Option A' }],
      },
      { type: 'paragraph' },
      {
        type: 'heading',
        attrs: { level: 2 },
        content: [{ type: 'text', text: 'Overview of Option B' }],
      },
      { type: 'paragraph' },
      {
        type: 'heading',
        attrs: { level: 2 },
        content: [{ type: 'text', text: 'Feature Comparison' }],
      },
      { type: 'paragraph' },
      {
        type: 'heading',
        attrs: { level: 2 },
        content: [{ type: 'text', text: 'Performance & Reliability' }],
      },
      { type: 'paragraph' },
      {
        type: 'heading',
        attrs: { level: 2 },
        content: [{ type: 'text', text: 'Pricing & Value' }],
      },
      { type: 'paragraph' },
      {
        type: 'heading',
        attrs: { level: 2 },
        content: [{ type: 'text', text: 'Ease of Use' }],
      },
      { type: 'paragraph' },
      {
        type: 'heading',
        attrs: { level: 2 },
        content: [{ type: 'text', text: 'Use Cases: When to Choose Each' }],
      },
      { type: 'paragraph' },
      {
        type: 'heading',
        attrs: { level: 2 },
        content: [{ type: 'text', text: 'Summary Table' }],
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
