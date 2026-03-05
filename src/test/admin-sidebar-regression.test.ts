import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('admin sidebar regression guard', () => {
  it('does not include operations links in admin nav', () => {
    const layoutPath = resolve(process.cwd(), 'src/app/admin/layout.tsx');
    const source = readFileSync(layoutPath, 'utf8');

    const forbiddenLabels = [
      "label: 'Keywords'",
      "label: 'Pages'",
      "label: 'Mission Control'",
      "label: 'Review'",
    ];

    for (const label of forbiddenLabels) {
      expect(source).not.toContain(label);
    }
  });
});
