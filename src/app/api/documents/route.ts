import { NextRequest, NextResponse } from 'next/server';
import { db, ensureDb } from '@/db';
import { documents, users } from '@/db/schema';
import { desc, eq, or, sql } from 'drizzle-orm';
import { getConvexClient } from '@/lib/convex/server';
import { api } from '../../../../convex/_generated/api';
import { getAuthUser } from '@/lib/auth';
import {
  getAccessibleProjectIds,
  getRequestedProjectId,
  isAdminUser,
  userCanAccessProject,
} from '@/lib/access';

export async function GET(req: NextRequest) {
  await ensureDb();
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const status = req.nextUrl.searchParams.get('status');
  const requestedProjectId = getRequestedProjectId(req);

  try {
    const baseQuery = db
      .select({
        id: documents.id,
        projectId: documents.projectId,
        authorId: documents.authorId,
        authorName: users.name,
        title: documents.title,
        content: documents.content,
        plainText: documents.plainText,
        status: documents.status,
        contentType: documents.contentType,
        targetKeyword: documents.targetKeyword,
        wordCount: documents.wordCount,
        aiDetectionScore: documents.aiDetectionScore,
        aiRiskLevel: documents.aiRiskLevel,
        semanticScore: documents.semanticScore,
        contentQualityScore: documents.contentQualityScore,
        previewToken: documents.previewToken,
        createdAt: documents.createdAt,
        updatedAt: documents.updatedAt,
      })
      .from(documents)
      .leftJoin(users, eq(documents.authorId, users.id))
      .orderBy(desc(documents.updatedAt));

    let results: Array<Record<string, unknown>>;

    if (isAdminUser(user)) {
      if (requestedProjectId !== null) {
        results = await baseQuery.where(eq(documents.projectId, requestedProjectId));
      } else {
        results = await baseQuery;
      }
    } else {
      const accessibleProjectIds = await getAccessibleProjectIds(user);

      if (requestedProjectId !== null) {
        if (!accessibleProjectIds.includes(requestedProjectId)) {
          return NextResponse.json([]);
        }
        results = await baseQuery.where(eq(documents.projectId, requestedProjectId));
      } else if (accessibleProjectIds.length > 0) {
        results = await baseQuery.where(
          or(
            sql`${documents.projectId} IN (${sql.join(
              accessibleProjectIds.map((id) => sql`${id}`),
              sql`, `
            )})`,
            eq(documents.authorId, user.id)
          )
        );
      } else {
        results = await baseQuery.where(eq(documents.authorId, user.id));
      }
    }

    const filtered = status
      ? results.filter((d: Record<string, unknown>) => d.status === status)
      : results;

    return NextResponse.json(filtered);
  } catch (error) {
    console.error('Error fetching documents:', error);
    return NextResponse.json([], { status: 200 });
  }
}

export async function POST(req: NextRequest) {
  await ensureDb();
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { title, contentType, targetKeyword, projectId, authorId } = body;
    const parsedProjectId =
      projectId !== undefined && projectId !== null && projectId !== ''
        ? parseInt(projectId, 10)
        : getRequestedProjectId(req);

    if (!(await userCanAccessProject(user, parsedProjectId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const safeAuthorId =
      isAdminUser(user) && authorId ? authorId : user.id;

    // Start with a blank editor — no pre-loaded template content
    const defaultContent = {
      type: 'doc',
      content: [{ type: 'paragraph' }],
    };

    const [doc] = await db
      .insert(documents)
      .values({
        title: title || 'Untitled',
        contentType: contentType || 'blog_post',
        targetKeyword: targetKeyword || null,
        content: defaultContent,
        plainText: '',
        wordCount: 0,
        projectId: parsedProjectId ?? null,
        authorId: safeAuthorId || null,
      })
      .returning();

    // ── Auto-create linked Convex task (unless caller opts out) ──────
    const skipTask = req.nextUrl.searchParams.get('skipTaskCreation') === 'true';
    if (!skipTask) {
      try {
        const convex = getConvexClient();
        if (convex) {
          await convex.mutation(api.tasks.create, {
            title: doc.title,
            type: 'content',
            status: 'BACKLOG',
            priority: 'MEDIUM',
            documentId: doc.id,
            projectId: doc.projectId ?? undefined,
          });
        }
      } catch (syncErr) {
        console.error('Auto-create Convex task failed:', syncErr);
        // Non-blocking: document creation already succeeded
      }
    }

    return NextResponse.json(doc);
  } catch (error) {
    console.error('Error creating document:', error);
    return NextResponse.json(
      { error: 'Failed to create document' },
      { status: 500 }
    );
  }
}
