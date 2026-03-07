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

  it('accepts legacy skip flag without blocking outline->writing transition', () => {
    const result = evaluateStageTransition({
      currentStage: 'outline_build',
      toStage: 'writing',
      flags: baseFlags,
      approvals: baseApprovals,
      skipOptionalOutlineReview: true,
    });

    expect(result.ok).toBe(true);
    expect(result.approvals.outlineSkipped).toBe(false);
  });

  it('allows canonical transition from outline to writing without legacy outline gate', () => {
    const result = evaluateStageTransition({
      currentStage: 'outline_build',
      toStage: 'writing',
      flags: baseFlags,
      approvals: baseApprovals,
    });

    expect(result.ok).toBe(true);
  });

  it('allows transition to human review only after seo final approval when required', () => {
    const blocked = evaluateStageTransition({
      currentStage: 'final_review',
      toStage: 'human_review',
      flags: baseFlags,
      approvals: baseApprovals,
    });

    expect(blocked.ok).toBe(false);
    expect(blocked.reason).toMatch(/final seo approval/i);

    const allowed = evaluateStageTransition({
      currentStage: 'final_review',
      toStage: 'human_review',
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
