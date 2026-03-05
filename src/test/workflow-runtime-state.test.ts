import { describe, expect, it } from 'vitest';
import { resolveWorkflowRuntimeState } from '@/lib/content-workflow-taxonomy';

describe('workflow runtime state resolver', () => {
  const base = {
    workflowTemplateKey: 'topic_production_v1',
    workflowCurrentStageKey: 'research',
    workflowStageStatus: 'in_progress',
    status: 'IN_PROGRESS',
  };

  it('returns blocked when workflow stage status is blocked', () => {
    expect(
      resolveWorkflowRuntimeState({
        ...base,
        workflowStageStatus: 'blocked',
      })
    ).toBe('blocked');
  });

  it('returns needs_input on manual approval stages', () => {
    expect(
      resolveWorkflowRuntimeState({
        ...base,
        workflowCurrentStageKey: 'outline_review',
      })
    ).toBe('needs_input');

    expect(
      resolveWorkflowRuntimeState({
        ...base,
        workflowCurrentStageKey: 'prewrite_context',
      })
    ).toBe('needs_input');
  });

  it('returns complete when stage/status indicate completion', () => {
    expect(
      resolveWorkflowRuntimeState({
        ...base,
        workflowCurrentStageKey: 'complete',
        workflowStageStatus: 'complete',
        status: 'COMPLETED',
      })
    ).toBe('complete');
  });

  it('returns null for non-topic tasks', () => {
    expect(
      resolveWorkflowRuntimeState({
        workflowTemplateKey: 'legacy_task',
        status: 'IN_PROGRESS',
      })
    ).toBeNull();
  });
});
