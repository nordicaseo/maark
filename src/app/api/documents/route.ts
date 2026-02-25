import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { documents } from '@/db/schema';
import { desc, eq } from 'drizzle-orm';
import { getTemplateById } from '@/lib/templates';

export async function GET(req: NextRequest) {
  const status = req.nextUrl.searchParams.get('status');

  try {
    let query = db.select().from(documents).orderBy(desc(documents.updatedAt));

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
  try {
    const body = await req.json();
    const { title, contentType, targetKeyword } = body;

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
