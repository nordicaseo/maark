import { describe, expect, it } from 'vitest';
import { normalizeGeneratedHtml, validateRevisedHtmlOutput } from '@/lib/utils/html-normalize';

function words(count: number): string {
  return Array.from({ length: count }, (_, i) => `word${i}`).join(' ');
}

describe('html normalize + revision guard', () => {
  it('cleans empty blocks and excessive whitespace from generated html', () => {
    const raw = `\n\`\`\`html\n<h1>Title</h1>\n<p>&nbsp;</p>\n<p>Intro     sentence with     extra spacing.</p>\n<p>Second&nbsp;&nbsp;&nbsp;line.</p>\n<div><br></div>\n\`\`\`\n`;

    const normalized = normalizeGeneratedHtml(raw);

    expect(normalized).toContain('<h1>Title</h1>');
    expect(normalized).toContain('<p>Intro sentence with extra spacing.</p>');
    expect(normalized).toContain('<p>Second line.</p>');
    expect(normalized).not.toContain('&nbsp;');
    expect(normalized).not.toContain('<p></p>');
  });

  it('rejects suspiciously truncated revisions', () => {
    const source = `<h1>Main title</h1><h2>Section One</h2><p>${words(180)}</p><h2>Section Two</h2><p>${words(160)}</p>`;
    const truncated = '<h1>Main title</h1><p>Too short now.</p>';

    const result = validateRevisedHtmlOutput(source, truncated);

    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/truncated/i);
  });

  it('rejects revisions that remove heading structure', () => {
    const source = `<h1>Main title</h1><h2>First section</h2><p>${words(90)}</p><h2>Second section</h2><p>${words(90)}</p>`;
    const flattened = `<p>${words(230)}</p><p>${words(50)}</p>`;

    const result = validateRevisedHtmlOutput(source, flattened);

    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/heading structure/i);
  });

  it('accepts full-length revisions that keep structure', () => {
    const source = `<h1>Main title</h1><h2>First section</h2><p>${words(120)}</p><h2>Second section</h2><p>${words(120)}</p>`;
    const revised = `<h1>Main title</h1><h2>First section</h2><p>${words(130)}</p><h2>Second section</h2><p>${words(115)}</p>`;

    const result = validateRevisedHtmlOutput(source, revised);

    expect(result.ok).toBe(true);
  });
});
