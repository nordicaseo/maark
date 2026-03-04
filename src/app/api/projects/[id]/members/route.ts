import { NextRequest, NextResponse } from 'next/server';
import { db, ensureDb } from '@/db/index';
import { projectMembers, users } from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import { getAuthUser, requireRole } from '@/lib/auth';
import { userCanAccessProject } from '@/lib/access';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await ensureDb();
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;
  const projectId = parseInt(id, 10);
  if (Number.isNaN(projectId)) {
    return NextResponse.json({ error: 'Invalid project id' }, { status: 400 });
  }
  if (!(await userCanAccessProject(user, projectId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const members = await db
      .select({
        id: projectMembers.id,
        projectId: projectMembers.projectId,
        userId: projectMembers.userId,
        role: projectMembers.role,
        createdAt: projectMembers.createdAt,
        userName: users.name,
        userEmail: users.email,
        userRole: users.role,
      })
      .from(projectMembers)
      .innerJoin(users, eq(projectMembers.userId, users.id))
      .where(eq(projectMembers.projectId, projectId));

    return NextResponse.json(members);
  } catch (error) {
    console.error('Error fetching project members:', error);
    return NextResponse.json([], { status: 200 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await ensureDb();
  const auth = await requireRole('admin');
  if (auth.error) return auth.error;
  const { id } = await params;
  const projectId = parseInt(id, 10);
  if (Number.isNaN(projectId)) {
    return NextResponse.json({ error: 'Invalid project id' }, { status: 400 });
  }
  if (!(await userCanAccessProject(auth.user, projectId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const body = await req.json();
    const { userId, role } = body;

    if (!userId) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 });
    }

    const [member] = await db
      .insert(projectMembers)
      .values({
        projectId,
        userId,
        role: role || 'writer',
      })
      .returning();

    return NextResponse.json(member);
  } catch (error) {
    console.error('Error adding project member:', error);
    return NextResponse.json(
      { error: 'Failed to add member' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await ensureDb();
  const auth = await requireRole('admin');
  if (auth.error) return auth.error;
  const { id } = await params;
  const projectId = parseInt(id, 10);
  if (Number.isNaN(projectId)) {
    return NextResponse.json({ error: 'Invalid project id' }, { status: 400 });
  }
  if (!(await userCanAccessProject(auth.user, projectId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const body = await req.json();
    const { userId } = body;

    if (!userId) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 });
    }

    await db
      .delete(projectMembers)
      .where(
        and(
          eq(projectMembers.projectId, projectId),
          eq(projectMembers.userId, userId)
        )
      );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error removing project member:', error);
    return NextResponse.json(
      { error: 'Failed to remove member' },
      { status: 500 }
    );
  }
}
