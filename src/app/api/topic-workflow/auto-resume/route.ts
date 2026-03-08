import { NextRequest, NextResponse } from 'next/server';
import { api } from '../../../../../convex/_generated/api';
import type { Id } from '../../../../../convex/_generated/dataModel';
import { eq } from 'drizzle-orm';
import { db, ensureDb } from '@/db';
import { projects } from '@/db/schema';
import { requireRole, type AppUser } from '@/lib/auth';
import {
  getAccessibleProjectIds,
  getRequestedProjectId,
  isAdminUser,
  userCanAccessProject,
} from '@/lib/access';
import { getConvexClient } from '@/lib/convex/server';
import { runTopicWorkflow } from '@/lib/topic-workflow-runner';
import { logAlertEvent, logAuditEvent } from '@/lib/observability';
import {
  autoScaleProjectWriterLanes,
  parseProjectRuntimeSettings,
  strictProjectAgentPoolsEnabled,
} from '@/lib/agents/runtime-agent-pools';
import {
  backfillProjectTaskStagePlans,
  repairProjectWriterRoutes,
} from '@/lib/workflow/stage-routing';
import type { TopicStageKey } from '@/lib/content-workflow-taxonomy';
import {
  getDefaultWorkflowOpsSettings,
  getWorkflowOpsSettings,
  type WorkflowOpsSettings,
} from '@/lib/workflow/ops-settings';
import { isWorkflowCronAuthorized } from '@/lib/workflow/cron-auth';

const DEFAULT_MAX_RESUMES = 4;
const MAX_SCAN_PER_PROJECT = 500;
const DEFAULT_WATCHDOG_MAX_RETRIES = 2;
const MAX_WATCHDOG_MAX_RETRIES = 8;
const DEFAULT_WATCHDOG_RETRY_BACKOFF_SECONDS = 120;
const WATCHDOG_RETRY_REASON_CODE = 'stage_timeout_watchdog_retry_scheduled';
const WATCHDOG_BLOCK_REASON_CODE = 'stage_timeout_watchdog_exhausted';
const RECOVERABLE_AUTO_STAGES = new Set<TopicStageKey>([
  'seo_intel_review',
  'outline_build',
  'editing',
  'prewrite_context',
  'final_review',
  'writing',
]);

type WorkflowTask = {
  _id: Id<'tasks'>;
  projectId?: number | null;
  title: string;
  workflowTemplateKey?: string;
  workflowCurrentStageKey?: string;
  workflowStageStatus?: string;
  workflowRunNotBeforeAt?: number | null;
  workflowLastEventAt?: number | null;
  updatedAt?: number | null;
  status: string;
};

type WorkflowEventLike = {
  stageKey?: string;
  eventType?: string;
  payload?: unknown;
};

function parseOptionalNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function timeoutMsFromSettings(settings: WorkflowOpsSettings): number {
  return Math.max(5, settings.stageTimeoutMinutes) * 60 * 1000;
}

function parsePayloadReasonCode(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const root = payload as { reasonCode?: unknown; meta?: { reasonCode?: unknown } };
  const direct = typeof root.reasonCode === 'string' ? root.reasonCode : null;
  if (direct) return direct;
  const nested = typeof root.meta?.reasonCode === 'string' ? root.meta.reasonCode : null;
  return nested;
}

function resolveWatchdogMaxRetries(): number {
  return clamp(
    parseOptionalNumber(process.env.WORKFLOW_STAGE_TIMEOUT_MAX_RETRIES) ??
      DEFAULT_WATCHDOG_MAX_RETRIES,
    1,
    MAX_WATCHDOG_MAX_RETRIES
  );
}

function resolveWatchdogBackoffMs(): number {
  const seconds = clamp(
    parseOptionalNumber(process.env.WORKFLOW_STAGE_TIMEOUT_RETRY_BACKOFF_SECONDS) ??
      DEFAULT_WATCHDOG_RETRY_BACKOFF_SECONDS,
    30,
    3600
  );
  return seconds * 1000;
}

