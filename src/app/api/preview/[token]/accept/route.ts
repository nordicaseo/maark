import { NextRequest, NextResponse } from 'next/server';
import { db, ensureDb } from '@/db/index';
import { documents } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { dbNow } from '@/db/utils';
import { getConvexClient } from '@/lib/convex/server';
import { api } from '../../../../../../convex/_generated/api';

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  await ensureDb();
  const { token } = await params;

  // Find document by preview token
  const [doc] = await db
    .select()
    .from(documents)
    .where(eq(documents.previewToken, token));

  if (!doc) {
    return NextResponse.json({ error: 'Preview not found' }, { status: 404 });
  }

  // Update document status to 'accepted'
  await db
    .update(documents)
    .set({ status: 'accepted', updatedAt: dbNow() })
    .where(eq(documents.id, doc.id));

  // Sync to Convex task
  try {
    const convex = getConvexClient();
    if (convex) {
      const linkedTasks = await convex.query(api.tasks.getByDocument, {
        documentId: doc.id,
        projectId: doc.projectId ?? undefined,
      });
      for (const task of linkedTasks) {
        if (task.status !== 'ACCEPTED') {
          await convex.mutation(api.tasks.updateStatusFromSync, {
            id: task._id,
            status: 'ACCEPTED',
            expectedProjectId: doc.projectId ?? undefined,
          });
        }
      }
    }
  } catch (err) {
    console.error('Accept sync to Convex failed:', err);
  }

  return NextResponse.json({ success: true, status: 'accepted' });
}
