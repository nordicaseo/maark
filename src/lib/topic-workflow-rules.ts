import {
  TOPIC_STAGES,
  type TopicStageKey,
} from '@/lib/content-workflow-taxonomy';

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

const DEFAULT_NEXT_BY_STAGE: Partial<Record<TopicStageKey, TopicStageKey>> = {};
for (let i = 0; i < TOPIC_STAGES.length - 1; i += 1) {
  DEFAULT_NEXT_BY_STAGE[TOPIC_STAGES[i]] = TOPIC_STAGES[i + 1];
}

export const TOPIC_STAGE_TRANSITIONS: Record<TopicStageKey, TopicStageKey[]> = Object.fromEntries(
  TOPIC_STAGES.map((stage) => {
    const next = DEFAULT_NEXT_BY_STAGE[stage];
    return [stage, next ? [next] : []];
  })
) as Record<TopicStageKey, TopicStageKey[]>;

// Legacy compatibility: old workflows may still have these stages.
TOPIC_STAGE_TRANSITIONS.prewrite_context = ['writing'];
TOPIC_STAGE_TRANSITIONS.outline_review = ['writing'];

export function canSkipOutlineReviewByRole(role: string): boolean {
  return (
    role === 'owner' ||
    role === 'super_admin' ||
    role === 'admin' ||
    role === 'project_manager' ||
    role === 'lead'
  );
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

  const currentTransitions = TOPIC_STAGE_TRANSITIONS[args.currentStage] || [];
  let allowed = currentTransitions.includes(args.toStage);

  if (
    !allowed &&
    args.currentStage === 'outline_build' &&
    args.toStage === 'writing' &&
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

  if (args.toStage === 'human_review' && args.flags.seoReviewRequired && !approvals.seoFinal) {
    return {
      ok: false,
      reason: 'Final SEO approval is required before human review.',
      approvals,
    };
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
