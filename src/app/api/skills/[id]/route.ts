import { NextRequest, NextResponse } from 'next/server';
import { db, ensureDb } from '@/db/index';
import { skills, skillParts } from '@/db/schema';
import { eq, asc } from 'drizzle-orm';
import { dbNow } from '@/db/utils';
import { getAuthUser, requireRole } from '@/lib/auth';
import {
  isAdminUser,
  userCanAccessProject,
  userCanAccessSkill,
} from '@/lib/access';

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
  const skillId = parseInt(id, 10);
  if (Number.isNaN(skillId)) {
    return NextResponse.json({ error: 'Invalid skill id' }, { status: 400 });
  }
  if (!(await userCanAccessSkill(user, skillId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const [skill] = await db
      .select()
      .from(skills)
      .where(eq(skills.id, skillId));

    if (!skill) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const parts = await db
      .select()
      .from(skillParts)
      .where(eq(skillParts.skillId, skillId))
      .orderBy(asc(skillParts.sortOrder));

    return NextResponse.json({ ...skill, parts });
  } catch (error) {
    console.error('Error fetching skill:', error);
    return NextResponse.json({ error: 'Failed to fetch skill' }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await ensureDb();
  const auth = await requireRole('editor');
  if (auth.error) return auth.error;
  const { id } = await params;
  const skillId = parseInt(id, 10);
  if (Number.isNaN(skillId)) {
    return NextResponse.json({ error: 'Invalid skill id' }, { status: 400 });
  }
  if (!(await userCanAccessSkill(auth.user, skillId, { write: true }))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const body = await req.json();

    const updateData: Record<string, unknown> = { updatedAt: dbNow() };
    if (body.name !== undefined) updateData.name = body.name;
    if (body.description !== undefined) updateData.description = body.description;
    if (body.content !== undefined) updateData.content = body.content;
    const parsedProjectId =
      body.projectId !== undefined
        ? (body.projectId ? parseInt(body.projectId, 10) : null)
        : undefined;
    if (parsedProjectId !== undefined) {
      updateData.projectId = parsedProjectId;
      if (!(await userCanAccessProject(auth.user, parsedProjectId))) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    }
    if (body.isGlobal !== undefined) {
      if (body.isGlobal && !isAdminUser(auth.user)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
      updateData.isGlobal = body.isGlobal ? 1 : 0;
    }

    const [skill] = await db
      .update(skills)
      .set(updateData)
      .where(eq(skills.id, skillId))
      .returning();

    if (!skill) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    return NextResponse.json(skill);
  } catch (error) {
    console.error('Error updating skill:', error);
    return NextResponse.json({ error: 'Failed to update skill' }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await ensureDb();
  const auth = await requireRole('editor');
  if (auth.error) return auth.error;
  const { id } = await params;
  const skillId = parseInt(id, 10);
  if (Number.isNaN(skillId)) {
    return NextResponse.json({ error: 'Invalid skill id' }, { status: 400 });
  }
  if (!(await userCanAccessSkill(auth.user, skillId, { write: true }))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    await db.delete(skills).where(eq(skills.id, skillId));
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting skill:', error);
    return NextResponse.json({ error: 'Failed to delete skill' }, { status: 500 });
  }
}
