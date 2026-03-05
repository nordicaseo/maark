import { NextRequest, NextResponse } from 'next/server';
import { api } from '../../../../../convex/_generated/api';
import type { Id } from '../../../../../convex/_generated/dataModel';
import { db, ensureDb } from '@/db';
import { projects } from '@/db/schema';
import { requireRole } from '@/lib/auth';
import {
  getAccessibleProjectIds,
  getRequestedProjectId,
  isAdminUser,
  userCanAccessProject,
} from '@/lib/access';
import { getConvexClient } from '@/lib/convex/server';
import { runTopicWorkflow } from '@/lib/topic-workflow-runner';
import { logAlertEvent, logAuditEvent } from '@/lib/observability';
import type { TopicStageKey } from '@/lib/content-workflow-taxonomy';

const STAGE_TIMEOUT_MS = 25 * 60 * 1000;
const DEFAULT_MAX_RESUMES = 4;
const MAX_SCAN_PER_PROJECT = 500;

type WorkflowTask = {
  _id: Id<'tasks'>;
  projectId?: number | null;
  title: string;
  workflowTemplateKey?: string;
  workflowCurrentStageKey?: string;
  workflowStageStatus?: string;
  workflowLastEventAt?: number | null;
  updatedAt?: number | null;
  status: string;
};

function parseOptionalNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export async function POST(req: NextRequest) {
  await ensureDb();
  const auth = await requireRole('editor');
  if (auth.error) return auth.error;

  try {
    const convex = getConvexClient();
    if (!convex) {
      return NextResponse.json(
        { error: 'Mission Control is not configured (Convex URL missing)' },
        { status: 500 }
      );
    }

    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const requestedProjectId =
      parseOptionalNumber((body as { projectId?: unknown }).projectId) ??
      getRequestedProjectId(req);
    const maxResumes = clamp(
      Number((body as { maxResumes?: unknown }).maxResumes) || DEFAULT_MAX_RESUMES,
      1,
      12
    );

    let projectIds: number[] = [];
    if (requestedProjectId !== null) {
      if (!(await userCanAccessProject(auth.user, requestedProjectId))) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
      projectIds = [requestedProjectId];
    } else if (isAdminUser(auth.user)) {
      const rows = await db.select({ id: projects.id }).from(projects);
      projectIds = rows.map((row: (typeof rows)[number]) => row.id);
    } else {
      projectIds = await getAccessibleProjectIds(auth.user);
    }

    if (projectIds.length === 0) {
      return NextResponse.json({
        scanned: 0,
        resumed: 0,
        queued: 0,
        watchdogBlocked: 0,
        failures: [],
      });
    }

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

    const queuedWritingTasks = workflowTasks
      .filter(
        (task) =>
          task.workflowCurrentStageKey === 'writing' &&
          task.workflowStageStatus === 'queued'
      )
      .sort(
        (a, b) =>
          (a.workflowLastEventAt || a.updatedAt || 0) -
          (b.workflowLastEventAt || b.updatedAt || 0)
      );

    const staleWorkingTasks = workflowTasks.filter((task) => {
      if (task.workflowStageStatus !== 'in_progress') return false;
      if (task.workflowCurrentStageKey === 'complete') return false;
      const lastEventAt = task.workflowLastEventAt || task.updatedAt || 0;
      return now - lastEventAt > STAGE_TIMEOUT_MS;
    });

    let watchdogBlocked = 0;
    for (const task of staleWorkingTasks) {
      const stage = (task.workflowCurrentStageKey || 'research') as TopicStageKey;
      const summary = `Watchdog blocked ${stage}: no progress in ${Math.floor(
        STAGE_TIMEOUT_MS / 60000
      )}m. Use Run Current Stage to resume.`;

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
        actorId: auth.user.id,
        actorName: 'Workflow Watchdog',
        payload: {
          status: 'blocked',
          reasonCode: 'stage_timeout_watchdog',
          timeoutMs: STAGE_TIMEOUT_MS,
          previousLastEventAt: task.workflowLastEventAt || task.updatedAt || null,
        },
      });

      watchdogBlocked += 1;
    }

    const failures: Array<{ taskId: string; error: string }> = [];
    let resumed = 0;
    const toResume = queuedWritingTasks.slice(0, maxResumes);

    for (const task of toResume) {
      try {
        const result = await runTopicWorkflow({
          user: auth.user,
          taskId: task._id,
          autoContinue: true,
          maxStages: 4,
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

    await logAuditEvent({
      userId: auth.user.id,
      action: 'topic_workflow.auto_resume',
      resourceType: 'task',
      severity: failures.length > 0 ? 'warning' : 'info',
      metadata: {
        projectIds,
        scanned: workflowTasks.length,
        queuedWriting: queuedWritingTasks.length,
        maxResumes,
        resumed,
        watchdogBlocked,
        failures,
      },
    });

    return NextResponse.json({
      scanned: workflowTasks.length,
      queued: queuedWritingTasks.length,
      resumed,
      watchdogBlocked,
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
    console.error('Workflow auto-resume failed:', error);
    return NextResponse.json(
      { error: 'Failed to auto-resume workflows' },
      { status: 500 }
    );
  }
}
