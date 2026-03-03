import { NextRequest, NextResponse } from 'next/server';
import { db, ensureDb } from '@/db/index';
import { documents, documentComments } from '@/db/schema';
import { eq, desc } from 'drizzle-orm';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  await ensureDb();
  try {
    const { token } = await params;

    // Verify token is valid
    const [doc] = await db
      .select({ id: documents.id })
      .from(documents)
      .where(eq(documents.previewToken, token));

    if (!doc) {
      return NextResponse.json({ error: 'Preview not found' }, { status: 404 });
    }

    const comments = await db
      .select()
      .from(documentComments)
      .where(eq(documentComments.previewToken, token))
      .orderBy(desc(documentComments.createdAt));

    return NextResponse.json(comments);
  } catch (error) {
    console.error('Error fetching comments:', error);
    return NextResponse.json([], { status: 200 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  await ensureDb();
  try {
    const { token } = await params;
    const { authorName, content } = await req.json();

    if (!authorName?.trim() || !content?.trim()) {
      return NextResponse.json(
        { error: 'Name and comment are required' },
        { status: 400 }
      );
    }

    // Verify token and get document
    const [doc] = await db
      .select({ id: documents.id })
      .from(documents)
      .where(eq(documents.previewToken, token));

    if (!doc) {
      return NextResponse.json({ error: 'Preview not found' }, { status: 404 });
    }

    const [comment] = await db
      .insert(documentComments)
      .values({
        documentId: doc.id,
        previewToken: token,
        authorName: authorName.trim(),
        content: content.trim(),
      })
      .returning();

    return NextResponse.json(comment, { status: 201 });
  } catch (error) {
    console.error('Error adding comment:', error);
    return NextResponse.json({ error: 'Failed to add comment' }, { status: 500 });
  }
}
