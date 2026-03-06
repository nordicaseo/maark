import { NextRequest, NextResponse } from 'next/server';
import { desc, eq } from 'drizzle-orm';
import { db, ensureDb } from '@/db';
import { documentPageLinks, documents } from '@/db/schema';
import { getAuthUser } from '@/lib/auth';
import { userCanAccessPage } from '@/lib/access';

function parseId(value: string): number | null {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await ensureDb();
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const pageId = parseId(id);
  if (!pageId) return NextResponse.json({ error: 'Invalid page id' }, { status: 400 });
  if (!(await userCanAccessPage(user, pageId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const rows = (await db
    .select({
      documentId: documents.id,
      title: documents.title,
      status: documents.status,
      previewToken: documents.previewToken,
      relationType: documentPageLinks.relationType,
      isPrimary: documentPageLinks.isPrimary,
      updatedAt: documents.updatedAt,
    })
    .from(documentPageLinks)
    .innerJoin(documents, eq(documentPageLinks.documentId, documents.id))
    .where(eq(documentPageLinks.pageId, pageId))
    .orderBy(desc(documents.updatedAt))
    .limit(100)) as Array<{
    documentId: number;
    title: string;
    status: string;
    previewToken: string | null;
    relationType: string;
    isPrimary: number;
    updatedAt: string;
  }>;

  return NextResponse.json(
    rows.map((row) => ({
      documentId: row.documentId,
      title: row.title,
      status: row.status,
      relationType: row.relationType,
      isPrimary: row.isPrimary,
      previewUrl: row.previewToken ? `/preview/${row.previewToken}` : null,
      updatedAt: row.updatedAt,
    }))
  );
}
