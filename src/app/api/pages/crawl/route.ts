import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db, ensureDb } from '@/db';
import { pageIssues, pageSnapshots, pages } from '@/db/schema';
import { requireRole } from '@/lib/auth';
import { userCanAccessPage, userCanAccessProject } from '@/lib/access';
import { dbNow } from '@/db/utils';
import { crawlPage } from '@/lib/crawler/page-crawler';
import { getConvexClient } from '@/lib/convex/server';
import { api } from '../../../../../convex/_generated/api';
import { logAlertEvent, logAuditEvent } from '@/lib/observability';

function normalizeUrl(input: string): string {
  const url = new URL(input.trim());
  const path = url.pathname.replace(/\/+$/, '') || '/';
  return `${url.origin}${path}${url.search}`;
}

export async function POST(req: NextRequest) {
  await ensureDb();
  const auth = await requireRole('editor');
  if (auth.error) return auth.error;

  try {
    const body = await req.json();
    const pageIdRaw = body.pageId;
    const urlRaw = body.url;
    const projectIdRaw = body.projectId;

    let pageId: number | null = null;
    let projectId: number | null = null;
    let targetUrl: string | null = null;

    if (pageIdRaw !== undefined && pageIdRaw !== null) {
      pageId = Number.parseInt(String(pageIdRaw), 10);
      if (!Number.isFinite(pageId)) {
        return NextResponse.json({ error: 'Invalid pageId' }, { status: 400 });
      }
      if (!(await userCanAccessPage(auth.user, pageId))) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }

      const [existingPage] = await db.select().from(pages).where(eq(pages.id, pageId)).limit(1);
      if (!existingPage) {
        return NextResponse.json({ error: 'Page not found' }, { status: 404 });
      }
      projectId = existingPage.projectId;
      targetUrl = existingPage.url;
    } else {
      projectId = Number.parseInt(String(projectIdRaw ?? ''), 10);
      if (!Number.isFinite(projectId)) {
        return NextResponse.json({ error: 'projectId is required when pageId is missing' }, { status: 400 });
      }
      if (!(await userCanAccessProject(auth.user, projectId))) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
      if (!urlRaw || typeof urlRaw !== 'string') {
        return NextResponse.json({ error: 'url is required when pageId is missing' }, { status: 400 });
      }
      targetUrl = normalizeUrl(urlRaw);

      const [existingByUrl] = await db
        .select()
        .from(pages)
        .where(and(eq(pages.projectId, projectId), eq(pages.url, targetUrl)))
        .limit(1);
      if (existingByUrl) {
        pageId = existingByUrl.id;
      } else {
        const [createdPage] = await db
          .insert(pages)
          .values({ projectId, url: targetUrl, title: null })
          .returning();
        pageId = createdPage.id;
      }
    }

    if (!pageId || !projectId || !targetUrl) {
      return NextResponse.json({ error: 'Could not resolve crawl target' }, { status: 400 });
    }

    const crawl = await crawlPage(targetUrl);

    const [updatedPage] = await db
      .update(pages)
      .set({
        url: crawl.finalUrl,
        title: crawl.title,
        canonicalUrl: crawl.canonicalUrl,
        httpStatus: crawl.httpStatus,
        isIndexable: crawl.isIndexable ? 1 : 0,
        isVerified: crawl.isVerified ? 1 : 0,
        responseTimeMs: crawl.responseTimeMs,
        contentHash: crawl.contentHash,
        lastCrawledAt: dbNow(),
        updatedAt: dbNow(),
      })
      .where(eq(pages.id, pageId))
      .returning();

    const [snapshot] = await db
      .insert(pageSnapshots)
      .values({
        pageId,
        httpStatus: crawl.httpStatus,
        canonicalUrl: crawl.canonicalUrl,
        metaRobots: crawl.metaRobots,
        isIndexable: crawl.isIndexable ? 1 : 0,
        isVerified: crawl.isVerified ? 1 : 0,
        responseTimeMs: crawl.responseTimeMs,
        seoScore: crawl.seoScore,
        issuesCount: crawl.issues.length,
        snapshotData: crawl.snapshotData,
      })
      .returning();

    const openIssues = await db
      .select()
      .from(pageIssues)
      .where(and(eq(pageIssues.pageId, pageId), eq(pageIssues.isOpen, 1)));
    const hadOpenIssues = openIssues.length > 0;

    if (openIssues.length > 0) {
      await db
        .update(pageIssues)
        .set({
          isOpen: 0,
          resolvedAt: dbNow(),
          lastSeenAt: dbNow(),
        })
        .where(and(eq(pageIssues.pageId, pageId), eq(pageIssues.isOpen, 1)));
    }

    for (const issue of crawl.issues) {
      await db.insert(pageIssues).values({
        pageId,
        snapshotId: snapshot.id,
        issueType: issue.issueType,
        severity: issue.severity,
        message: issue.message,
        isOpen: 1,
        metadata: issue.metadata || null,
        firstSeenAt: dbNow(),
        lastSeenAt: dbNow(),
      });
    }

    if (!hadOpenIssues && crawl.issues.length > 0) {
      try {
        const convex = getConvexClient();
        if (convex) {
          await convex.mutation(api.tasks.create, {
            title: `Fix SEO issues: ${crawl.finalUrl}`,
            description: `${crawl.issues.length} crawl issue(s) detected.`,
            type: 'research',
            status: 'BACKLOG',
            priority: crawl.issues.some((i) => i.severity === 'critical' || i.severity === 'high')
              ? 'HIGH'
              : 'MEDIUM',
            projectId,
            tags: ['seo', 'crawler', 'page'],
          });
        }
      } catch (error) {
        await logAlertEvent({
          source: 'crawler',
          eventType: 'mission_control_task_create_failed',
          severity: 'warning',
          message: 'Crawler detected issues but failed to create a Mission Control task.',
          projectId,
          resourceId: pageId,
          metadata: { error: error instanceof Error ? error.message : 'Unknown error' },
        });
      }
    }

    await logAuditEvent({
      userId: auth.user.id,
      action: 'page.crawl',
      resourceType: 'page',
      resourceId: pageId,
      projectId,
      metadata: {
        url: crawl.finalUrl,
        verified: crawl.isVerified,
        indexable: crawl.isIndexable,
        issues: crawl.issues.length,
        seoScore: crawl.seoScore,
      },
    });

    return NextResponse.json({
      success: true,
      page: updatedPage,
      crawl: {
        ...crawl,
        issuesCount: crawl.issues.length,
      },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown crawler error';
    await logAlertEvent({
      source: 'crawler',
      eventType: 'crawl_failed',
      severity: 'error',
      message: 'Crawler run failed.',
      metadata: { error: errorMessage },
    });
    console.error('Crawler error:', error);
    return NextResponse.json({ error: 'Crawler failed', detail: errorMessage }, { status: 500 });
  }
}
