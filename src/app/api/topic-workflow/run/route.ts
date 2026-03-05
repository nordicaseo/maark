import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { runTopicWorkflow } from '@/lib/topic-workflow-runner';
import { getWorkflowTaskForUser } from '@/lib/topic-workflow';
import { logAlertEvent, logAuditEvent } from '@/lib/observability';
import type { Id } from '../../../../../convex/_generated/dataModel';
import { api } from '../../../../../convex/_generated/api';

function parseTaskId(value: unknown): Id<'tasks'> | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  return value as Id<'tasks'>;
}

export async function POST(req: NextRequest) {
  const auth = await requireRole('writer');
  if (auth.error) return auth.error;

  try {
    const body = await req.json();
    const taskId = parseTaskId(body.taskId);
    const autoContinue = body.autoContinue !== false;
    const maxStages = Number.isFinite(Number(body.maxStages))
      ? Number(body.maxStages)
      : undefined;

    if (!taskId) {
      return NextResponse.json({ error: 'taskId is required' }, { status: 400 });
    }

    const { task, convex } = await getWorkflowTaskForUser(auth.user, taskId);
    await convex.mutation(api.seed.seedAgents, {});

    const result = await runTopicWorkflow({
      user: auth.user,
      taskId,
      autoContinue,
      maxStages,
    });

    await logAuditEvent({
      userId: auth.user.id,
      action: 'topic_workflow.run',
      resourceType: 'task',
      resourceId: String(taskId),
      projectId: task.projectId ?? null,
      metadata: {
        autoContinue,
        maxStages: maxStages ?? null,
        runs: result.runs,
        currentStage: result.currentStage,
        stoppedReason: result.stoppedReason ?? null,
        documentId: result.documentId ?? null,
      },
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof Error && error.message === 'Task not found') {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }
    if (error instanceof Error && error.message === 'Forbidden') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    await logAlertEvent({
      source: 'topic_workflow',
      eventType: 'run_failed',
      severity: 'error',
      message: 'Topic workflow run failed.',
      metadata: { error: error instanceof Error ? error.message : 'Unknown error' },
    });

    console.error('Topic workflow run failed:', error);
    return NextResponse.json({ error: 'Failed to run topic workflow' }, { status: 500 });
  }
}
