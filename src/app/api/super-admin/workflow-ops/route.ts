import { NextRequest, NextResponse } from 'next/server';
import { desc, eq } from 'drizzle-orm';
import { api } from '../../../../../convex/_generated/api';
import { db, ensureDb } from '@/db';
import { alertEvents, auditLogs, projects } from '@/db/schema';
import { requireRole } from '@/lib/auth';
import { userCanAccessProject } from '@/lib/access';
import { getConvexClient } from '@/lib/convex/server';
import {
  getDefaultWorkflowOpsSettings,
  getWorkflowOpsSettings,
  updateProjectWorkflowOpsSettings,
  type WorkflowOpsSettings,
} from '@/lib/workflow/ops-settings';
import {
  TOPIC_STAGE_LABELS,
  resolveWorkflowRuntimeState,
  type TopicStageKey,
} from '@/lib/content-workflow-taxonomy';
import { logAlertEvent, logAuditEvent } from '@/lib/observability';

type WorkflowTask = {
  _id: string;
  projectId?: number | null;
  title: string;
  status: string;
  workflowTemplateKey?: string;
  workflowCurrentStageKey?: string;
  workflowStageStatus?: string;
  workflowLastEventAt?: number | null;
  workflowLastEventText?: string;
  updatedAt?: number | null;
  createdAt?: number;
};

type WorkflowAgent = {
  _id: string;
  name: string;
  role: string;
  status: string;
  currentTaskId?: string | null;
  updatedAt?: number | null;
};

const DEFAULT_WRITER_LOCK_TIMEOUT_MS = 25 * 60 * 1000;

const WORKFLOW_STAGE_KEYS: TopicStageKey[] = [
  'research',
  'seo_intel_review',
  'outline_build',
  'outline_review',
  'prewrite_context',
  'writing',
  'final_review',
  'complete',
];

const MAX_TASKS_PER_PROJECT = 500;

