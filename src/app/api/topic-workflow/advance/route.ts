import { NextRequest, NextResponse } from 'next/server';
import { hasRole } from '@/lib/permissions';
import { canSkipOutlineReviewByRole } from '@/lib/topic-workflow-rules';
import { requireRole } from '@/lib/auth';
import {
  advanceTopicWorkflowStage,
  getWorkflowTaskForUser,
  type TopicStageKey,
} from '@/lib/topic-workflow';
import { logAlertEvent, logAuditEvent } from '@/lib/observability';
import type { Id } from '../../../../../convex/_generated/dataModel';
import { TOPIC_STAGES } from '@/lib/content-workflow-taxonomy';

const STAGES = new Set<TopicStageKey>(TOPIC_STAGES);

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
    const toStage = body.toStage as TopicStageKey;
    const note = typeof body.note === 'string' ? body.note : undefined;
    const skipOptionalOutlineReview = Boolean(body.skipOptionalOutlineReview);

    if (!taskId) {
      return NextResponse.json({ error: 'taskId is required' }, { status: 400 });
    }
    if (!STAGES.has(toStage)) {
      return NextResponse.json({ error: 'Invalid workflow stage' }, { status: 400 });
    }

    const { task } = await getWorkflowTaskForUser(auth.user, taskId);

    const canSkipOutlineReview =
      hasRole(auth.user.role, 'admin') || canSkipOutlineReviewByRole(auth.user.role);

    if (skipOptionalOutlineReview && !canSkipOutlineReview) {
      return NextResponse.json(
        { error: 'Only PM/lead roles can skip outline review.' },
        { status: 403 }
      );
    }

    const result = await advanceTopicWorkflowStage({
      user: auth.user,
      taskId,
      toStage,
      note,
      skipOptionalOutlineReview,
    });

    await logAuditEvent({
      userId: auth.user.id,
      action: 'topic_workflow.advance',
      resourceType: 'task',
      resourceId: String(taskId),
      projectId: task.projectId ?? null,
      metadata: {
        toStage,
        note: note ?? null,
        skipOptionalOutlineReview,
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
      eventType: 'advance_failed',
      severity: 'error',
      message: 'Topic workflow stage advance failed.',
      metadata: { error: error instanceof Error ? error.message : 'Unknown error' },
    });
    console.error('Topic workflow stage advance failed:', error);
    return NextResponse.json({ error: 'Failed to advance workflow stage' }, { status: 500 });
  }
}
