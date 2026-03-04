import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth';
import { listTopicWorkflowHistoryForUser } from '@/lib/topic-workflow';
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
    const limitRaw = req.nextUrl.searchParams.get('limit');
    const cursor = req.nextUrl.searchParams.get('cursor') ?? undefined;
    const limit = limitRaw ? Number.parseInt(limitRaw, 10) : undefined;

    if (!taskId) {
      return NextResponse.json({ error: 'taskId is required' }, { status: 400 });
    }

    const result = await listTopicWorkflowHistoryForUser(
      user,
      taskId,
      Number.isFinite(limit) ? limit : undefined,
      cursor
    );

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof Error && error.message === 'Task not found') {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }
    if (error instanceof Error && error.message === 'Forbidden') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    console.error('Topic workflow history fetch failed:', error);
    return NextResponse.json({ error: 'Failed to fetch workflow history' }, { status: 500 });
  }
}
