import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db, ensureDb } from '@/db/index';
import { users, documents, projects, projectMembers, skills, invitations } from '@/db/schema';
import { eq, sql, and, isNull } from 'drizzle-orm';
import { dbNow } from '@/db/utils';

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

          // Check if this user already exists in our app users table
          const existing = await db
            .select()
            .from(users)
            .where(eq(users.email, supabaseUser.email))
            .limit(1);

          if (existing.length === 0) {
            // New user — determine role (first user becomes owner)
            const [countResult] = await db
              .select({ count: sql<number>`count(*)` })
              .from(users);
            const totalUsers = Number(countResult?.count ?? 0);
            let role = totalUsers === 0 ? 'owner' : 'writer';

            // ── Check for invitation (by token or email) ──────────────
            const inviteToken = searchParams.get('invite_token');
            let matchedInvitation: any = null;

            if (inviteToken) {
              const [inv] = await db
                .select()
                .from(invitations)
                .where(
                  and(
                    eq(invitations.token, inviteToken),
                    isNull(invitations.acceptedAt)
                  )
                )
                .limit(1);
              if (inv) matchedInvitation = inv;
            }

            if (!matchedInvitation && supabaseUser.email) {
              const [inv] = await db
                .select()
                .from(invitations)
                .where(
                  and(
                    eq(invitations.email, supabaseUser.email),
                    isNull(invitations.acceptedAt)
                  )
                )
                .limit(1);
              if (inv) matchedInvitation = inv;
            }

            if (matchedInvitation && totalUsers > 0) {
              role = matchedInvitation.role;
              await db
                .update(invitations)
                .set({ acceptedAt: dbNow() })
                .where(eq(invitations.id, matchedInvitation.id));
            }

            await db.insert(users).values({
              id: supabaseUser.id,
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
          }
        } catch (dbError) {
          // Don't block auth — user record will sync on next API request
          console.error('Auth callback DB sync error:', dbError);
        }
      }

      const forwardedHost = request.headers.get('x-forwarded-host');
      const isLocalEnv = process.env.NODE_ENV === 'development';
      if (isLocalEnv) {
        return NextResponse.redirect(`${origin}${next}`);
      } else if (forwardedHost) {
        return NextResponse.redirect(`https://${forwardedHost}${next}`);
      } else {
        return NextResponse.redirect(`${origin}${next}`);
      }
    }
  }

  // Auth error — redirect to sign-in
  return NextResponse.redirect(`${origin}/auth/signin?error=auth_callback_failed`);
}
