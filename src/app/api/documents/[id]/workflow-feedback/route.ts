import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth';
import { userCanAccessDocument } from '@/lib/access';
import { getConvexClient } from '@/lib/convex/server';
import { api } from '../../../../../../convex/_generated/api';

/**
 * Returns workflow review feedback for a document.
 * Bridges: document → task (via Convex by_document index) → workflow events.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const documentId = parseInt(id, 10);
  if (Number.isNaN(documentId)) {
    return NextResponse.json({ error: 'Invalid document id' }, { status: 400 });
  }

  if (!(await userCanAccessDocument(user, documentId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const convex = getConvexClient();
  if (!convex) {
    return NextResponse.json([], { status: 200 });
  }

  try {
    // Look up the task associated with this document
    const tasks = await convex.query(api.tasks.getByDocument, { documentId });
    if (!tasks || tasks.length === 0) {
      return NextResponse.json([], { status: 200 });
    }

    // Use the most recent task (last created)
    const task = tasks.sort((a, b) => b.createdAt - a.createdAt)[0];

    // Fetch workflow events for this task
    const { events } = await convex.query(api.topicWorkflow.listWorkflowHistory, {
      taskId: task._id,
      limit: 100,
    });

    // Filter to feedback-relevant events: approvals, discussions, transitions with review content
    const feedbackEvents = events
      .filter((e) => {
        const t = e.eventType;
        const s = (e.summary || '').toLowerCase();
        // Include: approvals, discussions, transitions that mention review/revision/feedback
        if (t === 'approval' || t === 'discussion') return true;
        if (t === 'transition' && (
          s.includes('review') ||
          s.includes('revision') ||
          s.includes('feedback') ||
          s.includes('routing back') ||
          s.includes('approved') ||
          s.includes('rejected')
        )) return true;
        return false;
      })
      .map((e) => ({
        id: e._id,
        stageKey: e.stageKey,
        eventType: e.eventType,
        actorType: e.actorType,
        actorName: e.actorName || e.actorType,
        summary: e.summary,
        payload: e.payload,
        createdAt: e.createdAt,
      }));

    return NextResponse.json(feedbackEvents);
  } catch (err) {
    console.error('Workflow feedback fetch error:', err);
    return NextResponse.json([], { status: 200 });
  }
}
