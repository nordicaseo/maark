import { db } from '@/db';
import { dbNow } from '@/db/utils';
import { documentPageLinks, taskPageLinks } from '@/db/schema';

export async function linkDocumentToPage(args: {
  documentId: number;
  pageId: number;
  relationType?: string;
  isPrimary?: boolean;
}) {
  const now = dbNow();
  const relationType = args.relationType || 'primary';
  await db
    .insert(documentPageLinks)
    .values({
      documentId: args.documentId,
      pageId: args.pageId,
      relationType,
      isPrimary: args.isPrimary ? 1 : 0,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [documentPageLinks.documentId, documentPageLinks.pageId, documentPageLinks.relationType],
      set: {
        isPrimary: args.isPrimary ? 1 : 0,
        updatedAt: now,
      },
    });
}

export async function linkTaskToPage(args: {
  taskId: string;
  projectId: number;
  pageId?: number | null;
  keywordId?: number | null;
  linkType?: string;
  annotationDate?: string | Date | null;
}) {
  const now = dbNow();
  const annotationDate =
    args.annotationDate instanceof Date
      ? args.annotationDate.toISOString()
      : args.annotationDate || now;
  await db
    .insert(taskPageLinks)
    .values({
      taskId: args.taskId,
      projectId: args.projectId,
      pageId: args.pageId ?? null,
      keywordId: args.keywordId ?? null,
      linkType: args.linkType || 'related',
      annotationDate,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [taskPageLinks.taskId, taskPageLinks.pageId, taskPageLinks.linkType],
      set: {
        keywordId: args.keywordId ?? null,
        annotationDate,
        updatedAt: now,
      },
    });
}

