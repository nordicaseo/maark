import { NextRequest, NextResponse } from 'next/server';
import { db, ensureDb } from '@/db';
import { documents, users } from '@/db/schema';
import { desc, eq } from 'drizzle-orm';
import { getTemplateById } from '@/lib/templates';

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

    const template = getTemplateById(contentType);
    const defaultContent = template?.defaultTiptapContent || {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 1 },
          content: [{ type: 'text', text: title || 'Untitled' }],
        },
        { type: 'paragraph' },
      ],
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

    return NextResponse.json(doc);
  } catch (error) {
    console.error('Error creating document:', error);
    return NextResponse.json(
      { error: 'Failed to create document' },
      { status: 500 }
    );
  }
}
