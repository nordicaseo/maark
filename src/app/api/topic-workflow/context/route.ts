import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth';
import { getTopicWorkflowContextForUser } from '@/lib/topic-workflow';
import type { Id } from '../../../../../convex/_generated/dataModel';

function parseTaskId(value: string | null): Id<'tasks'> | null {
  if (!value) return null;
  return value as Id<'tasks'>;
}

export async function GET(req: NextRequest) {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const taskId = parseTaskId(req.nextUrl.searchParams.get('taskId'));
    if (!taskId) {
      return NextResponse.json({ error: 'taskId is required' }, { status: 400 });
    }

    const result = await getTopicWorkflowContextForUser(user, taskId);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof Error && error.message === 'Task not found') {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }
    if (error instanceof Error && error.message === 'Forbidden') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    console.error('Topic workflow context fetch failed:', error);
    return NextResponse.json({ error: 'Failed to fetch workflow context' }, { status: 500 });
  }
}
