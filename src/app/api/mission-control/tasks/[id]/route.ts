import { NextRequest, NextResponse } from 'next/server';
import type { Id } from '../../../../../../convex/_generated/dataModel';
import { api } from '../../../../../../convex/_generated/api';
import { requireRole } from '@/lib/auth';
import { userCanAccessProject } from '@/lib/access';
import { getConvexClient } from '@/lib/convex/server';
import { logAuditEvent } from '@/lib/observability';

function parseTaskId(value: string): Id<'tasks'> {
  return value as Id<'tasks'>;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireRole('writer');
  if (auth.error) return auth.error;

  const convex = getConvexClient();
  if (!convex) {
    return NextResponse.json(
      { error: 'Mission Control is not configured (Convex URL missing)' },
      { status: 500 }
    );
  }

  const { id } = await params;
  const taskId = parseTaskId(id);

  const task = await convex.query(api.tasks.get, { id: taskId });
  if (!task) {
    return NextResponse.json({ error: 'Task not found' }, { status: 404 });
  }
  if (!(await userCanAccessProject(auth.user, task.projectId ?? null))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const body = await req.json();
    const status = typeof body.status === 'string' ? body.status : undefined;
    const assignedAgentId =
      typeof body.assignedAgentId === 'string' ? (body.assignedAgentId as Id<'agents'>) : undefined;
    const clearAssignedAgent = body.assignedAgentId === null;
    const assigneeId =
      typeof body.assigneeId === 'string'
        ? body.assigneeId
        : body.assigneeId === null
          ? null
          : undefined;

    if (!status && assignedAgentId === undefined && !clearAssignedAgent && assigneeId === undefined) {
      return NextResponse.json({ error: 'No supported fields to update' }, { status: 400 });
    }

    if (status) {
      await convex.mutation(api.tasks.updateStatus, {
        id: taskId,
        status,
        expectedProjectId: task.projectId ?? undefined,
      });
    }

    if (assignedAgentId !== undefined || clearAssignedAgent || assigneeId !== undefined) {
      await convex.mutation(api.tasks.update, {
        id: taskId,
        expectedProjectId: task.projectId ?? undefined,
        ...(assignedAgentId !== undefined ? { assignedAgentId } : {}),
        ...(clearAssignedAgent ? { assignedAgentId: undefined } : {}),
        ...(assigneeId !== undefined ? { assigneeId: assigneeId ?? undefined } : {}),
      });
    }

    const updated = await convex.query(api.tasks.get, { id: taskId });
    await logAuditEvent({
      userId: auth.user.id,
      action: 'mission_control.task.update',
      resourceType: 'task',
      resourceId: String(taskId),
      projectId: task.projectId ?? null,
      metadata: {
        status: status ?? null,
        assignedAgentId:
          assignedAgentId !== undefined
            ? String(assignedAgentId)
            : clearAssignedAgent
              ? null
              : undefined,
        assigneeId: assigneeId ?? undefined,
      },
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error('Task update failed:', error);
    return NextResponse.json({ error: 'Failed to update task' }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireRole('writer');
  if (auth.error) return auth.error;

  const convex = getConvexClient();
  if (!convex) {
    return NextResponse.json(
      { error: 'Mission Control is not configured (Convex URL missing)' },
      { status: 500 }
    );
  }

  const { id } = await params;
  const taskId = parseTaskId(id);

  const task = await convex.query(api.tasks.get, { id: taskId });
  if (!task) {
    return NextResponse.json({ error: 'Task not found' }, { status: 404 });
  }
  if (!(await userCanAccessProject(auth.user, task.projectId ?? null))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    await convex.mutation(api.tasks.remove, {
      id: taskId,
      expectedProjectId: task.projectId ?? undefined,
    });

    await logAuditEvent({
      userId: auth.user.id,
      action: 'mission_control.task.delete',
      resourceType: 'task',
      resourceId: String(taskId),
      projectId: task.projectId ?? null,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Task delete failed:', error);
    return NextResponse.json({ error: 'Failed to delete task' }, { status: 500 });
  }
}
