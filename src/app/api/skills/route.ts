import { NextRequest, NextResponse } from 'next/server';
import { db, ensureDb } from '@/db/index';
import { skills } from '@/db/schema';
import { desc, eq, or, sql } from 'drizzle-orm';
import { dbNow } from '@/db/utils';

export async function GET(req: NextRequest) {
  await ensureDb();
  const projectId = req.nextUrl.searchParams.get('projectId');

  try {
    let results;

    if (projectId) {
      // Return skills that are global OR belong to this project
      results = await db
        .select()
        .from(skills)
        .where(
          or(
            eq(skills.isGlobal, 1),
            eq(skills.projectId, parseInt(projectId, 10))
          )
        )
        .orderBy(desc(skills.updatedAt));
    } else {
      // Return all skills
      results = await db
        .select()
        .from(skills)
        .orderBy(desc(skills.updatedAt));
    }

    return NextResponse.json(results);
  } catch (error) {
    console.error('Error fetching skills:', error);
    return NextResponse.json([], { status: 200 });
  }
}

export async function POST(req: NextRequest) {
  await ensureDb();
  try {
    const body = await req.json();
    const { name, description, content, projectId, isGlobal, createdById } = body;

    if (!name || !content) {
      return NextResponse.json(
        { error: 'Name and content are required' },
        { status: 400 }
      );
    }

    const [skill] = await db
      .insert(skills)
      .values({
        name,
        description: description || null,
        content,
        projectId: projectId ? parseInt(projectId, 10) : null,
        isGlobal: isGlobal ? 1 : 0,
        createdById: createdById || null,
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
