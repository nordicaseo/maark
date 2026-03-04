import { NextRequest, NextResponse } from 'next/server';
import { db, ensureDb } from '@/db';
import { keywords, users } from '@/db/schema';
import { desc, eq, sql } from 'drizzle-orm';
import { getRequestedProjectId, getAccessibleProjectIds, isAdminUser, userCanAccessProject } from '@/lib/access';
import { requireRole, getAuthUser } from '@/lib/auth';
import { logAuditEvent } from '@/lib/observability';

export async function GET(req: NextRequest) {
  await ensureDb();
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const requestedProjectId = getRequestedProjectId(req);

  try {
    const selectFields = {
      id: keywords.id,
      projectId: keywords.projectId,
      keyword: keywords.keyword,
      intent: keywords.intent,
      status: keywords.status,
      priority: keywords.priority,
      ownerId: keywords.ownerId,
      ownerName: users.name,
      volume: keywords.volume,
      difficulty: keywords.difficulty,
      targetUrl: keywords.targetUrl,
      notes: keywords.notes,
      lastTaskId: keywords.lastTaskId,
      createdAt: keywords.createdAt,
      updatedAt: keywords.updatedAt,
    };

    const base = db
      .select(selectFields)
      .from(keywords)
      .leftJoin(users, eq(keywords.ownerId, users.id))
      .orderBy(desc(keywords.updatedAt));

    if (isAdminUser(user)) {
      const rows = requestedProjectId !== null
        ? await base.where(eq(keywords.projectId, requestedProjectId))
        : await base;
      return NextResponse.json(rows);
    }

    const accessibleProjectIds = await getAccessibleProjectIds(user);
    if (requestedProjectId !== null) {
      if (!accessibleProjectIds.includes(requestedProjectId)) {
        return NextResponse.json([]);
      }
      return NextResponse.json(await base.where(eq(keywords.projectId, requestedProjectId)));
    }

    if (accessibleProjectIds.length === 0) {
      return NextResponse.json([]);
    }

    const rows = await base.where(
      sql`${keywords.projectId} IN (${sql.join(accessibleProjectIds.map((id) => sql`${id}`), sql`, `)})`
    );
    return NextResponse.json(rows);
  } catch (error) {
    console.error('Error fetching keywords:', error);
    return NextResponse.json([], { status: 200 });
  }
}

export async function POST(req: NextRequest) {
  await ensureDb();
  const auth = await requireRole('editor');
  if (auth.error) return auth.error;

  try {
    const body = await req.json();
    const requestedProjectId = getRequestedProjectId(req);
    const projectIdRaw = body.projectId ?? requestedProjectId;
    const projectId = Number.parseInt(String(projectIdRaw ?? ''), 10);

    if (!Number.isFinite(projectId)) {
      return NextResponse.json({ error: 'projectId is required' }, { status: 400 });
    }
    if (!(await userCanAccessProject(auth.user, projectId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (!body.keyword || typeof body.keyword !== 'string' || !body.keyword.trim()) {
      return NextResponse.json({ error: 'keyword is required' }, { status: 400 });
    }

    const [created] = await db
      .insert(keywords)
      .values({
        projectId,
        keyword: body.keyword.trim(),
        intent: body.intent || 'informational',
        status: body.status || 'new',
        priority: body.priority || 'medium',
        ownerId: body.ownerId || null,
        volume: Number.isFinite(body.volume) ? body.volume : null,
        difficulty: Number.isFinite(body.difficulty) ? body.difficulty : null,
        targetUrl: body.targetUrl || null,
        notes: body.notes || null,
      })
      .returning();

    await logAuditEvent({
      userId: auth.user.id,
      action: 'keyword.create',
      resourceType: 'keyword',
      resourceId: created.id,
      projectId,
      metadata: { keyword: created.keyword, intent: created.intent, status: created.status },
    });

    return NextResponse.json(created);
  } catch (error) {
    console.error('Error creating keyword:', error);
    return NextResponse.json({ error: 'Failed to create keyword' }, { status: 500 });
  }
}
