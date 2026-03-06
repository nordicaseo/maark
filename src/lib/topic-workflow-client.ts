export interface TriggerTopicWorkflowOptions {
  autoContinue?: boolean;
  maxStages?: number;
  planningDelayMs?: number;
  logLabel?: string;
}

const DEFAULT_PLANNING_DELAY_MS = 22_000;

export function triggerTopicWorkflowRun(taskId: string, options: TriggerTopicWorkflowOptions = {}) {
  const autoContinue = options.autoContinue ?? true;
  const maxStages = options.maxStages ?? 10;
  const planningDelayMs = options.planningDelayMs ?? DEFAULT_PLANNING_DELAY_MS;
  const logLabel = options.logLabel || 'topic workflow';

  const run = async () => {
    const res = await fetch('/api/topic-workflow/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        taskId,
        autoContinue,
        maxStages,
      }),
    });
    if (!res.ok) {
      const payload = await res.json().catch(() => ({}));
      throw new Error(payload?.error || `Failed to run ${logLabel}`);
    }
  };

  void run().catch((err) => {
    console.error(`Auto-run ${logLabel} failed:`, err);
  });

  if (typeof window !== 'undefined' && planningDelayMs > 0) {
    window.setTimeout(() => {
      void run().catch((err) => {
        console.error(`Delayed auto-run ${logLabel} failed:`, err);
      });
    }, planningDelayMs);
  }
}
