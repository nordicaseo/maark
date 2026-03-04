import { NextRequest, NextResponse } from 'next/server';
import { db, ensureDb } from '@/db/index';
import { projects, projectMembers } from '@/db/schema';
import { desc, eq, sql } from 'drizzle-orm';
import { getAuthUser, requireRole } from '@/lib/auth';
import { isAdminUser } from '@/lib/access';

export async function GET(req: NextRequest) {
  await ensureDb();
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const userId = req.nextUrl.searchParams.get('userId');

  try {
    if (userId && !isAdminUser(user) && userId !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const selectQuery = db
      .select({
        id: projects.id,
        name: projects.name,
        description: projects.description,
        defaultContentFormat: projects.defaultContentFormat,
        brandVoice: projects.brandVoice,
        settings: projects.settings,
        createdById: projects.createdById,
        createdAt: projects.createdAt,
        updatedAt: projects.updatedAt,
        memberCount: sql<number>`(SELECT COUNT(*) FROM project_members WHERE project_id = ${projects.id})`,
      })
      .from(projects)
      .orderBy(desc(projects.updatedAt));

    if (isAdminUser(user) && !userId) {
      return NextResponse.json(await selectQuery);
    }

    const targetUserId = userId && isAdminUser(user) ? userId : user.id;
    const memberRows = await db
      .select({ projectId: projectMembers.projectId })
      .from(projectMembers)
      .where(eq(projectMembers.userId, targetUserId));

    const projectIds = memberRows.map((r: { projectId: number }) => r.projectId);
    if (projectIds.length === 0) {
      return NextResponse.json([]);
    }

    const results = await db
      .select({
        id: projects.id,
        name: projects.name,
        description: projects.description,
        defaultContentFormat: projects.defaultContentFormat,
        brandVoice: projects.brandVoice,
        settings: projects.settings,
        createdById: projects.createdById,
        createdAt: projects.createdAt,
        updatedAt: projects.updatedAt,
        memberCount: sql<number>`(SELECT COUNT(*) FROM project_members WHERE project_id = ${projects.id})`,
      })
      .from(projects)
      .where(
        sql`${projects.id} IN (${sql.join(
          projectIds.map((id: number) => sql`${id}`),
          sql`, `
        )})`
      )
      .orderBy(desc(projects.updatedAt));

    return NextResponse.json(results);
  } catch (error) {
    console.error('Error fetching projects:', error);
    return NextResponse.json([], { status: 200 });
  }
}

export async function POST(req: NextRequest) {
  await ensureDb();
  const auth = await requireRole('admin');
  if (auth.error) return auth.error;
  try {
    const body = await req.json();
    const { name, description, defaultContentFormat, brandVoice, createdById } = body;

    if (!name) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 });
    }

    const [project] = await db
      .insert(projects)
      .values({
        name,
        description: description || null,
        defaultContentFormat: defaultContentFormat || 'blog_post',
        brandVoice: brandVoice || null,
        createdById: createdById || null,
      })
      .returning();

    return NextResponse.json(project);
  } catch (error) {
    console.error('Error creating project:', error);
    return NextResponse.json(
      { error: 'Failed to create project' },
      { status: 500 }
    );
  }
}
