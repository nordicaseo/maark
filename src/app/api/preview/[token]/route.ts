import { NextRequest, NextResponse } from 'next/server';
import { db, ensureDb } from '@/db/index';
import { documents } from '@/db/schema';
import { eq } from 'drizzle-orm';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  await ensureDb();
  try {
    const { token } = await params;

    const [doc] = await db
      .select()
      .from(documents)
      .where(eq(documents.previewToken, token));

    if (!doc) {
      return NextResponse.json({ error: 'Preview not found' }, { status: 404 });
    }

    return NextResponse.json({
      title: doc.title,
      content: doc.content,
      plainText: doc.plainText,
      status: doc.status,
      contentType: doc.contentType,
      wordCount: doc.wordCount,
      updatedAt: doc.updatedAt,
    });
  } catch (error) {
    console.error('Error fetching preview:', error);
    return NextResponse.json({ error: 'Failed to load preview' }, { status: 500 });
  }
}
