import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db, ensureDb } from '@/db/index';
import { users, documents, projects, projectMembers, skills, invitations } from '@/db/schema';
import { eq, sql, and, isNull } from 'drizzle-orm';
import { dbNow } from '@/db/utils';
import { logAuditEvent } from '@/lib/observability';

type InvitationRecord = typeof invitations.$inferSelect;

const PROJECT_ROLE_ORDER: Record<string, number> = {
  client: 1,
  writer: 2,
  editor: 3,
  admin: 4,
};

function parseInvitationProjectIds(value: unknown): number[] {
  const parsed = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? (() => {
          try {
            const maybe = JSON.parse(value);
            return Array.isArray(maybe) ? maybe : [];
          } catch {
            return [];
          }
        })()
      : [];
  const unique = new Set<number>();
  for (const raw of parsed) {
    const n = Number.parseInt(String(raw), 10);
    if (Number.isFinite(n) && n > 0) unique.add(n);
  }
  return Array.from(unique);
}

function resolveInvitationProjectRole(invitation: InvitationRecord): 'admin' | 'editor' | 'writer' | 'client' {
  const role = String(invitation.projectRole || invitation.role || 'writer');
  if (role === 'admin' || role === 'editor' || role === 'writer' || role === 'client') {
    return role;
  }
  return 'writer';
}

function isRootRole(role: string): boolean {
  return role === 'owner' || role === 'super_admin';
}

function roleRank(role: string): number {
  return PROJECT_ROLE_ORDER[role] ?? 0;
}

async function findPendingInvitation(args: {
  inviteToken: string | null;
  email: string | null | undefined;
}): Promise<InvitationRecord | null> {
  if (args.inviteToken) {
    const [inv] = await db
      .select()
      .from(invitations)
      .where(
        and(
          eq(invitations.token, args.inviteToken),
          isNull(invitations.acceptedAt)
        )
      )
      .limit(1);
    if (inv) return inv;
  }

  if (args.email) {
    const [inv] = await db
      .select()
      .from(invitations)
      .where(
        and(
          eq(invitations.email, args.email),
          isNull(invitations.acceptedAt)
        )
      )
      .limit(1);
    if (inv) return inv;
  }

  return null;
}

