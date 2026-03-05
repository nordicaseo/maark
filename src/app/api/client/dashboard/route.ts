import { NextRequest, NextResponse } from 'next/server';
import { and, desc, eq, sql } from 'drizzle-orm';
import { db, ensureDb } from '@/db';
import {
  auditLogs,
  documentComments,
  documents,
  keywords,
  pages,
  pageIssues,
} from '@/db/schema';
import { getAuthUser } from '@/lib/auth';
import { getAccessibleProjectIds, getRequestedProjectId, userCanAccessProject } from '@/lib/access';

export async function GET(req: NextRequest) {
  await ensureDb();
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let projectId = getRequestedProjectId(req);
  if (!projectId) {
    const accessible = await getAccessibleProjectIds(user);
    projectId = accessible[0] ?? null;
  }

  if (!projectId) {
    return NextResponse.json({
      projectId: null,
      aiVisibility: { documents: 0, avgAiScore: null, avgQualityScore: null },
      rankings: { trackedKeywords: 0, publishedKeywords: 0 },
      pages: { total: 0, verified: 0, indexable: 0, openIssues: 0 },
      keywords: { total: 0, planned: 0, inProgress: 0, published: 0 },
      reviewItems: { unresolvedComments: 0, reviewDocs: 0 },
      activityFeed: [],
    });
  }

  if (!(await userCanAccessProject(user, projectId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const [docAgg] = await db
    .select({
      documents: sql<number>`CAST(COUNT(*) AS INTEGER)`,
      avgAiScore: sql<number | null>`AVG(${documents.aiDetectionScore})`,
      avgQualityScore: sql<number | null>`AVG(${documents.contentQualityScore})`,
      reviewDocs: sql<number>`CAST(SUM(CASE WHEN ${documents.status} = 'review' THEN 1 ELSE 0 END) AS INTEGER)`,
    })
    .from(documents)
    .where(eq(documents.projectId, projectId));

  const [keywordAgg] = await db
    .select({
      total: sql<number>`CAST(COUNT(*) AS INTEGER)`,
      planned: sql<number>`CAST(SUM(CASE WHEN ${keywords.status} = 'planned' THEN 1 ELSE 0 END) AS INTEGER)`,
      inProgress: sql<number>`CAST(SUM(CASE WHEN ${keywords.status} = 'in_progress' THEN 1 ELSE 0 END) AS INTEGER)`,
      published: sql<number>`CAST(SUM(CASE WHEN ${keywords.status} IN ('published', 'content_created') THEN 1 ELSE 0 END) AS INTEGER)`,
    })
    .from(keywords)
    .where(eq(keywords.projectId, projectId));

  const [pageAgg] = await db
    .select({
      total: sql<number>`CAST(COUNT(*) AS INTEGER)`,
      verified: sql<number>`CAST(SUM(CASE WHEN ${pages.isVerified} = 1 THEN 1 ELSE 0 END) AS INTEGER)`,
      indexable: sql<number>`CAST(SUM(CASE WHEN ${pages.isIndexable} = 1 THEN 1 ELSE 0 END) AS INTEGER)`,
    })
    .from(pages)
    .where(eq(pages.projectId, projectId));

  const [issueAgg] = await db
    .select({
      openIssues: sql<number>`CAST(COUNT(*) AS INTEGER)`,
    })
    .from(pageIssues)
    .innerJoin(pages, eq(pageIssues.pageId, pages.id))
    .where(and(eq(pages.projectId, projectId), eq(pageIssues.isOpen, 1)));

  const [commentAgg] = await db
    .select({
      unresolvedComments: sql<number>`CAST(COUNT(*) AS INTEGER)`,
    })
    .from(documentComments)
    .innerJoin(documents, eq(documentComments.documentId, documents.id))
    .where(and(eq(documents.projectId, projectId), eq(documentComments.isResolved, 0)));

  const activityFeed = await db
    .select({
      id: auditLogs.id,
      action: auditLogs.action,
      resourceType: auditLogs.resourceType,
      resourceId: auditLogs.resourceId,
      severity: auditLogs.severity,
      createdAt: auditLogs.createdAt,
      metadata: auditLogs.metadata,
    })
    .from(auditLogs)
    .where(eq(auditLogs.projectId, projectId))
    .orderBy(desc(auditLogs.createdAt))
    .limit(25);

  return NextResponse.json({
    projectId,
    aiVisibility: {
      documents: Number(docAgg?.documents ?? 0),
      avgAiScore: docAgg?.avgAiScore != null ? Number(docAgg.avgAiScore) : null,
      avgQualityScore: docAgg?.avgQualityScore != null ? Number(docAgg.avgQualityScore) : null,
    },
    rankings: {
      trackedKeywords: Number(keywordAgg?.total ?? 0),
      publishedKeywords: Number(keywordAgg?.published ?? 0),
    },
    pages: {
      total: Number(pageAgg?.total ?? 0),
      verified: Number(pageAgg?.verified ?? 0),
      indexable: Number(pageAgg?.indexable ?? 0),
      openIssues: Number(issueAgg?.openIssues ?? 0),
    },
    keywords: {
      total: Number(keywordAgg?.total ?? 0),
      planned: Number(keywordAgg?.planned ?? 0),
      inProgress: Number(keywordAgg?.inProgress ?? 0),
      published: Number(keywordAgg?.published ?? 0),
    },
    reviewItems: {
      unresolvedComments: Number(commentAgg?.unresolvedComments ?? 0),
      reviewDocs: Number(docAgg?.reviewDocs ?? 0),
    },
    activityFeed,
  });
}
