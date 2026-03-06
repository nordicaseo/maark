import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Id } from '../../../convex/_generated/dataModel';
import { api } from '../../../convex/_generated/api';
import { db, ensureDb } from '@/db';
import { documentComments, documents } from '@/db/schema';
import { getConvexClient } from '@/lib/convex/server';
import { logAlertEvent } from '@/lib/observability';

type TaskLike = {
  _id: Id<'tasks'>;
  status?: string;
  documentId?: number;
  deliverables?: Array<unknown>;
  projectId?: number | null;
};

type DocLike = {
  id: number;
  title: string | null;
  plainText: string | null;
  wordCount: number | null;
};

export interface ProjectContentPipelineReconcileResult {
  projectId: number;
  orphanDocuments: number;
  brokenTaskLinks: number;
  remediatedOrphanDocuments: number;
  remediatedBrokenTasks: number;
  unresolvedOrphanDocuments: number;
  unresolvedBrokenTasks: number;
}

export async function reconcileContentPipelineForProject(input: {
  projectId: number;
  autoRemediate?: boolean;
}): Promise<ProjectContentPipelineReconcileResult> {
  await ensureDb();
  const convex = getConvexClient();
  if (!convex) {
    throw new Error('Mission Control is not configured (Convex URL missing)');
  }

  const autoRemediate = input.autoRemediate !== false;

  const docs = (await db
    .select({
      id: documents.id,
      title: documents.title,
      plainText: documents.plainText,
      wordCount: documents.wordCount,
    })
    .from(documents)
    .where(eq(documents.projectId, input.projectId))) as DocLike[];

  const tasks = (await convex.query(api.tasks.list, {
    projectId: input.projectId,
    limit: 1000,
  })) as TaskLike[];

  const docIds = new Set(docs.map((doc) => doc.id));
  const tasksByDocumentId = new Map<number, TaskLike[]>();

  for (const task of tasks) {
    if (!task.documentId) continue;
    const arr = tasksByDocumentId.get(task.documentId) || [];
    arr.push(task);
    tasksByDocumentId.set(task.documentId, arr);
  }

  const orphanDocs = docs.filter((doc) => !tasksByDocumentId.has(doc.id));
  const brokenTasks = tasks.filter(
    (task) => task.documentId && !docIds.has(task.documentId)
  );

  let remediatedOrphanDocuments = 0;
  let remediatedBrokenTasks = 0;
  let unresolvedOrphanDocuments = 0;
  let unresolvedBrokenTasks = 0;

  if (autoRemediate && orphanDocs.length > 0) {
    const orphanIds = orphanDocs.map((doc) => doc.id);
    const commentCountsRows = orphanIds.length
      ? await db
          .select({
            documentId: documentComments.documentId,
            count: sql<number>`CAST(COUNT(*) AS INTEGER)`,
          })
          .from(documentComments)
          .where(inArray(documentComments.documentId, orphanIds))
          .groupBy(documentComments.documentId)
      : [];
    const commentCountByDoc = new Map(
      commentCountsRows.map((row: { documentId: number; count: number }) => [
        row.documentId,
        Number(row.count || 0),
      ])
    );

    for (const orphan of orphanDocs) {
      const commentCount = commentCountByDoc.get(orphan.id) || 0;
      const plainTextLength = (orphan.plainText || '').trim().length;
      const wordCount = Number(orphan.wordCount || 0);
      const safeToDelete = wordCount === 0 && plainTextLength === 0 && commentCount === 0;

      if (safeToDelete) {
        await db.delete(documents).where(
          and(eq(documents.id, orphan.id), eq(documents.projectId, input.projectId))
        );
        remediatedOrphanDocuments += 1;
      } else {
        unresolvedOrphanDocuments += 1;
      }
    }
  } else {
    unresolvedOrphanDocuments = orphanDocs.length;
  }

  if (autoRemediate && brokenTasks.length > 0) {
    for (const task of brokenTasks) {
      const hasDeliverables = Array.isArray(task.deliverables) && task.deliverables.length > 0;
      const safeToDelete =
        !hasDeliverables && (task.status === 'BACKLOG' || task.status === 'PENDING');
      if (safeToDelete) {
        await convex.mutation(api.tasks.remove, {
          id: task._id,
          expectedProjectId: input.projectId,
        });
        remediatedBrokenTasks += 1;
      } else {
        unresolvedBrokenTasks += 1;
      }
    }
  } else {
    unresolvedBrokenTasks = brokenTasks.length;
  }

  if (unresolvedOrphanDocuments > 0 || unresolvedBrokenTasks > 0) {
    await logAlertEvent({
      source: 'content_pipeline',
      eventType: 'reconcile_unresolved_items',
      severity: 'warning',
      message: 'Content pipeline reconcile found unresolved drift items.',
      projectId: input.projectId,
      metadata: {
        unresolvedOrphanDocuments,
        unresolvedBrokenTasks,
      },
    });
  }

  return {
    projectId: input.projectId,
    orphanDocuments: orphanDocs.length,
    brokenTaskLinks: brokenTasks.length,
    remediatedOrphanDocuments,
    remediatedBrokenTasks,
    unresolvedOrphanDocuments,
    unresolvedBrokenTasks,
  };
}
