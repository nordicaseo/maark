import { describe, expect, it } from 'vitest';
import {
  canSkipOutlineReviewByRole,
  evaluateStageTransition,
} from '@/lib/topic-workflow-rules';

describe('topic workflow transition rules', () => {
  const baseFlags = {
    outlineReviewOptional: true,
    seoReviewRequired: true,
  };

  const baseApprovals = {
    outlineHuman: false,
    outlineSeo: false,
    seoFinal: false,
    outlineSkipped: false,
  };

  it('blocks illegal jumps', () => {
    const result = evaluateStageTransition({
      currentStage: 'research',
      toStage: 'writing',
      flags: baseFlags,
      approvals: baseApprovals,
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/illegal stage transition/i);
  });

  it('allows skipping optional outline review when requested', () => {
    const result = evaluateStageTransition({
      currentStage: 'outline_build',
      toStage: 'prewrite_context',
      flags: baseFlags,
      approvals: baseApprovals,
      skipOptionalOutlineReview: true,
    });

    expect(result.ok).toBe(true);
    expect(result.approvals.outlineSkipped).toBe(true);
  });

  it('blocks writing before outline approvals when review not skipped', () => {
    const result = evaluateStageTransition({
      currentStage: 'prewrite_context',
      toStage: 'writing',
      flags: baseFlags,
      approvals: baseApprovals,
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/outline approvals/i);
  });

  it('allows completion only after seo final approval when required', () => {
    const blocked = evaluateStageTransition({
      currentStage: 'final_review',
      toStage: 'complete',
      flags: baseFlags,
      approvals: baseApprovals,
    });

    expect(blocked.ok).toBe(false);
    expect(blocked.reason).toMatch(/final seo approval/i);

    const allowed = evaluateStageTransition({
      currentStage: 'final_review',
      toStage: 'complete',
      flags: baseFlags,
      approvals: {
        ...baseApprovals,
        seoFinal: true,
      },
    });

    expect(allowed.ok).toBe(true);
  });

  it('grants outline-skip permission only to pm/lead-level roles', () => {
    expect(canSkipOutlineReviewByRole('owner')).toBe(true);
    expect(canSkipOutlineReviewByRole('admin')).toBe(true);
    expect(canSkipOutlineReviewByRole('project_manager')).toBe(true);
    expect(canSkipOutlineReviewByRole('lead')).toBe(true);
    expect(canSkipOutlineReviewByRole('editor')).toBe(false);
    expect(canSkipOutlineReviewByRole('writer')).toBe(false);
  });
});
