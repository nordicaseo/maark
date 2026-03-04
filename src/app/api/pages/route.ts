import { NextRequest, NextResponse } from 'next/server';
import { db, ensureDb } from '@/db';
import { pages } from '@/db/schema';
import { desc, eq, sql } from 'drizzle-orm';
import { getRequestedProjectId, getAccessibleProjectIds, isAdminUser, userCanAccessProject } from '@/lib/access';
import { getAuthUser, requireRole } from '@/lib/auth';
import { logAuditEvent } from '@/lib/observability';

function normalizeUrl(input: string): string {
  const url = new URL(input.trim());
  const path = url.pathname.replace(/\/+$/, '') || '/';
  return `${url.origin}${path}${url.search}`;
}

export async function GET(req: NextRequest) {
  await ensureDb();
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const requestedProjectId = getRequestedProjectId(req);

  try {
    const selectFields = {
      id: pages.id,
      projectId: pages.projectId,
      url: pages.url,
      title: pages.title,
      canonicalUrl: pages.canonicalUrl,
      httpStatus: pages.httpStatus,
      isIndexable: pages.isIndexable,
      isVerified: pages.isVerified,
      responseTimeMs: pages.responseTimeMs,
      contentHash: pages.contentHash,
      lastCrawledAt: pages.lastCrawledAt,
      createdAt: pages.createdAt,
      updatedAt: pages.updatedAt,
      openIssues: sql<number>`(
        SELECT CAST(COUNT(*) AS INTEGER)
        FROM page_issues
        WHERE page_issues.page_id = ${pages.id}
          AND page_issues.is_open = 1
      )`,
    };

    const base = db.select(selectFields).from(pages).orderBy(desc(pages.updatedAt));

    if (isAdminUser(user)) {
      const rows = requestedProjectId !== null
        ? await base.where(eq(pages.projectId, requestedProjectId))
        : await base;
      return NextResponse.json(rows);
    }

    const accessibleProjectIds = await getAccessibleProjectIds(user);
    if (requestedProjectId !== null) {
      if (!accessibleProjectIds.includes(requestedProjectId)) {
        return NextResponse.json([]);
      }
      return NextResponse.json(await base.where(eq(pages.projectId, requestedProjectId)));
    }

    if (accessibleProjectIds.length === 0) {
      return NextResponse.json([]);
    }

    const rows = await base.where(
      sql`${pages.projectId} IN (${sql.join(accessibleProjectIds.map((id) => sql`${id}`), sql`, `)})`
    );
    return NextResponse.json(rows);
  } catch (error) {
    console.error('Error fetching pages:', error);
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
    if (!body.url || typeof body.url !== 'string') {
      return NextResponse.json({ error: 'url is required' }, { status: 400 });
    }

    const url = normalizeUrl(body.url);

    const [created] = await db
      .insert(pages)
      .values({
        projectId,
        url,
        title: body.title || null,
      })
      .returning();

    await logAuditEvent({
      userId: auth.user.id,
      action: 'page.create',
      resourceType: 'page',
      resourceId: created.id,
      projectId,
      metadata: { url: created.url },
    });

    return NextResponse.json(created);
  } catch (error) {
    console.error('Error creating page:', error);
    return NextResponse.json({ error: 'Failed to create page' }, { status: 500 });
  }
}
