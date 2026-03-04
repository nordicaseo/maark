import { NextRequest, NextResponse } from 'next/server';
import { db, ensureDb } from '@/db';
import { invitations, users } from '@/db/schema';
import { desc, eq } from 'drizzle-orm';
import { requireRole } from '@/lib/auth';
import { ASSIGNABLE_ROLES } from '@/lib/permissions';
import { randomUUID } from 'crypto';
import { logAlertEvent, logAuditEvent } from '@/lib/observability';

export async function GET() {
  await ensureDb();

  const auth = await requireRole('admin');
  if (auth.error) return auth.error;

  try {
    const rows = await db
      .select({
        id: invitations.id,
        email: invitations.email,
        role: invitations.role,
        token: invitations.token,
        invitedById: invitations.invitedById,
        inviterName: users.name,
        expiresAt: invitations.expiresAt,
        acceptedAt: invitations.acceptedAt,
        createdAt: invitations.createdAt,
      })
      .from(invitations)
      .leftJoin(users, eq(invitations.invitedById, users.id))
      .orderBy(desc(invitations.createdAt));

    return NextResponse.json(rows);
  } catch (error) {
    console.error('Error fetching invitations:', error);
    return NextResponse.json([], { status: 200 });
  }
}

export async function POST(req: NextRequest) {
  await ensureDb();

  const auth = await requireRole('admin');
  if (auth.error) return auth.error;

  try {
    const body = await req.json();
    const { email, role } = body;

    // Validate role
    if (role && !ASSIGNABLE_ROLES.includes(role)) {
      return NextResponse.json(
        { error: `Invalid role. Must be one of: ${ASSIGNABLE_ROLES.join(', ')}` },
        { status: 400 }
      );
    }

    const token = randomUUID();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    const [invitation] = await db
      .insert(invitations)
      .values({
        email: email || null,
        role: role || 'writer',
        token,
        invitedById: auth.user.id,
        expiresAt: expiresAt.toISOString(),
      })
      .returning();

    await logAuditEvent({
      userId: auth.user.id,
      action: 'admin.invitation.create',
      resourceType: 'invitation',
      resourceId: invitation.id,
      severity: 'warning',
      metadata: { role: invitation.role, email: invitation.email },
    });

    // Build the invite URL
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL
      || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');
    const inviteUrl = `${baseUrl}/auth/invite?token=${token}`;

    return NextResponse.json({
      id: invitation.id,
      token: invitation.token,
      inviteUrl,
      role: invitation.role,
      email: invitation.email,
      expiresAt: invitation.expiresAt,
    });
  } catch (error) {
    await logAlertEvent({
      source: 'admin',
      eventType: 'invitation_create_failed',
      severity: 'error',
      message: 'Failed to create invitation.',
      metadata: { error: error instanceof Error ? error.message : 'Unknown error' },
    });
    console.error('Error creating invitation:', error);
    return NextResponse.json(
      { error: 'Failed to create invitation' },
      { status: 500 }
    );
  }
}
