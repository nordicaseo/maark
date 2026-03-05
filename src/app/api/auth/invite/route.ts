import { NextRequest, NextResponse } from 'next/server';
import { db, ensureDb } from '@/db';
import { invitations, users } from '@/db/schema';
import { eq } from 'drizzle-orm';

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

    if (invitation.acceptedAt) {
      return NextResponse.json({ valid: false, error: 'Invitation already used' });
    }

    // Check expiry
    const expiresAt = new Date(invitation.expiresAt);
    if (expiresAt < new Date()) {
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
