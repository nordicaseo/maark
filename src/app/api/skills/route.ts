import { NextRequest, NextResponse } from 'next/server';
import { db, ensureDb } from '@/db/index';
import { skills } from '@/db/schema';
import { desc, eq, or, sql } from 'drizzle-orm';
import { getAuthUser, requireRole } from '@/lib/auth';
import {
  getAccessibleProjectIds,
  getRequestedProjectId,
  isAdminUser,
  userCanAccessProject,
} from '@/lib/access';

export async function GET(req: NextRequest) {
  await ensureDb();
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const requestedProjectId = getRequestedProjectId(req);

  try {
    if (isAdminUser(user)) {
      const adminResults =
        requestedProjectId !== null
          ? await db
              .select()
              .from(skills)
              .where(
                or(eq(skills.isGlobal, 1), eq(skills.projectId, requestedProjectId))
              )
              .orderBy(desc(skills.updatedAt))
          : await db.select().from(skills).orderBy(desc(skills.updatedAt));
      return NextResponse.json(adminResults);
    }

    const accessibleProjectIds = await getAccessibleProjectIds(user);
    if (requestedProjectId !== null) {
      const canAccessRequested = accessibleProjectIds.includes(requestedProjectId);
      const scoped = canAccessRequested
        ? await db
            .select()
            .from(skills)
            .where(
              or(eq(skills.isGlobal, 1), eq(skills.projectId, requestedProjectId))
            )
            .orderBy(desc(skills.updatedAt))
        : await db
            .select()
            .from(skills)
            .where(eq(skills.isGlobal, 1))
            .orderBy(desc(skills.updatedAt));
      return NextResponse.json(scoped);
    }

    if (accessibleProjectIds.length === 0) {
      const globalOnly = await db
        .select()
        .from(skills)
        .where(eq(skills.isGlobal, 1))
        .orderBy(desc(skills.updatedAt));
      return NextResponse.json(globalOnly);
    }

    const results = await db
      .select()
      .from(skills)
      .where(
        or(
          eq(skills.isGlobal, 1),
          sql`${skills.projectId} IN (${sql.join(
            accessibleProjectIds.map((id) => sql`${id}`),
            sql`, `
          )})`
        )
      )
      .orderBy(desc(skills.updatedAt));
    return NextResponse.json(results);
  } catch (error) {
    console.error('Error fetching skills:', error);
    return NextResponse.json([], { status: 200 });
  }
}

export async function POST(req: NextRequest) {
  await ensureDb();

  const auth = await requireRole('editor');
  if (auth.error) return auth.error;

  try {
    const body = await req.json();
    const { name, description, content, projectId, isGlobal, createdById } = body;
    const parsedProjectId =
      projectId !== undefined && projectId !== null && projectId !== ''
        ? parseInt(projectId, 10)
        : getRequestedProjectId(req);
    const createGlobal = Boolean(isGlobal);

    if (!name || !content) {
      return NextResponse.json(
        { error: 'Name and content are required' },
        { status: 400 }
      );
    }
    if (createGlobal && !isAdminUser(auth.user)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (!(await userCanAccessProject(auth.user, parsedProjectId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const safeCreatedById =
      isAdminUser(auth.user) && createdById ? createdById : auth.user.id;

    const [skill] = await db
      .insert(skills)
      .values({
        name,
        description: description || null,
        content,
        projectId: parsedProjectId ?? null,
        isGlobal: createGlobal ? 1 : 0,
        createdById: safeCreatedById || null,
      })
      .returning();

    return NextResponse.json(skill);
  } catch (error) {
    console.error('Error creating skill:', error);
    return NextResponse.json(
      { error: 'Failed to create skill' },
      { status: 500 }
    );
  }
}
