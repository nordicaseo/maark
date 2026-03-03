import { NextRequest, NextResponse } from 'next/server';
import { db, ensureDb } from '@/db';
import { invitations } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { requireRole } from '@/lib/auth';

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await ensureDb();

  const auth = await requireRole('admin');
  if (auth.error) return auth.error;

  const { id } = await params;

  try {
    await db
      .delete(invitations)
      .where(eq(invitations.id, parseInt(id, 10)));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting invitation:', error);
    return NextResponse.json(
      { error: 'Failed to delete invitation' },
      { status: 500 }
    );
  }
}