function parseProjectId(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
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

function toEpochMs(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalizeAgentStatus(status: string | null | undefined): 'ONLINE' | 'IDLE' | 'WORKING' | 'OFFLINE' {
  const normalized = String(status || '')
    .trim()
    .toUpperCase();
  if (normalized === 'ONLINE') return 'ONLINE';
  if (normalized === 'IDLE') return 'IDLE';
  if (normalized === 'WORKING') return 'WORKING';
  return 'OFFLINE';
}

function resolveWriterLockTimeoutMs(): number {
  const parsed = Number.parseInt(
    String(process.env.WORKFLOW_WRITER_LOCK_TIMEOUT_MINUTES ?? ''),
    10
  );
  if (!Number.isFinite(parsed)) return DEFAULT_WRITER_LOCK_TIMEOUT_MS;
  return clamp(parsed, 5, 180) * 60 * 1000;
}

export async function GET(req: NextRequest) {
  await ensureDb();
  const auth = await requireRole('super_admin');
  if (auth.error) return auth.error;

  try {
    const convex = getConvexClient();
    if (!convex) {
      return NextResponse.json(
        { error: 'Mission Control is not configured (Convex URL missing)' },
        { status: 500 }
      );
    }

    const requestedProjectId = parseProjectId(req.nextUrl.searchParams.get('projectId'));
    if (requestedProjectId !== null && !(await userCanAccessProject(auth.user, requestedProjectId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const projectRows = await db
      .select({ id: projects.id, name: projects.name })
      .from(projects)
      .orderBy(projects.name);

    const selectedProjectIds: number[] =
      requestedProjectId !== null
        ? [requestedProjectId]
        : projectRows.map((project: (typeof projectRows)[number]) => project.id);

    if (selectedProjectIds.length === 0) {
      return NextResponse.json({
        projects: [],
        selectedProjectId: requestedProjectId,
        settings: getDefaultWorkflowOpsSettings(),
        metrics: {
          totals: {
            total: 0,
            active: 0,
            working: 0,
            needsInput: 0,
            queued: 0,
            blocked: 0,
            complete: 0,
          },
          byStage: [],
          autoResume: {
            lastRunAt: null,
            lastSuccessAt: null,
            runsLast24h: 0,
            resumedLast24h: 0,
            retriedLast24h: 0,
            blockedAfterRetriesLast24h: 0,
            watchdogBlockedLast24h: 0,
            failuresLast24h: 0,
          },
          retries: {
            finalReviewRetryExhaustedLast24h: 0,
            writingIncompleteBlockedLast24h: 0,
            assignmentBlockedLast24h: 0,
          },
          writerPool: {
            totalWriters: 0,
            availableWriters: 0,
            onlineWriters: 0,
            idleWriters: 0,
            workingWriters: 0,
            offlineWriters: 0,
            staleWorkingLocks: 0,
            unknownTaskLocks: 0,
            queuedWritingTasks: 0,
            sampledAt: null,
            writers: [],
          },
        },
        blockedTasks: [],
      });
    }

    const [taskChunks, settingsPairs, autoResumeAudits, workflowAlerts, allAgents] = await Promise.all([
      Promise.all(
        selectedProjectIds.map((projectId: number) =>
          convex.query(api.tasks.list, { projectId, limit: MAX_TASKS_PER_PROJECT })
        )
      ),
      Promise.all(
        selectedProjectIds.map(async (projectId: number) => [projectId, await getWorkflowOpsSettings(projectId)] as const)
      ),
      db
        .select({
          id: auditLogs.id,
          projectId: auditLogs.projectId,
          metadata: auditLogs.metadata,
          createdAt: auditLogs.createdAt,
        })
        .from(auditLogs)
        .where(eq(auditLogs.action, 'topic_workflow.auto_resume'))
        .orderBy(desc(auditLogs.createdAt))
        .limit(500),
      db
        .select({
          id: alertEvents.id,
          eventType: alertEvents.eventType,
          projectId: alertEvents.projectId,
          createdAt: alertEvents.createdAt,
        })
        .from(alertEvents)
        .where(eq(alertEvents.source, 'topic_workflow'))
        .orderBy(desc(alertEvents.createdAt))
        .limit(500),
      convex.query(api.agents.list, { limit: 500 }),
    ]);

    const settingsMap = new Map<number, WorkflowOpsSettings>(settingsPairs);
    const defaultSettings = getDefaultWorkflowOpsSettings();
    const settings =
      requestedProjectId !== null
        ? settingsMap.get(requestedProjectId) || defaultSettings
        : defaultSettings;

    const allTasks = taskChunks.flat() as WorkflowTask[];
    const scopedAgents = (allAgents as WorkflowAgent[]).filter((agent) => {
      if (requestedProjectId !== null) {
        return Number((agent as unknown as { projectId?: number }).projectId) === requestedProjectId;
      }
      const isDedicated = (agent as unknown as { isDedicated?: boolean }).isDedicated;
      return isDedicated !== false;
    });
    const taskById = new Map<string, WorkflowTask>(
      allTasks.map((task) => [String(task._id), task])
    );
    const workflowTasks = allTasks.filter((task) => task.workflowTemplateKey === 'topic_production_v1');
    const now = Date.now();
    const windowStart = now - 24 * 60 * 60 * 1000;
    const writerLockTimeoutMs = resolveWriterLockTimeoutMs();

    const totals = {
      total: workflowTasks.length,
      active: 0,
      working: 0,
      needsInput: 0,
      queued: 0,
      blocked: 0,
      complete: 0,
    };

    const stageAccumulator = new Map<
      string,
      {
        stage: string;
        label: string;
        count: number;
        blocked: number;
        queued: number;
        inProgress: number;
        totalAgeMs: number;
        maxAgeMs: number;
      }
    >();

    for (const stageKey of WORKFLOW_STAGE_KEYS) {
      stageAccumulator.set(stageKey, {
        stage: stageKey,
        label: TOPIC_STAGE_LABELS[stageKey] || stageKey,
        count: 0,
        blocked: 0,
        queued: 0,
        inProgress: 0,
        totalAgeMs: 0,
        maxAgeMs: 0,
      });
    }

    const blockedTasks = workflowTasks
      .filter((task: (typeof workflowTasks)[number]) => task.workflowStageStatus === 'blocked')
      .sort(
        (a: (typeof workflowTasks)[number], b: (typeof workflowTasks)[number]) =>
          (b.workflowLastEventAt || b.updatedAt || 0) -
          (a.workflowLastEventAt || a.updatedAt || 0)
      )
      .slice(0, 12)
      .map((task: (typeof workflowTasks)[number]) => ({
        id: String(task._id),
        title: task.title,
        projectId: task.projectId ?? null,
        stage: task.workflowCurrentStageKey || 'research',
        status: task.status,
        reason: task.workflowLastEventText || 'Blocked',
        updatedAt: task.workflowLastEventAt || task.updatedAt || task.createdAt || null,
      }));

    for (const task of workflowTasks) {
      const runtimeState = resolveWorkflowRuntimeState(task);
      if (runtimeState === 'active') totals.active += 1;
      if (runtimeState === 'working') totals.working += 1;
      if (runtimeState === 'needs_input') totals.needsInput += 1;
      if (runtimeState === 'queued') totals.queued += 1;
      if (runtimeState === 'blocked') totals.blocked += 1;
      if (runtimeState === 'complete') totals.complete += 1;

      const stageKey = (task.workflowCurrentStageKey || 'research') as TopicStageKey;
      const stageMetrics = stageAccumulator.get(stageKey);
      if (!stageMetrics) continue;

      stageMetrics.count += 1;
      if (task.workflowStageStatus === 'blocked') stageMetrics.blocked += 1;
      if (task.workflowStageStatus === 'queued') stageMetrics.queued += 1;
      if (task.workflowStageStatus === 'in_progress') stageMetrics.inProgress += 1;

      const lastTouch = task.workflowLastEventAt || task.updatedAt || task.createdAt || now;
      const ageMs = Math.max(0, now - lastTouch);
      stageMetrics.totalAgeMs += ageMs;
      stageMetrics.maxAgeMs = Math.max(stageMetrics.maxAgeMs, ageMs);
    }

    const autoResumeInScope = autoResumeAudits.filter((audit: (typeof autoResumeAudits)[number]) => {
      const ts = toEpochMs(audit.createdAt);
      if (ts < windowStart) return false;
      if (requestedProjectId === null) return true;
      return audit.projectId === requestedProjectId;
    });

    let resumedLast24h = 0;
    let retriedLast24h = 0;
    let blockedAfterRetriesLast24h = 0;
    let watchdogBlockedLast24h = 0;
    let failuresLast24h = 0;
    let lastSuccessAt: string | Date | null = null;

    for (const audit of autoResumeInScope as Array<(typeof autoResumeInScope)[number]>) {
      const metadata = parseObject(audit.metadata);
      const heartbeatStatus = String(metadata.heartbeatStatus || '').toLowerCase();
      const metadataLastSuccess = metadata.lastSuccessAt;
      if (!lastSuccessAt && (heartbeatStatus === 'success' || metadataLastSuccess)) {
        lastSuccessAt =
          (typeof metadataLastSuccess === 'string' || metadataLastSuccess instanceof Date)
            ? (metadataLastSuccess as string | Date)
            : audit.createdAt;
      }
      resumedLast24h += Number(metadata.resumed || 0);
      retriedLast24h += Number(metadata.retried || 0);
      blockedAfterRetriesLast24h += Number(metadata.blockedAfterRetries || 0);
      watchdogBlockedLast24h += Number(metadata.watchdogBlocked || 0);
      const failures = Array.isArray(metadata.failures) ? metadata.failures : [];
      failuresLast24h += failures.length;
    }

    const inScopeWorkflowAlerts = workflowAlerts.filter((alert: (typeof workflowAlerts)[number]) => {
      if (requestedProjectId === null) return true;
      return alert.projectId === requestedProjectId;
    });

    const retries = {
      finalReviewRetryExhaustedLast24h: 0,
      writingIncompleteBlockedLast24h: 0,
      assignmentBlockedLast24h: 0,
    };

    for (const alert of inScopeWorkflowAlerts) {
      const ts = toEpochMs(alert.createdAt);
      if (ts < windowStart) continue;
      if (alert.eventType === 'final_review_retry_exhausted') {
        retries.finalReviewRetryExhaustedLast24h += 1;
      } else if (alert.eventType === 'writing_incomplete_blocked') {
        retries.writingIncompleteBlockedLast24h += 1;
      } else if (alert.eventType === 'assignment_blocked' || alert.eventType === 'owner_role_mismatch') {
        retries.assignmentBlockedLast24h += 1;
      }
    }

    const writers = scopedAgents.filter(
      (agent) => agent.role.toLowerCase() === 'writer'
    );
    let staleWorkingLocks = 0;
    let unknownTaskLocks = 0;
    const writerRows = writers.map((writer) => {
      const currentTaskId = writer.currentTaskId ? String(writer.currentTaskId) : null;
      const linkedTask = currentTaskId ? taskById.get(currentTaskId) : undefined;
      let lockHealth: 'healthy' | 'stale' | 'unknown_task' | 'idle' | 'offline' = 'healthy';

      const writerStatus = normalizeAgentStatus(writer.status);
      if (writerStatus === 'OFFLINE') {
        lockHealth = 'offline';
      } else if (writerStatus !== 'WORKING') {
        lockHealth = 'idle';
      } else if (!currentTaskId) {
        staleWorkingLocks += 1;
        lockHealth = 'stale';
      } else if (!linkedTask) {
        unknownTaskLocks += 1;
        lockHealth = 'unknown_task';
      } else {
        const taskStage = (linkedTask.workflowCurrentStageKey || 'research') as TopicStageKey;
        const taskStageStatus = linkedTask.workflowStageStatus || 'in_progress';
        const taskStillWriting =
          taskStage === 'writing' &&
          taskStageStatus === 'in_progress' &&
          linkedTask.status === 'IN_PROGRESS';
        const taskLastTouch =
          linkedTask.workflowLastEventAt || linkedTask.updatedAt || linkedTask.createdAt || 0;
        const timedOut =
          taskLastTouch > 0 ? now - taskLastTouch > writerLockTimeoutMs : false;
        if (!taskStillWriting || timedOut) {
          staleWorkingLocks += 1;
          lockHealth = 'stale';
        }
      }

      return {
        id: String(writer._id),
        name: writer.name,
        status: writerStatus,
        currentTaskId,
        lockHealth,
      };
    });

    const onlineWriters = writers.filter((writer) => normalizeAgentStatus(writer.status) === 'ONLINE').length;
    const idleWriters = writers.filter((writer) => normalizeAgentStatus(writer.status) === 'IDLE').length;
    const workingWriters = writers.filter((writer) => normalizeAgentStatus(writer.status) === 'WORKING').length;
    const offlineWriters = writers.filter((writer) => normalizeAgentStatus(writer.status) === 'OFFLINE').length;
    const queuedWritingTasks = workflowTasks.filter(
      (task) =>
        task.workflowCurrentStageKey === 'writing' &&
        task.workflowStageStatus === 'queued'
    ).length;

    const recommended = {
      stageTimeoutMinutes: clamp(
        settings.stageTimeoutMinutes + (watchdogBlockedLast24h > 2 ? 5 : 0),
        5,
        180
      ),
      finalReviewMaxRevisions: clamp(
        settings.finalReviewMaxRevisions +
          (retries.finalReviewRetryExhaustedLast24h > 0 ? 1 : 0),
        1,
        8
      ),
    };

    return NextResponse.json({
      projects: projectRows,
      selectedProjectId: requestedProjectId,
      settings,
      metrics: {
        totals,
        byStage: Array.from(stageAccumulator.values()).map((entry) => ({
          stage: entry.stage,
          label: entry.label,
          count: entry.count,
          blocked: entry.blocked,
          queued: entry.queued,
          inProgress: entry.inProgress,
          avgAgeMinutes: entry.count > 0 ? Number((entry.totalAgeMs / entry.count / 60000).toFixed(1)) : 0,
          maxAgeMinutes: Number((entry.maxAgeMs / 60000).toFixed(1)),
        })),
        autoResume: {
          lastRunAt: autoResumeAudits[0]?.createdAt || null,
          lastSuccessAt: lastSuccessAt || null,
          runsLast24h: autoResumeInScope.length,
          resumedLast24h,
          retriedLast24h,
          blockedAfterRetriesLast24h,
          watchdogBlockedLast24h,
          failuresLast24h,
        },
        retries,
        writerPool: {
          totalWriters: writers.length,
          availableWriters: onlineWriters + idleWriters,
          onlineWriters,
          idleWriters,
          workingWriters,
          offlineWriters,
          staleWorkingLocks,
          unknownTaskLocks,
          queuedWritingTasks,
          sampledAt: new Date().toISOString(),
          writers: writerRows,
        },
      },
      blockedTasks,
      recommendations: recommended,
    });
  } catch (error) {
    await logAlertEvent({
      source: 'super_admin',
      eventType: 'workflow_ops_dashboard_failed',
      severity: 'error',
      message: 'Failed to load workflow ops dashboard.',
      metadata: { error: error instanceof Error ? error.message : 'Unknown error' },
    });
    return NextResponse.json({ error: 'Failed to load workflow ops data' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  await ensureDb();
  const auth = await requireRole('super_admin');
  if (auth.error) return auth.error;

  try {
    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const projectId = parseProjectId(String(body.projectId || ''));
    if (!projectId) {
      return NextResponse.json({ error: 'projectId is required' }, { status: 400 });
    }
    if (!(await userCanAccessProject(auth.user, projectId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const updatedSettings = await updateProjectWorkflowOpsSettings(projectId, {
      stageTimeoutMinutes: Number(body.stageTimeoutMinutes),
      finalReviewMaxRevisions: Number(body.finalReviewMaxRevisions),
      autoResumeMaxResumes: Number(body.autoResumeMaxResumes),
      initialStartDelaySeconds: Number(body.initialStartDelaySeconds),
      maxStagesPerRun: Number(body.maxStagesPerRun),
    });

    await logAuditEvent({
      userId: auth.user.id,
      action: 'super_admin.workflow_ops.update',
      resourceType: 'project',
      resourceId: projectId,
      projectId,
      metadata: {
        ...updatedSettings,
      },
      severity: 'warning',
    });

    return NextResponse.json({
      projectId,
      settings: updatedSettings,
    });
  } catch (error) {
    await logAlertEvent({
      source: 'super_admin',
      eventType: 'workflow_ops_update_failed',
      severity: 'error',
      message: 'Failed to update workflow ops settings.',
      metadata: { error: error instanceof Error ? error.message : 'Unknown error' },
    });
    return NextResponse.json({ error: 'Failed to update workflow ops settings' }, { status: 500 });
  }
}
