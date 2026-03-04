import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import {
  getWorkflowTaskForUser,
  recordTopicWorkflowApproval,
  type TopicApprovalGate,
} from '@/lib/topic-workflow';
import { logAuditEvent } from '@/lib/observability';
import type { Id } from '../../../../../convex/_generated/dataModel';

const GATES = new Set<TopicApprovalGate>([
  'outline_human',
  'outline_seo',
  'seo_final',
]);

function parseTaskId(value: unknown): Id<'tasks'> | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  return value as Id<'tasks'>;
}

export async function POST(req: NextRequest) {
  const auth = await requireRole('editor');
  if (auth.error) return auth.error;

  try {
    const body = await req.json();
    const taskId = parseTaskId(body.taskId);
    const gate = body.gate as TopicApprovalGate;
    const approved = Boolean(body.approved);
    const note = typeof body.note === 'string' ? body.note : undefined;

    if (!taskId) {
      return NextResponse.json({ error: 'taskId is required' }, { status: 400 });
    }
    if (!GATES.has(gate)) {
      return NextResponse.json({ error: 'Invalid approval gate' }, { status: 400 });
    }

    const { task } = await getWorkflowTaskForUser(auth.user, taskId);

    const result = await recordTopicWorkflowApproval({
      user: auth.user,
      taskId,
      gate,
      approved,
      note,
    });

    await logAuditEvent({
      userId: auth.user.id,
      action: 'topic_workflow.approval',
      resourceType: 'task',
      resourceId: String(taskId),
      projectId: task.projectId ?? null,
      metadata: {
        gate,
        approved,
        note: note ?? null,
        stageAdvanced: result.stageAdvanced,
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

    console.error('Topic workflow approval failed:', error);
    return NextResponse.json({ error: 'Failed to record workflow approval' }, { status: 500 });
  }
}
