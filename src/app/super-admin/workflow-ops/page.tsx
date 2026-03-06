'use client';

import { useEffect, useMemo, useState } from 'react';
import { Activity, AlertTriangle, RefreshCw, Save } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { WorkflowOpsSettings } from '@/lib/workflow/ops-settings';

interface ProjectItem {
  id: number;
  name: string;
}

interface WorkflowOpsPayload {
  projects: ProjectItem[];
  selectedProjectId: number | null;
  settings: WorkflowOpsSettings;
  recommendations?: {
    stageTimeoutMinutes: number;
    finalReviewMaxRevisions: number;
  };
  metrics: {
    totals: {
      total: number;
      active: number;
      working: number;
      needsInput: number;
      queued: number;
      blocked: number;
      complete: number;
    };
    byStage: Array<{
      stage: string;
      label: string;
      count: number;
      blocked: number;
      queued: number;
      inProgress: number;
      avgAgeMinutes: number;
      maxAgeMinutes: number;
    }>;
    autoResume: {
      lastRunAt: string | null;
      runsLast24h: number;
      resumedLast24h: number;
      watchdogBlockedLast24h: number;
      failuresLast24h: number;
    };
    retries: {
      finalReviewRetryExhaustedLast24h: number;
      writingIncompleteBlockedLast24h: number;
      assignmentBlockedLast24h: number;
    };
  };
  blockedTasks: Array<{
    id: string;
    title: string;
    projectId: number | null;
    stage: string;
    status: string;
    reason: string;
    updatedAt: number | string | null;
  }>;
}

