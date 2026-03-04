import { NextRequest, NextResponse } from 'next/server';
import { db, ensureDb } from '@/db';
import { invitations } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { requireRole } from '@/lib/auth';
import { logAlertEvent, logAuditEvent } from '@/lib/observability';

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

    await logAuditEvent({
      userId: auth.user.id,
      action: 'admin.invitation.delete',
      resourceType: 'invitation',
      resourceId: id,
      severity: 'warning',
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    await logAlertEvent({
      source: 'admin',
      eventType: 'invitation_delete_failed',
      severity: 'error',
      message: 'Failed to revoke invitation.',
      resourceId: id,
      metadata: { error: error instanceof Error ? error.message : 'Unknown error' },
    });
    console.error('Error deleting invitation:', error);
    return NextResponse.json(
      { error: 'Failed to delete invitation' },
      { status: 500 }
    );
  }
}
