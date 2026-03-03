import { NextRequest, NextResponse } from 'next/server';
import { db, ensureDb } from '@/db';
import { documents, users } from '@/db/schema';
import { desc, eq } from 'drizzle-orm';
import { getConvexClient } from '@/lib/convex/server';
import { api } from '../../../../convex/_generated/api';

export async function GET(req: NextRequest) {
  await ensureDb();
  const status = req.nextUrl.searchParams.get('status');
  const projectId = req.nextUrl.searchParams.get('projectId');

  try {
    let query = db
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

    if (projectId) {
      query = query.where(eq(documents.projectId, parseInt(projectId)));
    }

    const results = await query;

    const filtered = status
      ? results.filter((d: any) => d.status === status)
      : results;

    return NextResponse.json(filtered);
  } catch (error) {
    console.error('Error fetching documents:', error);
    return NextResponse.json([], { status: 200 });
  }
}

export async function POST(req: NextRequest) {
  await ensureDb();
  try {
    const body = await req.json();
    const { title, contentType, targetKeyword, projectId, authorId } = body;

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
        projectId: projectId ? parseInt(projectId, 10) : null,
        authorId: authorId || null,
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
