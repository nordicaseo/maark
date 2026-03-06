export interface WorkflowOpsSettings {
  stageTimeoutMinutes: number;
  finalReviewMaxRevisions: number;
  autoResumeMaxResumes: number;
  initialStartDelaySeconds: number;
  maxStagesPerRun: number;
}

function clampInt(
  value: unknown,
  fallback: number,
  min: number,
  max: number
): number {
  const parsed =
    typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function parseObject(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === 'object'
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }
  if (typeof value === 'object') return value as Record<string, unknown>;
  return {};
}

function envInt(name: string, fallback: number, min: number, max: number): number {
  return clampInt(process.env[name], fallback, min, max);
}

export function getDefaultWorkflowOpsSettings(): WorkflowOpsSettings {
  return {
    stageTimeoutMinutes: envInt('WORKFLOW_STAGE_TIMEOUT_MINUTES', 25, 5, 180),
    finalReviewMaxRevisions: envInt('WORKFLOW_FINAL_REVIEW_MAX_REVISIONS', 2, 1, 8),
    autoResumeMaxResumes: envInt('WORKFLOW_AUTO_RESUME_MAX_RESUMES', 4, 1, 24),
    initialStartDelaySeconds: envInt('WORKFLOW_INITIAL_START_DELAY_SECONDS', 20, 0, 600),
    maxStagesPerRun: envInt('WORKFLOW_MAX_STAGES_PER_RUN', 10, 1, 24),
  };
}

export function resolveWorkflowOpsSettingsFromProjectSettings(
  settings: unknown,
  defaults: WorkflowOpsSettings = getDefaultWorkflowOpsSettings()
): WorkflowOpsSettings {
  const root = parseObject(settings);
  const workflowOps = parseObject(root.workflowOps);
  return {
    stageTimeoutMinutes: clampInt(
      workflowOps.stageTimeoutMinutes,
      defaults.stageTimeoutMinutes,
      5,
      180
    ),
    finalReviewMaxRevisions: clampInt(
      workflowOps.finalReviewMaxRevisions,
      defaults.finalReviewMaxRevisions,
      1,
      8
    ),
    autoResumeMaxResumes: clampInt(
      workflowOps.autoResumeMaxResumes,
      defaults.autoResumeMaxResumes,
      1,
      24
    ),
    initialStartDelaySeconds: clampInt(
      workflowOps.initialStartDelaySeconds,
      defaults.initialStartDelaySeconds,
      0,
      600
    ),
    maxStagesPerRun: clampInt(workflowOps.maxStagesPerRun, defaults.maxStagesPerRun, 1, 24),
  };
}

export function mergeWorkflowOpsSettings(
  current: WorkflowOpsSettings,
  input: Partial<WorkflowOpsSettings>
): WorkflowOpsSettings {
  return {
    stageTimeoutMinutes: clampInt(
      input.stageTimeoutMinutes,
      current.stageTimeoutMinutes,
      5,
      180
    ),
    finalReviewMaxRevisions: clampInt(
      input.finalReviewMaxRevisions,
      current.finalReviewMaxRevisions,
      1,
      8
    ),
    autoResumeMaxResumes: clampInt(
      input.autoResumeMaxResumes,
      current.autoResumeMaxResumes,
      1,
      24
    ),
    initialStartDelaySeconds: clampInt(
      input.initialStartDelaySeconds,
      current.initialStartDelaySeconds,
      0,
      600
    ),
    maxStagesPerRun: clampInt(input.maxStagesPerRun, current.maxStagesPerRun, 1, 24),
  };
}

export function parseSettingsRoot(value: unknown): Record<string, unknown> {
  return parseObject(value);
}
