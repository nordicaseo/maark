import { describe, expect, it } from 'vitest';
import {
  evaluateWritingCompleteness,
  extractOutlineHeadings,
} from '@/lib/workflow/writing-completeness';

describe('writing completeness', () => {
  it('extracts outline headings from markdown H2 sections', () => {
    const headings = extractOutlineHeadings(
      '# Title\n\n## Intro\nText\n\n## Benefits\n- Item\n\n### Not counted'
    );

    expect(headings).toEqual(['Intro', 'Benefits']);
  });

  it('passes when heading coverage, ending, and length are complete', () => {
    const outlineHeadings = ['intro', 'benefits', 'implementation'];
    const body = Array.from({ length: 900 }, () => 'content').join(' ');
    const html = `
      <h1>Title</h1>
      <h2>Intro</h2>
      <p>${body}</p>
      <h2>Benefits</h2>
      <p>${body}</p>
      <h2>Implementation</h2>
      <p>${body}.</p>
    `;

    const result = evaluateWritingCompleteness({
      html,
      outlineHeadings,
    });

    expect(result.complete).toBe(true);
    expect(result.reasons).toHaveLength(0);
    expect(result.headingCoverage).toBeGreaterThanOrEqual(0.99);
    expect(result.wordGap).toBe(0);
  });

  it('fails with outline gaps and abrupt ending', () => {
    const outlineHeadings = ['intro', 'benefits', 'implementation'];
    const html = `
      <h1>Title</h1>
      <h2>Intro</h2>
      <p>short draft without enough content and missing sections</p>
      <h2>Benefits</h2>
      <p>unfinished section and abrupt ending</p>
    `;

    const result = evaluateWritingCompleteness({
      html,
      outlineHeadings,
    });

    expect(result.complete).toBe(false);
    expect(result.missingHeadings.length).toBeGreaterThan(0);
    expect(result.abruptEnding).toBe(true);
    expect(result.wordGap).toBeGreaterThan(0);
  });
});
