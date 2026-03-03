import { createClient } from '@/lib/supabase/server';
import { db, ensureDb } from '@/db/index';
import { users } from '@/db/schema';
import { eq } from 'drizzle-orm';

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
