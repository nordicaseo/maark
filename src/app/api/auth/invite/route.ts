import { NextRequest, NextResponse } from 'next/server';
import { db, ensureDb } from '@/db';
import { invitations, users } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { isInvitationExpired, resolveInvitationStatus } from '@/lib/invitations';

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token');

  if (!token) {
    return NextResponse.json({ valid: false, error: 'No token provided' });
  }

  try {
    await ensureDb();

    const [invitation] = await db
      .select({
        id: invitations.id,
        role: invitations.role,
        projectIds: invitations.projectIds,
        projectRole: invitations.projectRole,
        email: invitations.email,
        expiresAt: invitations.expiresAt,
        acceptedAt: invitations.acceptedAt,
        revokedAt: invitations.revokedAt,
        invitedById: invitations.invitedById,
        inviterName: users.name,
      })
      .from(invitations)
      .leftJoin(users, eq(invitations.invitedById, users.id))
      .where(eq(invitations.token, token))
      .limit(1);

    if (!invitation) {
      return NextResponse.json({ valid: false, error: 'Invitation not found' });
    }

    const status = resolveInvitationStatus(invitation);
    if (status === 'accepted') {
      return NextResponse.json({ valid: false, error: 'Invitation already used' });
    }
    if (status === 'revoked') {
      return NextResponse.json({ valid: false, error: 'Invitation revoked' });
    }

    if (isInvitationExpired(invitation.expiresAt)) {
      return NextResponse.json({ valid: false, error: 'Invitation expired' });
    }

    return NextResponse.json({
      valid: true,
      role: invitation.role,
      projectIds: invitation.projectIds ?? [],
      projectRole: invitation.projectRole ?? null,
      inviterName: invitation.inviterName || 'Team admin',
    });
  } catch (error) {
    console.error('Error validating invitation:', error);
    return NextResponse.json(
      { valid: false, error: 'Failed to validate invitation' },
      { status: 500 }
    );
  }
}
