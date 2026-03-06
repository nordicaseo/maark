import { describe, expect, it } from 'vitest';
import {
  getDefaultWorkflowOpsSettings,
  resolveWorkflowOpsSettingsFromProjectSettings,
} from '@/lib/workflow/ops-settings-utils';

describe('workflow ops settings resolver', () => {
  it('falls back to defaults when project settings are empty', () => {
    const defaults = getDefaultWorkflowOpsSettings();
    const resolved = resolveWorkflowOpsSettingsFromProjectSettings(null, defaults);
    expect(resolved).toEqual(defaults);
  });

  it('reads project workflowOps settings and clamps values', () => {
    const defaults = getDefaultWorkflowOpsSettings();
    const resolved = resolveWorkflowOpsSettingsFromProjectSettings(
      {
        workflowOps: {
          stageTimeoutMinutes: 240,
          finalReviewMaxRevisions: 0,
          autoResumeMaxResumes: 9,
          initialStartDelaySeconds: 15,
          maxStagesPerRun: 200,
        },
      },
      defaults
    );

    expect(resolved.stageTimeoutMinutes).toBe(180);
    expect(resolved.finalReviewMaxRevisions).toBe(1);
    expect(resolved.autoResumeMaxResumes).toBe(9);
    expect(resolved.initialStartDelaySeconds).toBe(15);
    expect(resolved.maxStagesPerRun).toBe(24);
  });

  it('parses workflowOps from JSON string payload', () => {
    const defaults = getDefaultWorkflowOpsSettings();
    const resolved = resolveWorkflowOpsSettingsFromProjectSettings(
      JSON.stringify({
        workflowOps: {
          stageTimeoutMinutes: 35,
          finalReviewMaxRevisions: 3,
          autoResumeMaxResumes: 5,
          initialStartDelaySeconds: 30,
          maxStagesPerRun: 12,
        },
      }),
      defaults
    );

    expect(resolved.stageTimeoutMinutes).toBe(35);
    expect(resolved.finalReviewMaxRevisions).toBe(3);
    expect(resolved.autoResumeMaxResumes).toBe(5);
    expect(resolved.initialStartDelaySeconds).toBe(30);
    expect(resolved.maxStagesPerRun).toBe(12);
  });
});
