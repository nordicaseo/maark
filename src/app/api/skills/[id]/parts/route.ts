import { NextRequest, NextResponse } from 'next/server';
import { db, ensureDb } from '@/db/index';
import { skillParts, skills } from '@/db/schema';
import { eq, asc } from 'drizzle-orm';
import { dbNow } from '@/db/utils';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await ensureDb();
  const { id } = await params;

  try {
    const parts = await db
      .select()
      .from(skillParts)
      .where(eq(skillParts.skillId, parseInt(id, 10)))
      .orderBy(asc(skillParts.sortOrder));

    return NextResponse.json(parts);
  } catch (error) {
    console.error('Error fetching skill parts:', error);
    return NextResponse.json([], { status: 200 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await ensureDb();
  const { id } = await params;
  const skillId = parseInt(id, 10);

  try {
    const body = await req.json();
    const now = dbNow();

    const [part] = await db
      .insert(skillParts)
      .values({
        skillId,
        partType: body.partType || 'custom',
        label: body.label || 'Untitled',
        content: body.content || '',
        sortOrder: body.sortOrder ?? 0,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    // Recompose skill content from parts
    await recomposeSkillContent(skillId);

    return NextResponse.json(part);
  } catch (error) {
    console.error('Error creating skill part:', error);
    return NextResponse.json({ error: 'Failed to create part' }, { status: 500 });
  }
}

// PUT: Bulk update all parts (for reordering + batch save)
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await ensureDb();
  const { id } = await params;
  const skillId = parseInt(id, 10);

  try {
    const { parts } = await req.json() as { parts: Array<{ id: number; label?: string; content?: string; sortOrder?: number; partType?: string }> };
    const now = dbNow();

    for (const part of parts) {
      const updateData: any = { updatedAt: now };
      if (part.label !== undefined) updateData.label = part.label;
      if (part.content !== undefined) updateData.content = part.content;
      if (part.sortOrder !== undefined) updateData.sortOrder = part.sortOrder;
      if (part.partType !== undefined) updateData.partType = part.partType;

      await db
        .update(skillParts)
        .set(updateData)
        .where(eq(skillParts.id, part.id));
    }

    // Recompose skill content from parts
    await recomposeSkillContent(skillId);

    const updated = await db
      .select()
      .from(skillParts)
      .where(eq(skillParts.skillId, skillId))
      .orderBy(asc(skillParts.sortOrder));

    return NextResponse.json(updated);
  } catch (error) {
    console.error('Error bulk updating skill parts:', error);
    return NextResponse.json({ error: 'Failed to update parts' }, { status: 500 });
  }
}

async function recomposeSkillContent(skillId: number) {
  const parts = await db
    .select()
    .from(skillParts)
    .where(eq(skillParts.skillId, skillId))
    .orderBy(asc(skillParts.sortOrder));

  if (parts.length > 0) {
    const composed = parts
      .map((p: any) => `## ${p.label}\n\n${p.content}`)
      .join('\n\n');

    await db
      .update(skills)
      .set({ content: composed, updatedAt: dbNow() })
      .where(eq(skills.id, skillId));
  }
}