async function applyInvitationMemberships(
  userId: string,
  invitation: InvitationRecord
) {
  const projectIds = parseInvitationProjectIds(invitation.projectIds);
  if (projectIds.length === 0) return;

  const invitedProjectRole = resolveInvitationProjectRole(invitation);

  for (const projectId of projectIds) {
    const [existingMembership] = await db
      .select({
        id: projectMembers.id,
        role: projectMembers.role,
      })
      .from(projectMembers)
      .where(
        and(
          eq(projectMembers.projectId, projectId),
          eq(projectMembers.userId, userId)
        )
      )
      .limit(1);

    if (!existingMembership) {
      await db.insert(projectMembers).values({
        projectId,
        userId,
        role: invitedProjectRole,
      });

      await logAuditEvent({
        userId,
        action: 'auth.invite.membership_granted',
        resourceType: 'project_member',
        resourceId: `${projectId}:${userId}`,
        projectId,
        metadata: { role: invitedProjectRole },
      });
      continue;
    }

    const currentRole = String(existingMembership.role || 'client');
    if (roleRank(invitedProjectRole) > roleRank(currentRole)) {
      await db
        .update(projectMembers)
        .set({ role: invitedProjectRole })
        .where(eq(projectMembers.id, existingMembership.id));

      await logAuditEvent({
        userId,
        action: 'auth.invite.membership_role_upgraded',
        resourceType: 'project_member',
        resourceId: `${projectId}:${userId}`,
        projectId,
        metadata: { from: currentRole, to: invitedProjectRole },
      });
    }
  }
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/documents';

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (error) {
      console.error('Auth code exchange failed:', error.message);
    }

    if (!error) {
      const {
        data: { user: supabaseUser },
      } = await supabase.auth.getUser();

      if (supabaseUser?.email) {
        try {
          await ensureDb();

          const inviteToken = searchParams.get('invite_token');
          const matchedInvitation = await findPendingInvitation({
            inviteToken,
            email: supabaseUser.email,
          });

          // Check if this user already exists in our app users table.
          const existing = await db
            .select()
            .from(users)
            .where(eq(users.email, supabaseUser.email))
            .limit(1);

          let effectiveUserId = supabaseUser.id;

          if (existing.length === 0) {
            // New user: first user becomes owner, otherwise invitation/default role.
            const [countResult] = await db
              .select({ count: sql<number>`count(*)` })
              .from(users);
            const totalUsers = Number(countResult?.count ?? 0);
            let role = totalUsers === 0 ? 'owner' : 'writer';
            if (matchedInvitation && totalUsers > 0) {
              role = matchedInvitation.role;
            }

            await db.insert(users).values({
              id: effectiveUserId,
              email: supabaseUser.email,
              name:
                supabaseUser.user_metadata?.full_name ??
                supabaseUser.user_metadata?.name ??
                null,
              image: supabaseUser.user_metadata?.avatar_url ?? null,
              role,
            });
          } else if (existing[0].id !== supabaseUser.id) {
            // Existing user with different ID (migrated from NextAuth) —
            // update the ID to match Supabase auth user UUID
            const oldId = existing[0].id;
            const newId = supabaseUser.id;

            // Update all FK references, then the user itself
            await db
              .update(projectMembers)
              .set({ userId: newId })
              .where(eq(projectMembers.userId, oldId));
            await db
              .update(projects)
              .set({ createdById: newId })
              .where(eq(projects.createdById, oldId));
            await db
              .update(documents)
              .set({ authorId: newId })
              .where(eq(documents.authorId, oldId));
            await db
              .update(skills)
              .set({ createdById: newId })
              .where(eq(skills.createdById, oldId));
            await db
              .update(users)
              .set({ id: newId })
              .where(eq(users.id, oldId));
            effectiveUserId = newId;
          } else {
            effectiveUserId = existing[0].id;
            if (matchedInvitation && !isRootRole(existing[0].role)) {
              await db
                .update(users)
                .set({ role: matchedInvitation.role })
                .where(eq(users.id, existing[0].id));
            }
          }

          if (matchedInvitation) {
            await db
              .update(invitations)
              .set({ acceptedAt: dbNow() })
              .where(eq(invitations.id, matchedInvitation.id));

            await applyInvitationMemberships(effectiveUserId, matchedInvitation);

            await logAuditEvent({
              userId: effectiveUserId,
              action: 'auth.invite.accepted',
              resourceType: 'invitation',
              resourceId: matchedInvitation.id,
              metadata: {
                role: matchedInvitation.role,
                projectIds: parseInvitationProjectIds(matchedInvitation.projectIds),
                projectRole: matchedInvitation.projectRole ?? null,
              },
            });
          }
        } catch (dbError) {
          // Don't block auth — user record will sync on next API request
          console.error('Auth callback DB sync error:', dbError);
        }
      }

      const configured = process.env.NEXT_PUBLIC_APP_URL;
      const forwardedHost = request.headers.get('x-forwarded-host');
      const isLocalEnv = process.env.NODE_ENV === 'development';

      let redirectBase: string;
      if (configured) {
        redirectBase = configured;
      } else if (isLocalEnv) {
        redirectBase = origin;
      } else if (forwardedHost) {
        redirectBase = `https://${forwardedHost}`;
      } else {
        redirectBase = origin;
      }

      return NextResponse.redirect(`${redirectBase}${next}`);
    }
  }

  // Auth error — redirect to sign-in
  const errorBase = process.env.NEXT_PUBLIC_APP_URL || origin;
  return NextResponse.redirect(`${errorBase}/auth/signin?error=auth_callback_failed`);
}
