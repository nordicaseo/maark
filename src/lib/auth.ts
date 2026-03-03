import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db, ensureDb } from '@/db/index';
import { users } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { hasRole } from '@/lib/permissions';

export type AppUser = {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  role: string;
};

/**
 * Get the authenticated user from Supabase session + our users table.
 * Use in API route handlers and Server Components.
 */
export async function getAuthUser(): Promise<AppUser | null> {
  const supabase = await createClient();
  const {
    data: { user: supabaseUser },
  } = await supabase.auth.getUser();

  if (!supabaseUser?.email) return null;

  await ensureDb();
  const [appUser] = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      image: users.image,
      role: users.role,
    })
    .from(users)
    .where(eq(users.id, supabaseUser.id))
    .limit(1);

  return appUser ?? null;
}

/**
 * Require a minimum role level for an API route.
 * Returns the user if authorized, or a NextResponse error.
 */
export async function requireRole(
  requiredRole: string
): Promise<{ user: AppUser; error: null } | { user: null; error: NextResponse }> {
  const user = await getAuthUser();

  if (!user) {
    return {
      user: null,
      error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    };
  }

  if (!hasRole(user.role, requiredRole)) {
    return {
      user: null,
      error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    };
  }

  return { user, error: null };
}
