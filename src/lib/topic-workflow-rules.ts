export type TopicStageKey =
  | 'research'
  | 'outline_build'
  | 'outline_review'
  | 'prewrite_context'
  | 'writing'
  | 'final_review'
  | 'complete';

export interface WorkflowFlags {
  outlineReviewOptional: boolean;
  seoReviewRequired: boolean;
}

export interface WorkflowApprovals {
  outlineHuman: boolean;
  outlineSeo: boolean;
  seoFinal: boolean;
  outlineSkipped: boolean;
}

export const TOPIC_STAGE_TRANSITIONS: Record<TopicStageKey, TopicStageKey[]> = {
  research: ['outline_build'],
  outline_build: ['outline_review'],
  outline_review: ['prewrite_context'],
  prewrite_context: ['writing'],
  writing: ['final_review'],
  final_review: ['complete'],
  complete: [],
};

export function canSkipOutlineReviewByRole(role: string): boolean {
  return role === 'owner' || role === 'admin' || role === 'project_manager' || role === 'lead';
}

export function evaluateStageTransition(args: {
  currentStage: TopicStageKey;
  toStage: TopicStageKey;
  flags: WorkflowFlags;
  approvals: WorkflowApprovals;
  skipOptionalOutlineReview?: boolean;
}): { ok: boolean; reason?: string; approvals: WorkflowApprovals } {
  const approvals: WorkflowApprovals = { ...args.approvals };

  if (args.currentStage === args.toStage) {
    return { ok: true, approvals };
  }

  let allowed = TOPIC_STAGE_TRANSITIONS[args.currentStage].includes(args.toStage);

  if (
    !allowed &&
    args.currentStage === 'outline_build' &&
    args.toStage === 'prewrite_context' &&
    args.skipOptionalOutlineReview
  ) {
    if (!args.flags.outlineReviewOptional) {
      return { ok: false, reason: 'Outline review skip is disabled for this workflow.', approvals };
    }
    approvals.outlineSkipped = true;
    allowed = true;
  }

  if (!allowed) {
    return {
      ok: false,
      reason: `Illegal stage transition: ${args.currentStage} -> ${args.toStage}`,
      approvals,
    };
  }

  if (args.toStage === 'writing') {
    const outlineGateSatisfied =
      approvals.outlineSkipped ||
      !args.flags.outlineReviewOptional ||
      (approvals.outlineHuman && approvals.outlineSeo);

    if (!outlineGateSatisfied) {
      return {
        ok: false,
        reason: 'Outline approvals must be completed before writing.',
        approvals,
      };
    }
  }

  if (args.toStage === 'complete' && args.flags.seoReviewRequired && !approvals.seoFinal) {
    return {
      ok: false,
      reason: 'Final SEO approval is required before completion.',
      approvals,
    };
  }

  return { ok: true, approvals };
}
