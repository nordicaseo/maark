import { describe, expect, it } from 'vitest';
import { applyStyleGuard, styleGuardPassed } from '@/lib/workflow/style-guard';

describe('style guard', () => {
  it('removes em dash and en dash when policy forbids them', () => {
    const html = '<p>Line one — line two – line three.</p>';
    const result = applyStyleGuard(html, {
      emDash: 'forbid',
      colon: 'allow',
      maxNarrativeColons: 0,
    });

    expect(result.html).not.toContain('—');
    expect(result.html).not.toContain('–');
    expect(result.metrics.emDashCount).toBe(0);
    expect(result.metrics.enDashCount).toBe(0);
  });

  it('keeps heading colons and removes narrative colons in structural_only mode', () => {
    const html = '<h2>Checklist: Overview</h2><p>Intro: details and more context.</p>';
    const result = applyStyleGuard(html, {
      emDash: 'forbid',
      colon: 'structural_only',
      maxNarrativeColons: 0,
    });

    expect(result.html).toContain('Checklist: Overview');
    expect(result.metrics.narrativeColonCount).toBe(0);
    expect(styleGuardPassed(result.metrics, {
      emDash: 'forbid',
      colon: 'structural_only',
      maxNarrativeColons: 0,
    })).toBe(true);
  });

  it('fails styleGuardPassed when narrative colons exceed limit', () => {
    const result = applyStyleGuard('<p>A: B: C</p>', {
      emDash: 'allow',
      colon: 'allow',
      maxNarrativeColons: 0,
    });

    expect(styleGuardPassed(result.metrics, {
      emDash: 'allow',
      colon: 'structural_only',
      maxNarrativeColons: 0,
    })).toBe(false);
  });
});
