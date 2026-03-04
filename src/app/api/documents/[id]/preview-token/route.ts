import { NextRequest, NextResponse } from 'next/server';
import { db, ensureDb } from '@/db/index';
import { documents } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { randomBytes } from 'crypto';
import { getAuthUser } from '@/lib/auth';
import { userCanAccessDocument } from '@/lib/access';

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await ensureDb();
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const { id } = await params;
    const docId = Number(id);
    if (Number.isNaN(docId)) {
      return NextResponse.json({ error: 'Invalid document id' }, { status: 400 });
    }
    if (!(await userCanAccessDocument(user, docId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

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
