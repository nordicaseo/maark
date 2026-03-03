import { NextResponse } from 'next/server';
import { db, ensureDb } from '@/db';
import { users } from '@/db/schema';
import { getAuthUser } from '@/lib/auth';

export async function GET() {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    await ensureDb();
    const rows = await db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        image: users.image,
        role: users.role,
      })
      .from(users);

    return NextResponse.json(rows);
  } catch (error) {
    console.error('Error fetching team members:', error);
    return NextResponse.json([], { status: 200 });
  }
}
