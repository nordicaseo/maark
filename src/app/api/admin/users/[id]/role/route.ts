import { NextRequest, NextResponse } from 'next/server';
import { db, ensureDb } from '@/db';
import { users } from '@/db/schema';
import { eq, sql } from 'drizzle-orm';
import { requireRole } from '@/lib/auth';
import { ASSIGNABLE_ROLES } from '@/lib/permissions';
import { logAlertEvent, logAuditEvent } from '@/lib/observability';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await ensureDb();

  // Only admin+ can change roles
  const auth = await requireRole('admin');
  if (auth.error) return auth.error;

  const { id: targetUserId } = await params;
  const body = await req.json();
  const { role } = body;

  // Validate role value
  const validRoles = [...ASSIGNABLE_ROLES, 'owner'];
  if (!role || !validRoles.includes(role)) {
    return NextResponse.json(
      { error: `Invalid role. Must be one of: ${validRoles.join(', ')}` },
      { status: 400 }
    );
  }

  try {
    // Fetch target user
    const [targetUser] = await db
      .select()
      .from(users)
      .where(eq(users.id, targetUserId))
      .limit(1);

    if (!targetUser) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Only the owner can promote to owner or demote another owner
    if (role === 'owner' && auth.user.role !== 'owner') {
      return NextResponse.json(
        { error: 'Only the owner can promote to owner' },
        { status: 403 }
      );
    }

    if (targetUser.role === 'owner' && auth.user.role !== 'owner') {
      return NextResponse.json(
        { error: 'Only the owner can change another owner\'s role' },
        { status: 403 }
      );
    }

    // Prevent demoting the last owner
    if (targetUser.role === 'owner' && role !== 'owner') {
      const [countResult] = await db
        .select({ count: sql<number>`count(*)` })
        .from(users)
        .where(eq(users.role, 'owner'));
      const ownerCount = Number(countResult?.count ?? 0);
      if (ownerCount <= 1) {
        return NextResponse.json(
          { error: 'Cannot demote the last owner' },
          { status: 400 }
        );
      }
    }

    // Update role
    const [updated] = await db
      .update(users)
      .set({ role })
      .where(eq(users.id, targetUserId))
      .returning();

    await logAuditEvent({
      userId: auth.user.id,
      action: 'admin.user.role_update',
      resourceType: 'user',
      resourceId: updated.id,
      severity: 'warning',
      metadata: { from: targetUser.role, to: updated.role },
    });

    return NextResponse.json({
      id: updated.id,
      role: updated.role,
    });
  } catch (error) {
    await logAlertEvent({
      source: 'admin',
      eventType: 'user_role_update_failed',
      severity: 'error',
      message: 'Failed to update user role.',
      resourceId: targetUserId,
      metadata: { error: error instanceof Error ? error.message : 'Unknown error' },
    });
    console.error('Error updating user role:', error);
    return NextResponse.json(
      { error: 'Failed to update role' },
      { status: 500 }
    );
  }
}
