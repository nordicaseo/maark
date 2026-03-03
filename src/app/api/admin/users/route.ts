import { db, ensureDb } from '@/db/index';
import { users } from '@/db/schema';
import { desc } from 'drizzle-orm';

export async function GET() {
  try {
    await ensureDb();
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
    return Response.json(rows);
  } catch {
    return Response.json([], { status: 500 });
  }
}
