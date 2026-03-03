import { NextResponse } from 'next/server';
import { db, ensureDb } from '@/db/index';
import { users } from '@/db/schema';
import { desc } from 'drizzle-orm';
import { requireRole } from '@/lib/auth';

export async function GET() {
  await ensureDb();

  const auth = await requireRole('admin');
  if (auth.error) return auth.error;

  try {
    const rows = await db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        image: users.image,
        role: users.role,
        createdAt: users.createdAt,
      })
      .from(users)
      .orderBy(desc(users.createdAt));
    return NextResponse.json(rows);
  } catch {
    return NextResponse.json([], { status: 500 });
  }
}
