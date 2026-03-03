import { NextRequest, NextResponse } from 'next/server';
import { db, ensureDb } from '@/db/index';
import { documents } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { randomBytes } from 'crypto';

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await ensureDb();
  try {
    const { id } = await params;
    const docId = Number(id);

    // Check document exists
    const [doc] = await db.select().from(documents).where(eq(documents.id, docId));
    if (!doc) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }

    // Reuse existing token or generate new one
    let token = doc.previewToken;
    if (!token) {
      token = randomBytes(24).toString('hex');
      await db.update(documents).set({ previewToken: token }).where(eq(documents.id, docId));
    }

    return NextResponse.json({ token, url: `/preview/${token}` });
  } catch (error) {
    console.error('Error generating preview token:', error);
    return NextResponse.json({ error: 'Failed to generate preview link' }, { status: 500 });
  }
}
