import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db, ensureDb } from '@/db';
import { invitations } from '@/db/schema';
import { requireRole } from '@/lib/auth';
import {
  buildInvitationUrls,
  isInvitationExpired,
  resolveInvitationStatus,
  sendInvitationEmail,
} from '@/lib/invitations';
import { logAlertEvent, logAuditEvent } from '@/lib/observability';

function parseInvitationId(raw: string): number | null {
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) return null;
  return value;
}

async function getInvitationById(id: number) {
  const [invitation] = await db
    .select({
      id: invitations.id,
      email: invitations.email,
      role: invitations.role,
      projectIds: invitations.projectIds,
      projectRole: invitations.projectRole,
      token: invitations.token,
      invitedById: invitations.invitedById,
      expiresAt: invitations.expiresAt,
      acceptedAt: invitations.acceptedAt,
      revokedAt: invitations.revokedAt,
      lastSentAt: invitations.lastSentAt,
      createdAt: invitations.createdAt,
    })
    .from(invitations)
    .where(eq(invitations.id, id))
    .limit(1);
  return invitation || null;
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await ensureDb();

  const auth = await requireRole('admin');
  if (auth.error) return auth.error;

  const { id } = await params;
  const invitationId = parseInvitationId(id);
  if (!invitationId) {
    return NextResponse.json({ error: 'Invalid invitation id' }, { status: 400 });
  }

  try {
    const invitation = await getInvitationById(invitationId);
    if (!invitation) {
      return NextResponse.json({ error: 'Invitation not found' }, { status: 404 });
    }

    await db
      .update(invitations)
      .set({ revokedAt: new Date() })
      .where(eq(invitations.id, invitationId));

    await logAuditEvent({
      userId: auth.user.id,
      action: 'admin.invitation.revoke',
      resourceType: 'invitation',
      resourceId: invitationId,
      severity: 'warning',
    });

    return NextResponse.json({
      success: true,
      id: invitation.id,
      status: 'revoked',
    });
  } catch (error) {
    await logAlertEvent({
      source: 'admin',
      eventType: 'invitation_revoke_failed',
      severity: 'error',
      message: 'Failed to revoke invitation.',
      resourceId: invitationId,
      metadata: { error: error instanceof Error ? error.message : 'Unknown error' },
    });
    console.error('Error revoking invitation:', error);
    return NextResponse.json(
      { error: 'Failed to revoke invitation' },
      { status: 500 }
    );
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await ensureDb();

  const auth = await requireRole('admin');
  if (auth.error) return auth.error;

  const { id } = await params;
  const invitationId = parseInvitationId(id);
  if (!invitationId) {
    return NextResponse.json({ error: 'Invalid invitation id' }, { status: 400 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const action = String((body as { action?: unknown }).action || '').trim();
    if (action !== 'resend' && action !== 'regenerate') {
      return NextResponse.json(
        { error: "Unsupported action. Use 'resend' or 'regenerate'." },
        { status: 400 }
      );
    }

    const invitation = await getInvitationById(invitationId);
    if (!invitation) {
      return NextResponse.json({ error: 'Invitation not found' }, { status: 404 });
    }

    if (invitation.acceptedAt) {
      return NextResponse.json(
        { error: 'Invitation already accepted.' },
        { status: 400 }
      );
    }

    if (invitation.revokedAt && action !== 'regenerate') {
      return NextResponse.json(
        { error: 'Invitation revoked. Regenerate to issue a new token.' },
        { status: 400 }
      );
    }

    if (action === 'resend' && isInvitationExpired(invitation.expiresAt)) {
      return NextResponse.json(
        { error: 'Invitation expired. Regenerate to issue a new token.' },
        { status: 400 }
      );
    }

    let token = invitation.token;
    let expiresAt = invitation.expiresAt;

    if (action === 'regenerate') {
      token = randomUUID();
      expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      await db
        .update(invitations)
        .set({
          token,
          expiresAt,
          acceptedAt: null,
          revokedAt: null,
        })
        .where(eq(invitations.id, invitation.id));
    }

    const { inviteUrl, redirectTo } = buildInvitationUrls(req, token);
    const { deliveryStatus, deliveryChannel, deliveryError, lastSentAt } =
      await sendInvitationEmail({
        email: invitation.email,
        redirectTo,
        inviteUrl,
      });

    if (lastSentAt) {
      await db
        .update(invitations)
        .set({ lastSentAt })
        .where(eq(invitations.id, invitation.id));
    }

    if (deliveryStatus === 'failed') {
      await logAlertEvent({
        source: 'admin',
        eventType: 'invitation_email_send_failed',
        severity: 'warning',
        message: 'Invitation email delivery failed.',
        resourceId: invitation.id,
        metadata: { email: invitation.email, channel: deliveryChannel, error: deliveryError },
      });
    }

    await logAuditEvent({
      userId: auth.user.id,
      action: action === 'regenerate' ? 'admin.invitation.regenerate' : 'admin.invitation.resend',
      resourceType: 'invitation',
      resourceId: invitation.id,
      severity: 'warning',
      metadata: {
        status: resolveInvitationStatus({
          ...invitation,
          expiresAt,
          revokedAt: action === 'regenerate' ? null : invitation.revokedAt,
        }),
        deliveryStatus,
        deliveryChannel,
        deliveryError,
      },
    });

    return NextResponse.json({
      success: true,
      id: invitation.id,
      token,
      inviteUrl,
      role: invitation.role,
      projectIds: invitation.projectIds ?? [],
      projectRole: invitation.projectRole ?? null,
      email: invitation.email,
      expiresAt,
      acceptedAt: invitation.acceptedAt,
      revokedAt: action === 'regenerate' ? null : invitation.revokedAt,
      lastSentAt: lastSentAt || invitation.lastSentAt || null,
      status: resolveInvitationStatus({
        acceptedAt: invitation.acceptedAt,
        revokedAt: action === 'regenerate' ? null : invitation.revokedAt,
        expiresAt,
      }),
      deliveryStatus,
      deliveryChannel,
      deliveryError,
    });
  } catch (error) {
    await logAlertEvent({
      source: 'admin',
      eventType: 'invitation_update_failed',
      severity: 'error',
      message: 'Failed to update invitation.',
      resourceId: invitationId,
      metadata: { error: error instanceof Error ? error.message : 'Unknown error' },
    });
    console.error('Error updating invitation:', error);
    return NextResponse.json(
      { error: 'Failed to update invitation' },
      { status: 500 }
    );
  }
}
