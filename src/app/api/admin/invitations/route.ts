import { NextRequest, NextResponse } from 'next/server';
import { db, ensureDb } from '@/db';
import { invitations, users } from '@/db/schema';
import { desc, eq } from 'drizzle-orm';
import { requireRole } from '@/lib/auth';
import { ASSIGNABLE_ROLES, PROJECT_ASSIGNABLE_ROLES } from '@/lib/permissions';
import { randomUUID } from 'crypto';
import { logAlertEvent, logAuditEvent } from '@/lib/observability';
import { getAccessibleProjectIds, getRequestedProjectId, userCanMutateProject } from '@/lib/access';
import {
  buildInvitationUrls,
  resolveInvitationStatus,
  sendInvitationEmail,
} from '@/lib/invitations';

function sanitizeProjectIds(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  const unique = new Set<number>();
  for (const value of raw) {
    const parsed = Number.parseInt(String(value), 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      unique.add(parsed);
    }
  }
  return Array.from(unique);
}

function isRootRole(role: string): boolean {
  return role === 'owner' || role === 'super_admin';
}

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
        projectIds: invitations.projectIds,
        projectRole: invitations.projectRole,
        token: invitations.token,
        invitedById: invitations.invitedById,
        inviterName: users.name,
        expiresAt: invitations.expiresAt,
        acceptedAt: invitations.acceptedAt,
        revokedAt: invitations.revokedAt,
        lastSentAt: invitations.lastSentAt,
        createdAt: invitations.createdAt,
      })
      .from(invitations)
      .leftJoin(users, eq(invitations.invitedById, users.id))
      .orderBy(desc(invitations.createdAt));

    return NextResponse.json(
      rows.map((invitation: (typeof rows)[number]) => ({
        ...invitation,
        status: resolveInvitationStatus(invitation),
      }))
    );
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
    const email =
      typeof body.email === 'string' && body.email.trim().length > 0
        ? body.email.trim().toLowerCase()
        : null;
    const role = typeof body.role === 'string' ? body.role : 'writer';
    let projectIds = sanitizeProjectIds(body.projectIds);
    const projectRoleRaw =
      typeof body.projectRole === 'string' ? body.projectRole : 'writer';
    const targetIsRootRole = isRootRole(role);
    let scopeAutofill:
      | null
      | {
          mode: 'active_project' | 'all_mutable_projects';
          projectIds: number[];
        } = null;

    // Validate role
    if (!ASSIGNABLE_ROLES.includes(role)) {
      return NextResponse.json(
        { error: `Invalid role. Must be one of: ${ASSIGNABLE_ROLES.join(', ')}` },
        { status: 400 }
      );
    }
    if (
      !targetIsRootRole &&
      !PROJECT_ASSIGNABLE_ROLES.includes(
        projectRoleRaw as (typeof PROJECT_ASSIGNABLE_ROLES)[number]
      )
    ) {
      return NextResponse.json(
        { error: `Invalid projectRole. Must be one of: ${PROJECT_ASSIGNABLE_ROLES.join(', ')}` },
        { status: 400 }
      );
    }

    const inviterIsOwner = auth.user.role === 'owner';

    if (targetIsRootRole && !inviterIsOwner) {
      return NextResponse.json(
        { error: 'Only owner can invite owner/super_admin roles.' },
        { status: 403 }
      );
    }

    if (!targetIsRootRole && projectIds.length === 0) {
      const requestedProjectId = getRequestedProjectId(req);
      if (
        requestedProjectId !== null &&
        (await userCanMutateProject(auth.user, requestedProjectId, 'admin'))
      ) {
        projectIds = [requestedProjectId];
        scopeAutofill = {
          mode: 'active_project',
          projectIds,
        };
      } else {
        const accessibleProjectIds = await getAccessibleProjectIds(auth.user);
        const mutableProjectIds: number[] = [];
        for (const projectId of accessibleProjectIds) {
          if (await userCanMutateProject(auth.user, projectId, 'admin')) {
            mutableProjectIds.push(projectId);
          }
        }
        if (mutableProjectIds.length > 0) {
          projectIds = mutableProjectIds;
          scopeAutofill = {
            mode: 'all_mutable_projects',
            projectIds,
          };
        }
      }
    }

    if (!targetIsRootRole && projectIds.length === 0) {
      return NextResponse.json(
        {
          error:
            'At least one project assignment is required for non-root invitations. Select projects in the invite dialog.',
        },
        { status: 400 }
      );
    }

    for (const projectId of projectIds) {
      if (!(await userCanMutateProject(auth.user, projectId, 'admin'))) {
        return NextResponse.json(
          { error: `Forbidden project scope for projectId ${projectId}` },
          { status: 403 }
        );
      }
    }

    const token = randomUUID();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    const [invitation] = await db
      .insert(invitations)
      .values({
        email,
        role,
        projectIds: projectIds.length > 0 ? projectIds : null,
        projectRole: targetIsRootRole ? null : projectRoleRaw,
        token,
        invitedById: auth.user.id,
        expiresAt,
      })
      .returning();

    await logAuditEvent({
      userId: auth.user.id,
      action: 'admin.invitation.create',
      resourceType: 'invitation',
      resourceId: invitation.id,
      severity: 'warning',
      metadata: {
        role: invitation.role,
        email: invitation.email,
        projectIds: invitation.projectIds ?? [],
        projectRole: invitation.projectRole ?? null,
        scopeAutofill,
      },
    });

    const { inviteUrl, redirectTo } = buildInvitationUrls(req, token);
    const { deliveryStatus, deliveryError, lastSentAt } =
      await sendInvitationEmail({
        email: invitation.email,
        redirectTo,
      });

    if (deliveryStatus === 'failed') {
      await logAlertEvent({
        source: 'admin',
        eventType: 'invitation_email_send_failed',
        severity: 'warning',
        message: 'Invitation email delivery failed via Supabase.',
        resourceId: String(invitation.id),
        metadata: { email: invitation.email, error: deliveryError },
      });
    }

    if (lastSentAt) {
      await db
        .update(invitations)
        .set({ lastSentAt })
        .where(eq(invitations.id, invitation.id));
    }

    await logAuditEvent({
      userId: auth.user.id,
      action: 'admin.invitation.delivery_status',
      resourceType: 'invitation',
      resourceId: invitation.id,
      severity: deliveryStatus === 'failed' ? 'warning' : 'info',
      metadata: {
        email,
        status: deliveryStatus,
        error: deliveryError,
      },
    });

    return NextResponse.json({
      id: invitation.id,
      token: invitation.token,
      inviteUrl,
      role: invitation.role,
      projectIds: invitation.projectIds ?? [],
      projectRole: invitation.projectRole,
      email: invitation.email,
      expiresAt: invitation.expiresAt,
      acceptedAt: invitation.acceptedAt,
      revokedAt: invitation.revokedAt,
      lastSentAt: lastSentAt || invitation.lastSentAt || null,
      status: resolveInvitationStatus(invitation),
      deliveryStatus,
      deliveryError,
      scopeAutofill,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    await logAlertEvent({
      source: 'admin',
      eventType: 'invitation_create_failed',
      severity: 'error',
      message: 'Failed to create invitation.',
      metadata: { error: message },
    });
    console.error('Error creating invitation:', error);
    return NextResponse.json(
      { error: 'Failed to create invitation', detail: message },
      { status: 500 }
    );
  }
}