function parseNumber(value: string, fallback: number): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export default function WorkflowOpsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [autoResumeRunning, setAutoResumeRunning] = useState(false);
  const [taskActionBusyId, setTaskActionBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [payload, setPayload] = useState<WorkflowOpsPayload | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  const [draft, setDraft] = useState<WorkflowOpsSettings | null>(null);

  const projectOptions = useMemo(() => payload?.projects || [], [payload?.projects]);

  const selectedProjectLabel = useMemo(() => {
    if (!selectedProjectId) return 'All Projects (Org)';
    return projectOptions.find((project) => project.id === selectedProjectId)?.name || `Project ${selectedProjectId}`;
  }, [projectOptions, selectedProjectId]);

  async function load(nextProjectId?: number | null) {
    setLoading(true);
    setError(null);
    try {
      const projectId = nextProjectId === undefined ? selectedProjectId : nextProjectId;
      const qs = projectId ? `?projectId=${projectId}` : '';
      const res = await fetch(`/api/super-admin/workflow-ops${qs}`);
      const data = (await res.json()) as WorkflowOpsPayload | { error?: string };
      if (!res.ok) {
        throw new Error((data as { error?: string }).error || 'Failed to load workflow ops data.');
      }
      const typed = data as WorkflowOpsPayload;
      setPayload(typed);
      setSelectedProjectId(typed.selectedProjectId);
      setDraft(typed.settings);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load workflow ops data.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function saveSettings() {
    if (!selectedProjectId || !draft) return;
    setSaving(true);
    setNotice(null);
    setError(null);
    try {
      const res = await fetch('/api/super-admin/workflow-ops', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: selectedProjectId,
          ...draft,
        }),
      });
      const data = await res.json().catch(() => ({} as { error?: string }));
      if (!res.ok) {
        throw new Error(data.error || 'Failed to save workflow settings.');
      }
      setNotice('Workflow ops settings saved.');
      await load(selectedProjectId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save workflow settings.');
    } finally {
      setSaving(false);
    }
  }

  async function runAutoResumeNow() {
    setAutoResumeRunning(true);
    setError(null);
    setNotice(null);
    try {
      const body: Record<string, unknown> = {
        maxResumes: draft?.autoResumeMaxResumes || 4,
      };
      if (selectedProjectId) {
        body.projectId = selectedProjectId;
      }
      const res = await fetch('/api/topic-workflow/auto-resume', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({} as { error?: string; resumedCount?: number }));
      if (!res.ok) {
        throw new Error(data.error || 'Failed to run auto-resume');
      }
      setNotice(`Auto-resume completed. Resumed ${Number(data.resumedCount || 0)} task(s).`);
      await load(selectedProjectId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to run auto-resume');
    } finally {
      setAutoResumeRunning(false);
    }
  }

  async function resumeTask(taskId: string) {
    setTaskActionBusyId(taskId);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch('/api/topic-workflow/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskId,
          autoContinue: true,
          maxStages: 4,
        }),
      });
      const data = await res.json().catch(() => ({} as { error?: string }));
      if (!res.ok) {
        throw new Error(data.error || 'Failed to resume task');
      }
      setNotice('Task resumed.');
      await load(selectedProjectId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to resume task');
    } finally {
      setTaskActionBusyId(null);
    }
  }

  async function recoverTask(taskId: string, stage: string) {
    setTaskActionBusyId(taskId);
    setError(null);
    setNotice(null);
    const fromStage =
      stage === 'writing' || stage === 'final_review'
        ? 'writing'
        : stage === 'outline_build' || stage === 'outline_review' || stage === 'prewrite_context'
          ? 'outline_build'
          : 'research';
    try {
      const res = await fetch('/api/topic-workflow/rerun', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskId,
          fromStage,
        }),
      });
      const data = await res.json().catch(() => ({} as { error?: string }));
      if (!res.ok) {
        throw new Error(data.error || 'Failed to recover task');
      }
      setNotice(`Task recovered from ${fromStage}.`);
      await load(selectedProjectId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to recover task');
    } finally {
      setTaskActionBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Activity className="h-5 w-5" />
            Workflow Ops
          </h1>
          <p className="text-sm text-muted-foreground">
            Monitor workflow throughput, watchdog blocks, retries, and auto-resume health.
          </p>
        </div>
        <Button variant="outline" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-[260px]">
          <Select
            value={selectedProjectId ? String(selectedProjectId) : 'all'}
            onValueChange={(value) => {
              const nextProjectId = value === 'all' ? null : Number.parseInt(value, 10);
              void load(Number.isFinite(nextProjectId) ? nextProjectId : null);
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select project scope" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Projects (Org)</SelectItem>
              {projectOptions.map((project) => (
                <SelectItem key={project.id} value={String(project.id)}>
                  {project.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Badge variant="secondary">{selectedProjectLabel}</Badge>
        <Button variant="outline" onClick={() => void runAutoResumeNow()} disabled={autoResumeRunning}>
          <RefreshCw className={`h-4 w-4 mr-2 ${autoResumeRunning ? 'animate-spin' : ''}`} />
          Run Auto-Resume Now
        </Button>
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}
      {notice && (
        <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
          {notice}
        </div>
      )}

      {selectedProjectId && draft && (
        <section className="rounded-lg border border-border bg-card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold">Project Workflow Tuning</h2>
              <p className="text-xs text-muted-foreground">
                Tune watchdog/retry automation for this project.
              </p>
            </div>
            <Button onClick={() => void saveSettings()} disabled={saving}>
              <Save className="h-4 w-4 mr-2" />
              Save Settings
            </Button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
            <label className="text-xs text-muted-foreground space-y-1">
              Stage Timeout (min)
              <Input
                value={String(draft.stageTimeoutMinutes)}
                onChange={(event) =>
                  setDraft((prev) =>
                    prev
                      ? { ...prev, stageTimeoutMinutes: parseNumber(event.target.value, prev.stageTimeoutMinutes) }
                      : prev
                  )
                }
              />
            </label>
            <label className="text-xs text-muted-foreground space-y-1">
              Final Review Max Revisions
              <Input
                value={String(draft.finalReviewMaxRevisions)}
                onChange={(event) =>
                  setDraft((prev) =>
                    prev
                      ? { ...prev, finalReviewMaxRevisions: parseNumber(event.target.value, prev.finalReviewMaxRevisions) }
                      : prev
                  )
                }
              />
            </label>
            <label className="text-xs text-muted-foreground space-y-1">
              Auto-Resume Max Tasks
              <Input
                value={String(draft.autoResumeMaxResumes)}
                onChange={(event) =>
                  setDraft((prev) =>
                    prev
                      ? { ...prev, autoResumeMaxResumes: parseNumber(event.target.value, prev.autoResumeMaxResumes) }
                      : prev
                  )
                }
              />
            </label>
            <label className="text-xs text-muted-foreground space-y-1">
              Initial Start Delay (sec)
              <Input
                value={String(draft.initialStartDelaySeconds)}
                onChange={(event) =>
                  setDraft((prev) =>
                    prev
                      ? { ...prev, initialStartDelaySeconds: parseNumber(event.target.value, prev.initialStartDelaySeconds) }
                      : prev
                  )
                }
              />
            </label>
            <label className="text-xs text-muted-foreground space-y-1">
              Max Stages Per Run
              <Input
                value={String(draft.maxStagesPerRun)}
                onChange={(event) =>
                  setDraft((prev) =>
                    prev
                      ? { ...prev, maxStagesPerRun: parseNumber(event.target.value, prev.maxStagesPerRun) }
                      : prev
                  )
                }
              />
            </label>
          </div>
          {payload?.recommendations && (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">
                Suggested from last 24h: timeout {payload.recommendations.stageTimeoutMinutes}m, final-review retries {payload.recommendations.finalReviewMaxRevisions}.
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setDraft((prev) =>
                    prev
                      ? {
                          ...prev,
                          stageTimeoutMinutes: payload.recommendations?.stageTimeoutMinutes || prev.stageTimeoutMinutes,
                          finalReviewMaxRevisions:
                            payload.recommendations?.finalReviewMaxRevisions || prev.finalReviewMaxRevisions,
                        }
                      : prev
                  )
                }
              >
                Apply Recommended
              </Button>
            </div>
          )}
        </section>
      )}

      <section className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
        <Metric label="Total" value={payload?.metrics.totals.total ?? 0} />
        <Metric label="Active" value={payload?.metrics.totals.active ?? 0} />
        <Metric label="Working" value={payload?.metrics.totals.working ?? 0} />
        <Metric label="Needs Input" value={payload?.metrics.totals.needsInput ?? 0} />
        <Metric label="Queued" value={payload?.metrics.totals.queued ?? 0} />
        <Metric label="Blocked" value={payload?.metrics.totals.blocked ?? 0} />
        <Metric label="Complete" value={payload?.metrics.totals.complete ?? 0} />
      </section>

      <section className="rounded-lg border border-border bg-card overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <h2 className="text-sm font-semibold">Stage Metrics</h2>
        </div>
        <div className="overflow-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-2">Stage</th>
                <th className="text-right px-4 py-2">Count</th>
                <th className="text-right px-4 py-2">Working</th>
                <th className="text-right px-4 py-2">Queued</th>
                <th className="text-right px-4 py-2">Blocked</th>
                <th className="text-right px-4 py-2">Avg Age (m)</th>
                <th className="text-right px-4 py-2">Max Age (m)</th>
              </tr>
            </thead>
            <tbody>
              {(payload?.metrics.byStage || []).map((row) => (
                <tr key={row.stage} className="border-t border-border">
                  <td className="px-4 py-2 font-medium">{row.label}</td>
                  <td className="px-4 py-2 text-right">{row.count}</td>
                  <td className="px-4 py-2 text-right">{row.inProgress}</td>
                  <td className="px-4 py-2 text-right">{row.queued}</td>
                  <td className="px-4 py-2 text-right">{row.blocked}</td>
                  <td className="px-4 py-2 text-right">{row.avgAgeMinutes}</td>
                  <td className="px-4 py-2 text-right">{row.maxAgeMinutes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="rounded-lg border border-border bg-card p-4 space-y-2">
          <h2 className="text-sm font-semibold">Auto-Resume (24h)</h2>
          <p className="text-sm text-muted-foreground">
            Last run: {payload?.metrics.autoResume.lastRunAt ? new Date(payload.metrics.autoResume.lastRunAt).toLocaleString() : 'Never'}
          </p>
          <p className="text-sm">Runs: {payload?.metrics.autoResume.runsLast24h ?? 0}</p>
          <p className="text-sm">Tasks resumed: {payload?.metrics.autoResume.resumedLast24h ?? 0}</p>
          <p className="text-sm text-amber-700">
            Watchdog blocks: {payload?.metrics.autoResume.watchdogBlockedLast24h ?? 0}
          </p>
          <p className="text-sm text-red-700">
            Resume failures: {payload?.metrics.autoResume.failuresLast24h ?? 0}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4 space-y-2">
          <h2 className="text-sm font-semibold">Retry / Block Signals (24h)</h2>
          <p className="text-sm">
            Final-review retry exhausted: {payload?.metrics.retries.finalReviewRetryExhaustedLast24h ?? 0}
          </p>
          <p className="text-sm">
            Writing incomplete blocked: {payload?.metrics.retries.writingIncompleteBlockedLast24h ?? 0}
          </p>
          <p className="text-sm">
            Assignment blocked: {payload?.metrics.retries.assignmentBlockedLast24h ?? 0}
          </p>
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center gap-2">
          <AlertTriangle className="h-4 w-4" />
          <h2 className="text-sm font-semibold">Top Blocked Tasks</h2>
        </div>
        {payload?.blockedTasks.length ? (
          <div className="divide-y divide-border">
            {payload.blockedTasks.map((task) => (
              <div key={task.id} className="px-4 py-3 text-sm">
                <p className="font-medium">{task.title}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  stage {task.stage} · project {task.projectId ?? '—'} · {task.updatedAt ? new Date(task.updatedAt).toLocaleString() : 'unknown time'}
                </p>
                <p className="mt-1 text-red-700">{task.reason}</p>
                <div className="mt-2 flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void resumeTask(task.id)}
                    disabled={taskActionBusyId === task.id}
                  >
                    {taskActionBusyId === task.id ? (
                      <RefreshCw className="h-3.5 w-3.5 mr-1 animate-spin" />
                    ) : null}
                    Resume
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void recoverTask(task.id, task.stage)}
                    disabled={taskActionBusyId === task.id}
                  >
                    Recover
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="px-4 py-6 text-sm text-muted-foreground">No blocked workflow tasks in this scope.</div>
        )}
      </section>
    </div>
  );
}

function Metric(props: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2">
      <p className="text-xs text-muted-foreground">{props.label}</p>
      <p className="text-xl font-semibold">{props.value}</p>
    </div>
  );
}
