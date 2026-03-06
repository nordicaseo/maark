import { NextRequest, NextResponse } from 'next/server';
import { db, ensureDb } from '@/db';
import { pages } from '@/db/schema';
import { and, desc, eq, sql } from 'drizzle-orm';
import { getRequestedProjectId, getAccessibleProjectIds, isAdminUser, userCanAccessProject } from '@/lib/access';
import { getAuthUser, requireRole } from '@/lib/auth';
import { logAuditEvent } from '@/lib/observability';
import { classifyDiscoveredUrl } from '@/lib/discovery/url-policy';
import { upsertDiscoveryUrl, upsertEligiblePage } from '@/lib/discovery/ledger';

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
      discoverySource: pages.discoverySource,
      eligibilityState: pages.eligibilityState,
      excludeReason: pages.excludeReason,
      normalizedUrl: pages.normalizedUrl,
      lastCrawledAt: pages.lastCrawledAt,
      firstSeenAt: pages.firstSeenAt,
      lastSeenAt: pages.lastSeenAt,
      linkedDocumentCount: sql<number>`(
        SELECT CAST(COUNT(*) AS INTEGER)
        FROM document_page_links
        WHERE document_page_links.page_id = ${pages.id}
      )`,
      createdAt: pages.createdAt,
      updatedAt: pages.updatedAt,
      openIssues: sql<number>`(
        SELECT CAST(COUNT(*) AS INTEGER)
        FROM page_issues
        WHERE page_issues.page_id = ${pages.id}
          AND page_issues.is_open = 1
      )`,
    };

    const basePredicates = [
      eq(pages.eligibilityState, 'eligible'),
      eq(pages.isActive, 1),
      eq(pages.isIndexable, 1),
    ];

    if (isAdminUser(user)) {
      const rows = await db
        .select(selectFields)
        .from(pages)
        .where(
          and(
            ...basePredicates,
            ...(requestedProjectId !== null ? [eq(pages.projectId, requestedProjectId)] : [])
          )
        )
        .orderBy(desc(pages.updatedAt));
      return NextResponse.json(rows);
    }

    const accessibleProjectIds = await getAccessibleProjectIds(user);
    if (requestedProjectId !== null) {
      if (!accessibleProjectIds.includes(requestedProjectId)) {
        return NextResponse.json([]);
      }
      const rows = await db
        .select(selectFields)
        .from(pages)
        .where(and(...basePredicates, eq(pages.projectId, requestedProjectId)))
        .orderBy(desc(pages.updatedAt));
      return NextResponse.json(rows);
    }

    if (accessibleProjectIds.length === 0) {
      return NextResponse.json([]);
    }

    const rows = await db
      .select(selectFields)
      .from(pages)
      .where(
        and(
          ...basePredicates,
          sql`${pages.projectId} IN (${sql.join(accessibleProjectIds.map((id) => sql`${id}`), sql`, `)})`
        )
      )
      .orderBy(desc(pages.updatedAt));
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

    const classified = (() => {
      try {
        return classifyDiscoveredUrl({ rawUrl: body.url });
      } catch {
        return null;
      }
    })();
    if (!classified) {
      return NextResponse.json({ error: 'Invalid url' }, { status: 400 });
    }
    const normalizedUrl = classified.normalizedUrl;

    const discovery = await upsertDiscoveryUrl({
      projectId,
      url: body.url.trim(),
      normalizedUrl,
      source: 'inventory',
      isCandidate: classified.isCandidate,
      excludeReason: classified.excludeReason,
      metadata: {
        trigger: 'manual_add_page',
      },
    });

    if (!classified.isCandidate) {
      await logAuditEvent({
        userId: auth.user.id,
        action: 'page.discovery_excluded',
        resourceType: 'page',
        projectId,
        severity: 'warning',
        metadata: {
          inputUrl: body.url,
          normalizedUrl,
          excludeReason: classified.excludeReason,
          discoveryId: discovery?.id ?? null,
        },
      });

      return NextResponse.json({
        excluded: true,
        reason: classified.excludeReason,
        normalizedUrl,
      }, { status: 202 });
    }

    const created = await upsertEligiblePage({
      projectId,
      url: normalizedUrl,
      normalizedUrl,
      title: body.title || null,
      discoverySource: 'inventory',
    });
    if (!created) {
      return NextResponse.json({ error: 'Failed to store page' }, { status: 500 });
    }

    await logAuditEvent({
      userId: auth.user.id,
      action: 'page.create',
      resourceType: 'page',
      resourceId: created?.id ?? null,
      projectId,
      metadata: { url: created?.url ?? normalizedUrl, normalizedUrl },
    });

    return NextResponse.json(created);
  } catch (error) {
    console.error('Error creating page:', error);
    return NextResponse.json({ error: 'Failed to create page' }, { status: 500 });
  }
}