async function countWatchdogRetriesForStage(
  convex: NonNullable<ReturnType<typeof getConvexClient>>,
  taskId: Id<'tasks'>,
  stage: TopicStageKey
): Promise<number> {
  const history = await convex.query(api.topicWorkflow.listWorkflowHistory, {
    taskId,
    limit: 120,
  });
  const events = (history.events || []) as WorkflowEventLike[];
  return events.filter((event) => {
    if (event.stageKey !== stage) return false;
    if (event.eventType !== 'stage_progress') return false;
    const reasonCode = parsePayloadReasonCode(event.payload);
    return reasonCode === WATCHDOG_RETRY_REASON_CODE;
  }).length;
}

function interleaveCandidates(
  groups: WorkflowTask[][],
  maxItems: number
): WorkflowTask[] {
  const seen = new Set<string>();
  const queues = groups.map((group) => [...group]);
  const out: WorkflowTask[] = [];

  while (out.length < maxItems) {
    let advanced = false;
    for (const queue of queues) {
      if (out.length >= maxItems) break;
      const next = queue.shift();
      if (!next) continue;
      const key = String(next._id);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(next);
      advanced = true;
    }
    if (!advanced) break;
  }

  return out;
}

async function parseInput(
  req: NextRequest
): Promise<{ requestedProjectId: number | null; requestedMaxResumes: number | null }> {
  if (req.method === 'GET') {
    return {
      requestedProjectId: parseOptionalNumber(req.nextUrl.searchParams.get('projectId')),
      requestedMaxResumes: parseOptionalNumber(req.nextUrl.searchParams.get('maxResumes')),
    };
  }

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  return {
    requestedProjectId: parseOptionalNumber((body as { projectId?: unknown }).projectId),
    requestedMaxResumes: parseOptionalNumber((body as { maxResumes?: unknown }).maxResumes),
  };
}

