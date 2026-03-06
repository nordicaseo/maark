import { and, eq } from 'drizzle-orm';
import type { Id } from '../../../convex/_generated/dataModel';
import { api } from '../../../convex/_generated/api';
import { db, ensureDb } from '@/db';
import { documents } from '@/db/schema';
import { getConvexClient } from '@/lib/convex/server';

export interface ContentItemDeleteResult {
  ok: boolean;
  mode: 'document_cascade' | 'task_only' | 'noop';
  alreadyDeleted: boolean;
  deletedDocument: boolean;
  removedTaskCount: number;
  failedTaskIds?: string[];
  errorCode?: 'convex_unavailable' | 'scope_mismatch' | 'partial_failure' | 'unknown';
  errorMessage?: string;
}

async function removeTaskIdsWithRetry(
  taskIds: Array<{ id: Id<'tasks'>; expectedProjectId?: number }>
): Promise<{ removed: number; failedTaskIds: string[] }> {
  const convex = getConvexClient();
  if (!convex) {
    return {
      removed: 0,
      failedTaskIds: taskIds.map((task) => String(task.id)),
    };
  }

  let removed = 0;
  const failedTaskIds: string[] = [];

  for (const task of taskIds) {
    let success = false;
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await convex.mutation(api.tasks.remove, {
          id: task.id,
          expectedProjectId: task.expectedProjectId,
        });
        success = true;
        removed += 1;
        break;
      } catch (error) {
        lastError = error;
      }
    }
    if (!success) {
      failedTaskIds.push(String(task.id));
      console.error('Failed to remove linked task:', task.id, lastError);
    }
  }

  return { removed, failedTaskIds };
}

export async function deleteContentItemByDocumentId(input: {
  documentId: number;
  expectedProjectId?: number | null;
}): Promise<ContentItemDeleteResult> {
  await ensureDb();
  const convex = getConvexClient();
  if (!convex) {
    return {
      ok: false,
      mode: 'document_cascade',
      alreadyDeleted: false,
      deletedDocument: false,
      removedTaskCount: 0,
      errorCode: 'convex_unavailable',
      errorMessage: 'Task sync unavailable. Convex URL is missing.',
    };
  }

  const [doc] = await db
    .select({ id: documents.id, projectId: documents.projectId })
    .from(documents)
    .where(eq(documents.id, input.documentId))
    .limit(1);

  if (
    input.expectedProjectId !== undefined &&
    input.expectedProjectId !== null &&
    doc &&
    doc.projectId !== input.expectedProjectId
  ) {
    return {
      ok: false,
      mode: 'document_cascade',
      alreadyDeleted: false,
      deletedDocument: false,
      removedTaskCount: 0,
      errorCode: 'scope_mismatch',
      errorMessage: 'Document project scope mismatch.',
    };
  }

  const scopedProjectId =
    input.expectedProjectId !== undefined && input.expectedProjectId !== null
      ? input.expectedProjectId
      : (doc?.projectId ?? undefined);

  const linkedTasks = await convex.query(api.tasks.getByDocument, {
    documentId: input.documentId,
    projectId: scopedProjectId,
  });

  const { removed, failedTaskIds } = await removeTaskIdsWithRetry(
    linkedTasks.map((task) => ({
      id: task._id,
      expectedProjectId: task.projectId ?? undefined,
    }))
  );

  if (failedTaskIds.length > 0) {
    return {
      ok: false,
      mode: 'document_cascade',
      alreadyDeleted: false,
      deletedDocument: false,
      removedTaskCount: removed,
      failedTaskIds,
      errorCode: 'partial_failure',
      errorMessage: 'Failed to remove all linked tasks. Retry is safe.',
    };
  }

  let deletedDocument = false;
  if (doc) {
    const whereClause =
      scopedProjectId !== undefined
        ? and(eq(documents.id, input.documentId), eq(documents.projectId, scopedProjectId))
        : eq(documents.id, input.documentId);
    await db.delete(documents).where(whereClause);
    deletedDocument = true;
  }

  return {
    ok: true,
    mode: 'document_cascade',
    alreadyDeleted: !doc && linkedTasks.length === 0,
    deletedDocument,
    removedTaskCount: removed,
  };
}

export async function deleteContentItemByTaskId(input: {
  taskId: Id<'tasks'>;
  expectedProjectId?: number | null;
}): Promise<ContentItemDeleteResult> {
  const convex = getConvexClient();
  if (!convex) {
    return {
      ok: false,
      mode: 'task_only',
      alreadyDeleted: false,
      deletedDocument: false,
      removedTaskCount: 0,
      errorCode: 'convex_unavailable',
      errorMessage: 'Mission Control is not configured (Convex URL missing).',
    };
  }

  const task = await convex.query(api.tasks.get, { id: input.taskId });
  if (!task) {
    return {
      ok: true,
      mode: 'noop',
      alreadyDeleted: true,
      deletedDocument: false,
      removedTaskCount: 0,
    };
  }

  if (
    input.expectedProjectId !== undefined &&
    input.expectedProjectId !== null &&
    task.projectId !== input.expectedProjectId
  ) {
    return {
      ok: false,
      mode: 'task_only',
      alreadyDeleted: false,
      deletedDocument: false,
      removedTaskCount: 0,
      errorCode: 'scope_mismatch',
      errorMessage: 'Task project scope mismatch.',
    };
  }

  if (task.documentId) {
    return deleteContentItemByDocumentId({
      documentId: task.documentId,
      expectedProjectId: task.projectId ?? input.expectedProjectId,
    });
  }

  const { removed, failedTaskIds } = await removeTaskIdsWithRetry([
    { id: input.taskId, expectedProjectId: task.projectId ?? undefined },
  ]);

  if (failedTaskIds.length > 0) {
    return {
      ok: false,
      mode: 'task_only',
      alreadyDeleted: false,
      deletedDocument: false,
      removedTaskCount: removed,
      failedTaskIds,
      errorCode: 'partial_failure',
      errorMessage: 'Failed to remove task. Retry is safe.',
    };
  }

  return {
    ok: true,
    mode: 'task_only',
    alreadyDeleted: false,
    deletedDocument: false,
    removedTaskCount: removed,
  };
}

