import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import type { Id } from '../../../../../convex/_generated/dataModel';
import { api } from '../../../../../convex/_generated/api';
import { requireRole } from '@/lib/auth';
import { userCanAccessDocument, userCanAccessProject } from '@/lib/access';
import { db, ensureDb } from '@/db';
import { dbNow } from '@/db/utils';
import { documents } from '@/db/schema';
import { getConvexClient } from '@/lib/convex/server';
import { getWorkflowTaskForUser } from '@/lib/topic-workflow';
import { runTopicWorkflow } from '@/lib/topic-workflow-runner';
import { logAlertEvent, logAuditEvent } from '@/lib/observability';

type RerunStage = 'research' | 'outline_build';

function parseTaskId(value: unknown): Id<'tasks'> | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  return value as Id<'tasks'>;
}

function parseOptionalNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const n = Number.parseInt(String(value), 10);
  return Number.isFinite(n) ? n : undefined;
}

function parseRerunStage(value: unknown): RerunStage | null {
  if (value === 'research' || value === 'outline_build') return value;
  return null;
}

export async function POST(req: NextRequest) {
  await ensureDb();
  const auth = await requireRole('editor');
  if (auth.error) return auth.error;

  try {
    const body = await req.json();
    const fromStage = parseRerunStage(body.fromStage);
    const requestedTaskId = parseTaskId(body.taskId);
    const documentId = parseOptionalNumber(body.documentId);

    if (!fromStage) {
      return NextResponse.json(
        { error: "fromStage must be 'research' or 'outline_build'" },
        { status: 400 }
      );
    }
    if (!requestedTaskId && !documentId) {
      return NextResponse.json(
        { error: 'taskId or documentId is required' },
        { status: 400 }
      );
    }

    if (documentId && !(await userCanAccessDocument(auth.user, documentId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const convex = getConvexClient();
    if (!convex) {
      return NextResponse.json(
        { error: 'Mission Control is not configured (Convex URL missing)' },
        { status: 500 }
      );
    }

    await convex.mutation(api.seed.seedAgents, {});

    let taskId: Id<'tasks'>;
    let taskProjectId: number | null = null;
    let linkedDocumentId: number | undefined;

    if (requestedTaskId) {
      const { task } = await getWorkflowTaskForUser(auth.user, requestedTaskId);
      taskId = task._id;
      taskProjectId = task.projectId ?? null;
      linkedDocumentId = task.documentId;
    } else {
      const taskCandidates = await convex.query(api.tasks.getByDocument, {
        documentId: documentId!,
      });
      const workflowTask =
        taskCandidates.find(
          (candidate) =>
            candidate.workflowTemplateKey === 'topic_production_v1' &&
            candidate.workflowCurrentStageKey !== 'complete'
        ) ||
        taskCandidates.find(
          (candidate) => candidate.workflowTemplateKey === 'topic_production_v1'
        );
      if (!workflowTask) {
        return NextResponse.json(
          { error: 'No topic workflow task linked to this document.' },
          { status: 404 }
        );
      }
      if (!(await userCanAccessProject(auth.user, workflowTask.projectId ?? null))) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
      taskId = workflowTask._id;
      taskProjectId = workflowTask.projectId ?? null;
      linkedDocumentId = workflowTask.documentId;
    }

    const effectiveDocumentId = linkedDocumentId ?? documentId;
    if (effectiveDocumentId) {
      if (!(await userCanAccessDocument(auth.user, effectiveDocumentId))) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }

      const [doc] = await db
        .select({ id: documents.id, projectId: documents.projectId })
        .from(documents)
        .where(eq(documents.id, effectiveDocumentId))
        .limit(1);

      if (!doc) {
        return NextResponse.json({ error: 'Document not found' }, { status: 404 });
      }
      if (
        taskProjectId !== null &&
        doc.projectId !== null &&
        doc.projectId !== taskProjectId
      ) {
        return NextResponse.json(
          { error: 'Document/task project scope mismatch' },
          { status: 400 }
        );
      }

      const resetPatch =
        fromStage === 'research'
          ? {
              researchSnapshot: null,
              outlineSnapshot: null,
              prewriteChecklist: null,
              agentQuestions: null,
            }
          : {
              outlineSnapshot: null,
              prewriteChecklist: null,
              agentQuestions: null,
            };

      await db
        .update(documents)
        .set({
          ...resetPatch,
          content: { type: 'doc', content: [{ type: 'paragraph' }] },
          plainText: '',
          wordCount: 0,
          status: 'draft',
          updatedAt: dbNow(),
        })
        .where(eq(documents.id, effectiveDocumentId));
    }

    await convex.mutation(api.topicWorkflow.resetFromStage, {
      taskId,
      fromStage,
      actorType: 'user',
      actorId: auth.user.id,
      actorName: auth.user.name || auth.user.email,
      note: `Workflow rerun requested from ${fromStage}.`,
    });

    const runResult = await runTopicWorkflow({
      user: auth.user,
      taskId,
      autoContinue: true,
      maxStages: fromStage === 'research' ? 4 : 3,
    });

    await logAuditEvent({
      userId: auth.user.id,
      action: 'topic_workflow.rerun',
      resourceType: 'task',
      resourceId: String(taskId),
      projectId: taskProjectId,
      metadata: {
        fromStage,
        documentId: effectiveDocumentId ?? null,
        currentStage: runResult.currentStage,
        stoppedReason: runResult.stoppedReason ?? null,
      },
    });

    return NextResponse.json({
      ok: true,
      taskId: String(taskId),
      currentStage: runResult.currentStage,
      stoppedReason: runResult.stoppedReason,
      runs: runResult.runs,
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Task not found') {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }
    if (error instanceof Error && error.message === 'Forbidden') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    await logAlertEvent({
      source: 'topic_workflow',
      eventType: 'rerun_failed',
      severity: 'error',
      message: 'Topic workflow rerun failed.',
      metadata: { error: error instanceof Error ? error.message : 'Unknown error' },
    });
    console.error('Topic workflow rerun failed:', error);
    return NextResponse.json(
      { error: 'Failed to rerun topic workflow' },
      { status: 500 }
    );
  }
}