async function executeAutoResume(req: NextRequest) {
  await ensureDb();
  const cronAuthorized = isWorkflowCronAuthorized(req.headers);
  let actorUser: AppUser | null = null;

  if (cronAuthorized) {
    actorUser = {
      id: 'system:workflow-cron',
      email: 'workflow-cron@system.local',
      name: 'Workflow Cron',
      image: null,
      role: 'owner',
    };
  } else {
    const auth = await requireRole('editor');
    if (auth.error) return auth.error;
    actorUser = auth.user;
  }

  try {
    const convex = getConvexClient();
    if (!convex) {
      return NextResponse.json(
        { error: 'Mission Control is not configured (Convex URL missing)' },
        { status: 500 }
      );
    }

    const input = await parseInput(req);
    const requestedProjectId =
      cronAuthorized ? null : input.requestedProjectId ?? getRequestedProjectId(req);
    const requestedMaxResumes = input.requestedMaxResumes;

    let projectIds: number[] = [];
    if (requestedProjectId !== null) {
      if (!(await userCanAccessProject(actorUser, requestedProjectId))) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
      projectIds = [requestedProjectId];
    } else if (cronAuthorized || isAdminUser(actorUser)) {
      const rows = await db.select({ id: projects.id }).from(projects);
      projectIds = rows.map((row: (typeof rows)[number]) => row.id);
    } else {
      projectIds = await getAccessibleProjectIds(actorUser);
    }

    if (projectIds.length === 0) {
      return NextResponse.json({
        scanned: 0,
        resumed: 0,
        resumedCount: 0,
        queued: 0,
        queuedWriting: 0,
        readyResearch: 0,
        recoverableActive: 0,
        retried: 0,
        blockedAfterRetries: 0,
        watchdogBlocked: 0,
        failures: [],
      });
    }

    const defaultOps = getDefaultWorkflowOpsSettings();
    const settingsByProject = new Map<number, WorkflowOpsSettings>();
    await Promise.all(
      projectIds.map(async (projectId) => {
        const settings = await getWorkflowOpsSettings(projectId);
        settingsByProject.set(projectId, settings);
      })
    );

    const inferredMaxResumes =
      requestedMaxResumes ??
      Math.max(
        DEFAULT_MAX_RESUMES,
        ...Array.from(settingsByProject.values()).map((settings) => settings.autoResumeMaxResumes)
      );
    const maxResumes = clamp(inferredMaxResumes, 1, 24);

    const taskChunks = await Promise.all(
      projectIds.map((projectId) =>
        convex.query(api.tasks.list, {
          projectId,
          limit: MAX_SCAN_PER_PROJECT,
        })
      )
    );

    const allTasks = taskChunks.flat() as WorkflowTask[];
    const workflowTasks = allTasks.filter(
      (task) => task.workflowTemplateKey === 'topic_production_v1'
    );

    const now = Date.now();
    const watchdogMaxRetries = resolveWatchdogMaxRetries();
    const watchdogBackoffMs = resolveWatchdogBackoffMs();

    const staleWorkingTasks = workflowTasks.filter((task) => {
      if (task.workflowStageStatus !== 'in_progress') return false;
      const stage = (task.workflowCurrentStageKey || 'research') as TopicStageKey;
      if (stage === 'complete') return false;
      const lastEventAt = task.workflowLastEventAt || task.updatedAt || 0;
      const projectSettings =
        (task.projectId ? settingsByProject.get(task.projectId) : null) ?? defaultOps;
      return now - lastEventAt > timeoutMsFromSettings(projectSettings);
    });

    let retried = 0;
    let blockedAfterRetries = 0;
    let watchdogBlocked = 0;

    for (const task of staleWorkingTasks) {
      const stage = (task.workflowCurrentStageKey || 'research') as TopicStageKey;
      const projectSettings =
        (task.projectId ? settingsByProject.get(task.projectId) : null) ?? defaultOps;
      const stageTimeoutMs = timeoutMsFromSettings(projectSettings);
      const previousLastEventAt = task.workflowLastEventAt || task.updatedAt || null;
      const previousRetries = await countWatchdogRetriesForStage(convex, task._id, stage);
      const retryAttempt = previousRetries + 1;

      if (retryAttempt <= watchdogMaxRetries) {
        const nextRetryAt = now + retryAttempt * watchdogBackoffMs;
        const summary =
          `Watchdog retry ${retryAttempt}/${watchdogMaxRetries} for ${stage} ` +
          `scheduled in ${Math.ceil((nextRetryAt - now) / 1000)}s.`;

        await convex.mutation(api.tasks.update, {
          id: task._id,
          expectedProjectId: task.projectId ?? undefined,
          status: 'PENDING',
          workflowStageStatus: 'active',
          workflowRunNotBeforeAt: nextRetryAt,
          workflowLastEventAt: now,
          workflowLastEventText: summary,
        });

        await convex.mutation(api.topicWorkflow.recordStageProgress, {
          taskId: task._id,
          stageKey: stage,
          summary,
          actorType: 'system',
          actorId: actorUser.id,
          actorName: 'Workflow Watchdog',
          payload: {
            status: 'retrying',
            reasonCode: WATCHDOG_RETRY_REASON_CODE,
            timeoutMs: stageTimeoutMs,
            previousLastEventAt,
            retryAttempt,
            maxRetries: watchdogMaxRetries,
            nextRetryAt,
          },
        });

        retried += 1;
        continue;
      }

      const summary =
        `Watchdog blocked ${stage}: no progress in ${Math.floor(stageTimeoutMs / 60000)}m ` +
        `after ${watchdogMaxRetries} retries.`;

      await convex.mutation(api.tasks.update, {
        id: task._id,
        expectedProjectId: task.projectId ?? undefined,
        workflowStageStatus: 'blocked',
        workflowLastEventAt: now,
        workflowLastEventText: summary,
      });

      await convex.mutation(api.topicWorkflow.recordStageProgress, {
        taskId: task._id,
        stageKey: stage,
        summary,
        actorType: 'system',
        actorId: actorUser.id,
        actorName: 'Workflow Watchdog',
        payload: {
          status: 'blocked',
          reasonCode: WATCHDOG_BLOCK_REASON_CODE,
          timeoutMs: stageTimeoutMs,
          previousLastEventAt,
          retryAttempt,
          maxRetries: watchdogMaxRetries,
        },
      });

      blockedAfterRetries += 1;
      watchdogBlocked += 1;
    }

    const strictPools = strictProjectAgentPoolsEnabled();
    const laneScalingByProject = new Map<number, { scaledUp: number; scaledDown: number }>();
    if (!strictPools) {
      for (const projectId of projectIds) {
        const [projectRow] = await db
          .select({ settings: projects.settings })
          .from(projects)
          .where(eq(projects.id, projectId))
          .limit(1);
        const runtimeSettings = parseProjectRuntimeSettings(projectRow?.settings ?? {});
        const scaled = await autoScaleProjectWriterLanes({
          projectId,
          laneCapacity: runtimeSettings.laneCapacity,
        });
        laneScalingByProject.set(projectId, scaled);
      }
    }
    const scaledUpWriters = Array.from(laneScalingByProject.values()).reduce(
      (sum, item) => sum + item.scaledUp,
      0
    );
    const scaledDownWriters = Array.from(laneScalingByProject.values()).reduce(
      (sum, item) => sum + item.scaledDown,
      0
    );

    const queuedWritingTasks = workflowTasks
      .filter((task) => {
        if (task.workflowCurrentStageKey !== 'writing') return false;
        if (task.workflowStageStatus !== 'queued') return false;
        const runNotBeforeAt = task.workflowRunNotBeforeAt ?? 0;
        return runNotBeforeAt <= now;
      })
      .sort(
        (a, b) =>
          (a.workflowLastEventAt || a.updatedAt || 0) -
          (b.workflowLastEventAt || b.updatedAt || 0)
      );

    const queuedByProject = new Map<number, WorkflowTask[]>();
    for (const task of queuedWritingTasks) {
      if (!task.projectId) continue;
      const existing = queuedByProject.get(task.projectId) || [];
      existing.push(task);
      queuedByProject.set(task.projectId, existing);
    }
    const writerRouteRepairs: Record<
      number,
      {
        routesHealthy: number;
        routesPatched: number;
        writersSeeded: number;
        staleLocksRecovered: number;
        stagePlanScanned: number;
        stagePlanUpdated: number;
        stagePlanSkipped: number;
      }
    > = {};
    for (const [projectId, queued] of queuedByProject.entries()) {
      if (queued.length === 0) continue;
      try {
        const repair = await repairProjectWriterRoutes({
          projectId,
          userId: actorUser.id,
          canonicalizeInvalidBlog: true,
        });
        writerRouteRepairs[projectId] = {
          routesHealthy: repair.routesHealthy,
          routesPatched: repair.routesPatched,
          writersSeeded: repair.writersSeeded,
          staleLocksRecovered: repair.staleLocksRecovered,
          stagePlanScanned: 0,
          stagePlanUpdated: 0,
          stagePlanSkipped: 0,
        };
        const stagePlanBackfill = await backfillProjectTaskStagePlans({
          projectId,
          userId: actorUser.id,
          force: true,
        });
        writerRouteRepairs[projectId] = {
          ...writerRouteRepairs[projectId],
          stagePlanScanned: stagePlanBackfill.scanned,
          stagePlanUpdated: stagePlanBackfill.updated,
          stagePlanSkipped: stagePlanBackfill.skipped,
        };
      } catch (error) {
        await logAlertEvent({
          source: 'topic_workflow',
          eventType: 'writer_route_repair_failed',
          severity: 'warning',
          projectId,
          message: `Failed to repair writer routes before auto-resume for ${queued.length} queued writing task(s).`,
          metadata: {
            queuedWriting: queued.length,
            error: error instanceof Error ? error.message : 'Unknown error',
          },
        });
      }
    }
    for (const [projectId, queued] of queuedByProject.entries()) {
      const writers = await convex.query(api.agents.list, {
        projectId,
        role: 'writer',
        limit: 120,
      });
      const available = (writers || []).filter((writer) => {
        const status = String(writer.status || '').toUpperCase();
        return status === 'ONLINE' || status === 'IDLE';
      }).length;
      if (available === 0 && queued.length > 0) {
        await logAlertEvent({
          source: 'topic_workflow',
          eventType: 'writer_pool_empty',
          severity: 'warning',
          projectId,
          message: `Writer pool unavailable: ${queued.length} writing task(s) queued.`,
          metadata: {
            queuedWriting: queued.length,
            queuedTaskIds: queued.slice(0, 10).map((task) => String(task._id)),
          },
        });
      }
    }

    const readyRecoverableTasks = workflowTasks
      .filter((task) => {
        const stage = (task.workflowCurrentStageKey || 'research') as TopicStageKey;
        if (!RECOVERABLE_AUTO_STAGES.has(stage)) return false;
        if (task.workflowStageStatus === 'blocked') return false;
        if (task.workflowStageStatus === 'queued') return false;
        if (task.status === 'IN_PROGRESS') return false;
        const runNotBeforeAt = task.workflowRunNotBeforeAt ?? 0;
        return runNotBeforeAt <= now;
      })
      .sort(
        (a, b) =>
          (a.workflowRunNotBeforeAt || a.workflowLastEventAt || a.updatedAt || 0) -
          (b.workflowRunNotBeforeAt || b.workflowLastEventAt || b.updatedAt || 0)
      );

    const readyResearchTasks = workflowTasks
      .filter((task) => {
        if (task.workflowCurrentStageKey !== 'research') return false;
        if (task.status === 'IN_PROGRESS') return false;
        if (task.workflowStageStatus === 'blocked') return false;
        if (task.workflowStageStatus === 'queued') return false;
        const runNotBeforeAt = task.workflowRunNotBeforeAt ?? 0;
        return runNotBeforeAt <= now;
      })
      .sort(
        (a, b) =>
          (a.workflowRunNotBeforeAt || a.workflowLastEventAt || a.updatedAt || 0) -
          (b.workflowRunNotBeforeAt || b.workflowLastEventAt || b.updatedAt || 0)
      );

    const failures: Array<{ taskId: string; error: string }> = [];
    let resumed = 0;
    const toResume = interleaveCandidates(
      [queuedWritingTasks, readyRecoverableTasks, readyResearchTasks],
      maxResumes
    );

    for (const task of toResume) {
      try {
        const projectSettings =
          (task.projectId ? settingsByProject.get(task.projectId) : null) ?? defaultOps;
        const result = await runTopicWorkflow({
          user: actorUser,
          taskId: task._id,
          autoContinue: true,
          maxStages: projectSettings.maxStagesPerRun,
        });
        if (result.runs.length > 0) {
          resumed += 1;
        }
      } catch (error) {
        failures.push({
          taskId: String(task._id),
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    const lastSuccessAt = new Date().toISOString();
    await logAuditEvent({
      userId: cronAuthorized ? null : actorUser.id,
      action: 'topic_workflow.auto_resume',
      resourceType: 'task',
      severity: failures.length > 0 ? 'warning' : 'info',
      metadata: {
        heartbeatStatus: 'success',
        lastSuccessAt,
        projectIds,
        scanned: workflowTasks.length,
        readyResearch: readyResearchTasks.length,
        recoverableActive: readyRecoverableTasks.length,
        queuedWriting: queuedWritingTasks.length,
        maxResumes,
        resumed,
        resumedCount: resumed,
        retried,
        blockedAfterRetries,
        watchdogBlocked,
        watchdogMaxRetries,
        strictPoolRouting: strictPools,
        scaledUpWriters,
        scaledDownWriters,
        laneScalingByProject: Object.fromEntries(laneScalingByProject.entries()),
        writerRouteRepairs,
        failures,
        projectSettings: Object.fromEntries(
          Array.from(settingsByProject.entries()).map(([projectId, settings]) => [
            projectId,
            {
              stageTimeoutMinutes: settings.stageTimeoutMinutes,
              autoResumeMaxResumes: settings.autoResumeMaxResumes,
              maxStagesPerRun: settings.maxStagesPerRun,
            },
          ])
        ),
      },
    });

    return NextResponse.json({
      scanned: workflowTasks.length,
      readyResearch: readyResearchTasks.length,
      recoverableActive: readyRecoverableTasks.length,
      queued: queuedWritingTasks.length,
      queuedWriting: queuedWritingTasks.length,
      resumed,
      resumedCount: resumed,
      retried,
      blockedAfterRetries,
      watchdogBlocked,
      strictPoolRouting: strictPools,
      scaledUpWriters,
      scaledDownWriters,
      writerRouteRepairs,
      failures,
    });
  } catch (error) {
    await logAlertEvent({
      source: 'topic_workflow',
      eventType: 'auto_resume_failed',
      severity: 'error',
      message: 'Automatic workflow resume failed.',
      metadata: { error: error instanceof Error ? error.message : 'Unknown error' },
    });
    await logAuditEvent({
      userId: cronAuthorized ? null : actorUser?.id || null,
      action: 'topic_workflow.auto_resume',
      resourceType: 'task',
      severity: 'error',
      metadata: {
        heartbeatStatus: 'failed',
        error: error instanceof Error ? error.message : 'Unknown error',
      },
    });
    console.error('Workflow auto-resume failed:', error);
    return NextResponse.json(
      { error: 'Failed to auto-resume workflows' },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  return executeAutoResume(req);
}

export async function POST(req: NextRequest) {
  return executeAutoResume(req);
}
