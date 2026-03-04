import { NextRequest, NextResponse } from 'next/server';
import { db, ensureDb } from '@/db';
import { projectMembers, users } from '@/db/schema';
import { getAuthUser } from '@/lib/auth';
import {
  getAccessibleProjectIds,
  getRequestedProjectId,
  isAdminUser,
  userCanAccessProject,
} from '@/lib/access';
import { eq, inArray } from 'drizzle-orm';

export async function GET(req: NextRequest) {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    await ensureDb();
    const requestedProjectId = getRequestedProjectId(req);

    if (requestedProjectId !== null) {
      if (!(await userCanAccessProject(user, requestedProjectId))) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
      const rows = await db
        .select({
          id: users.id,
          name: users.name,
          email: users.email,
          image: users.image,
          role: users.role,
        })
        .from(projectMembers)
        .innerJoin(users, eq(projectMembers.userId, users.id))
        .where(eq(projectMembers.projectId, requestedProjectId));
      return NextResponse.json(rows);
    }

    if (isAdminUser(user)) {
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
    }

    const accessibleProjectIds = await getAccessibleProjectIds(user);
    if (accessibleProjectIds.length === 0) {
      return NextResponse.json([]);
    }

    const rows = await db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        image: users.image,
        role: users.role,
      })
      .from(projectMembers)
      .innerJoin(users, eq(projectMembers.userId, users.id))
      .where(inArray(projectMembers.projectId, accessibleProjectIds));

    const seen = new Set<string>();
    const uniqueRows = rows.filter((row: (typeof rows)[number]) => {
      if (seen.has(row.id)) return false;
      seen.add(row.id);
      return true;
    });

    return NextResponse.json(uniqueRows);
  } catch (error) {
    console.error('Error fetching team members:', error);
    return NextResponse.json([], { status: 200 });
  }
}
