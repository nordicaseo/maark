import { NextRequest, NextResponse } from 'next/server';
import { db, ensureDb } from '@/db/index';
import { projects, projectMembers, skills, documents } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { dbNow } from '@/db/utils';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await ensureDb();
  const { id } = await params;

  try {
    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, parseInt(id, 10)));

    if (!project) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    return NextResponse.json(project);
  } catch (error) {
    console.error('Error fetching project:', error);
    return NextResponse.json({ error: 'Failed to fetch project' }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await ensureDb();
  const { id } = await params;

  try {
    const body = await req.json();

    const updateData: any = { updatedAt: dbNow() };
    if (body.name !== undefined) updateData.name = body.name;
    if (body.description !== undefined) updateData.description = body.description;
    if (body.defaultContentFormat !== undefined) updateData.defaultContentFormat = body.defaultContentFormat;
    if (body.brandVoice !== undefined) updateData.brandVoice = body.brandVoice;
    if (body.settings !== undefined) updateData.settings = body.settings;

    const [project] = await db
      .update(projects)
      .set(updateData)
      .where(eq(projects.id, parseInt(id, 10)))
      .returning();

    if (!project) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    return NextResponse.json(project);
  } catch (error) {
    console.error('Error updating project:', error);
    return NextResponse.json({ error: 'Failed to update project' }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await ensureDb();
  const { id } = await params;
  const projectId = parseInt(id, 10);

  try {
    // Cascade: delete project_members and skills, set null on documents
    await db.delete(projectMembers).where(eq(projectMembers.projectId, projectId));
    await db.delete(skills).where(eq(skills.projectId, projectId));
    await db
      .update(documents)
      .set({ projectId: null })
      .where(eq(documents.projectId, projectId));
    await db.delete(projects).where(eq(projects.id, projectId));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting project:', error);
    return NextResponse.json({ error: 'Failed to delete project' }, { status: 500 });
  }
}
