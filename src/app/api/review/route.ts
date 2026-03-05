import { NextRequest, NextResponse } from 'next/server';
import { db, ensureDb } from '@/db';
import { documents, users, projects, projectMembers } from '@/db/schema';
import { desc, eq, sql } from 'drizzle-orm';
import { getAuthUser } from '@/lib/auth';
import { isAdminUser } from '@/lib/access';

export async function GET(req: NextRequest) {
  await ensureDb();

  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const projectId = req.nextUrl.searchParams.get('projectId');

  try {
    // Build base query: documents with unresolved comment counts
    // Owner (admin) can see all projects or filter by project
    // Writer can only see projects they're a member of

    let baseQuery;

    if (isAdminUser(user)) {
      // Admin: see all, optionally filtered by project
      baseQuery = db
        .select({
          id: documents.id,
          projectId: documents.projectId,
          projectName: projects.name,
          authorId: documents.authorId,
          authorName: users.name,
          title: documents.title,
          status: documents.status,
          contentType: documents.contentType,
          targetKeyword: documents.targetKeyword,
          wordCount: documents.wordCount,
          aiDetectionScore: documents.aiDetectionScore,
          semanticScore: documents.semanticScore,
          contentQualityScore: documents.contentQualityScore,
          previewToken: documents.previewToken,
          updatedAt: documents.updatedAt,
          commentCount: sql<number>`(SELECT CAST(COUNT(*) AS INTEGER) FROM document_comments WHERE document_comments.document_id = ${documents.id} AND document_comments.is_resolved = 0)`.as('comment_count'),
          totalComments: sql<number>`(SELECT CAST(COUNT(*) AS INTEGER) FROM document_comments WHERE document_comments.document_id = ${documents.id})`.as('total_comments'),
        })
        .from(documents)
        .leftJoin(users, eq(documents.authorId, users.id))
        .leftJoin(projects, eq(documents.projectId, projects.id))
        .orderBy(desc(documents.updatedAt));

      if (projectId) {
        baseQuery = baseQuery.where(eq(documents.projectId, parseInt(projectId)));
      }
    } else {
      // Writer: only see documents in projects they're a member of
      const memberProjects = await db
        .select({ projectId: projectMembers.projectId })
        .from(projectMembers)
        .where(eq(projectMembers.userId, user.id));

      const projectIds = memberProjects.map((p: { projectId: number }) => p.projectId);

      if (projectIds.length === 0) {
        return NextResponse.json([]);
      }

      baseQuery = db
        .select({
          id: documents.id,
          projectId: documents.projectId,
          projectName: projects.name,
          authorId: documents.authorId,
          authorName: users.name,
          title: documents.title,
          status: documents.status,
          contentType: documents.contentType,
          targetKeyword: documents.targetKeyword,
          wordCount: documents.wordCount,
          aiDetectionScore: documents.aiDetectionScore,
          semanticScore: documents.semanticScore,
          contentQualityScore: documents.contentQualityScore,
          previewToken: documents.previewToken,
          updatedAt: documents.updatedAt,
          commentCount: sql<number>`(SELECT CAST(COUNT(*) AS INTEGER) FROM document_comments WHERE document_comments.document_id = ${documents.id} AND document_comments.is_resolved = 0)`.as('comment_count'),
          totalComments: sql<number>`(SELECT CAST(COUNT(*) AS INTEGER) FROM document_comments WHERE document_comments.document_id = ${documents.id})`.as('total_comments'),
        })
        .from(documents)
        .leftJoin(users, eq(documents.authorId, users.id))
        .leftJoin(projects, eq(documents.projectId, projects.id))
        .orderBy(desc(documents.updatedAt));

      // Filter to member projects
      if (projectId) {
        const pid = parseInt(projectId);
        if (!projectIds.includes(pid)) {
          return NextResponse.json([]);
        }
        baseQuery = baseQuery.where(eq(documents.projectId, pid));
      } else {
        // Only docs from their projects
        baseQuery = baseQuery.where(
          sql`${documents.projectId} IN (${sql.raw(projectIds.join(','))})`
        );
      }
    }

    const results = await baseQuery;
    return NextResponse.json(results);
  } catch (error) {
    console.error('Review API error:', error);
    return NextResponse.json([], { status: 200 });
  }
}
