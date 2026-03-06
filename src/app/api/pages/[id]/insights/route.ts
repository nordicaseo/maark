import { NextRequest, NextResponse } from 'next/server';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { db, ensureDb } from '@/db';
import {
  documentPageLinks,
  documents,
  keywords,
  pageKeywordMappings,
  pages,
  taskPageLinks,
} from '@/db/schema';
import { getAuthUser } from '@/lib/auth';
import { userCanAccessPage } from '@/lib/access';
import { getPagePerformanceSeries } from '@/lib/gsc/sync';
import { getConvexClient } from '@/lib/convex/server';
import { api } from '../../../../../../convex/_generated/api';
import type { PageKeywordMappingRecord, PageTaskAnnotation } from '@/types/page';

function parsePositiveInt(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await ensureDb();
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const pageId = parsePositiveInt(id);
  if (!pageId) {
    return NextResponse.json({ error: 'Invalid page id' }, { status: 400 });
  }

  if (!(await userCanAccessPage(user, pageId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const [page] = await db
    .select({
      id: pages.id,
      projectId: pages.projectId,
      url: pages.url,
      title: pages.title,
      normalizedUrl: pages.normalizedUrl,
      canonicalUrl: pages.canonicalUrl,
      updatedAt: pages.updatedAt,
    })
    .from(pages)
    .where(eq(pages.id, pageId))
    .limit(1);

  if (!page) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const days = Math.max(14, Math.min(parsePositiveInt(req.nextUrl.searchParams.get('days')) ?? 120, 540));

  const [performance, taskLinks, mappingRows, linkedDocs] = await Promise.all([
    getPagePerformanceSeries({
      projectId: page.projectId,
      pageId,
      days,
    }),
    db
      .select({
        taskId: taskPageLinks.taskId,
        linkType: taskPageLinks.linkType,
        annotationDate: taskPageLinks.annotationDate,
      })
      .from(taskPageLinks)
      .where(and(eq(taskPageLinks.projectId, page.projectId), eq(taskPageLinks.pageId, pageId)))
      .orderBy(desc(taskPageLinks.annotationDate), desc(taskPageLinks.createdAt))
      .limit(100),
    db
      .select({
        keywordId: pageKeywordMappings.keywordId,
        mappingType: pageKeywordMappings.mappingType,
        clusterKey: pageKeywordMappings.clusterKey,
        keyword: keywords.keyword,
        volume: keywords.volume,
        difficulty: keywords.difficulty,
      })
      .from(pageKeywordMappings)
      .innerJoin(keywords, eq(keywords.id, pageKeywordMappings.keywordId))
      .where(and(eq(pageKeywordMappings.projectId, page.projectId), eq(pageKeywordMappings.pageId, pageId)))
      .orderBy(pageKeywordMappings.mappingType, keywords.keyword),
    db
      .select({
        documentId: documentPageLinks.documentId,
        title: documents.title,
        status: documents.status,
        relationType: documentPageLinks.relationType,
        isPrimary: documentPageLinks.isPrimary,
        updatedAt: documentPageLinks.updatedAt,
      })
      .from(documentPageLinks)
      .innerJoin(documents, eq(documents.id, documentPageLinks.documentId))
      .where(eq(documentPageLinks.pageId, pageId))
      .orderBy(desc(documentPageLinks.updatedAt))
      .limit(20),
  ]);

  const annotations: PageTaskAnnotation[] = taskLinks.map((row: (typeof taskLinks)[number]) => ({
    taskId: String(row.taskId),
    title: `Task ${String(row.taskId)}`,
    status: 'UNKNOWN',
    annotationDate: row.annotationDate ? String(row.annotationDate) : null,
    linkType: String(row.linkType || 'related'),
  }));

  const convex = getConvexClient();
  if (convex && annotations.length > 0) {
    try {
      const tasks = await convex.query(api.tasks.list, {
        projectId: page.projectId,
        limit: 1000,
      });
      const byId = new Map(tasks.map((task) => [String(task._id), task]));
      for (const annotation of annotations) {
        const task = byId.get(annotation.taskId);
        if (!task) continue;
        annotation.title = String(task.title || annotation.title);
        annotation.status = String(task.status || 'UNKNOWN');
      }
    } catch {
      // Keep SQL link timeline even if Convex metadata is unavailable.
    }
  }

  const keywordMappings: PageKeywordMappingRecord[] = mappingRows.map((row: (typeof mappingRows)[number]) => ({
    keywordId: Number(row.keywordId),
    keyword: String(row.keyword),
    mappingType: row.mappingType === 'primary' ? 'primary' : 'secondary',
    clusterKey: row.clusterKey ? String(row.clusterKey) : null,
    volume: row.volume === null || row.volume === undefined ? null : Number(row.volume),
    difficulty: row.difficulty === null || row.difficulty === undefined ? null : Number(row.difficulty),
  }));

  const primaryKeyword = keywordMappings.find((entry) => entry.mappingType === 'primary') || null;

  const uniqueKeywordIds = Array.from(
    new Set(keywordMappings.map((entry) => entry.keywordId))
  );

  const suggestions = uniqueKeywordIds.length
    ? await db
        .select({
          id: keywords.id,
          keyword: keywords.keyword,
          volume: keywords.volume,
          difficulty: keywords.difficulty,
          status: keywords.status,
        })
        .from(keywords)
        .where(
          and(
            eq(keywords.projectId, page.projectId),
            inArray(keywords.id, uniqueKeywordIds)
          )
        )
    : [];

  return NextResponse.json({
    page,
    days,
    performance,
    annotations,
    keywordMappings,
    primaryKeyword,
    keywordDetails: suggestions,
    linkedDocuments: linkedDocs.map((doc: (typeof linkedDocs)[number]) => ({
      documentId: Number(doc.documentId),
      title: String(doc.title || 'Untitled'),
      status: String(doc.status || 'draft'),
      relationType: String(doc.relationType || 'related'),
      isPrimary: Number(doc.isPrimary || 0),
      updatedAt: doc.updatedAt ? String(doc.updatedAt) : null,
      previewUrl: `/documents/${doc.documentId}`,
    })),
  });
}
