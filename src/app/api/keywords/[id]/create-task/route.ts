import { NextRequest, NextResponse } from 'next/server';
import { db, ensureDb } from '@/db';
import { keywords, pages } from '@/db/schema';
import { and, eq } from 'drizzle-orm';
import { requireRole } from '@/lib/auth';
import { userCanAccessKeyword } from '@/lib/access';
import { dbNow } from '@/db/utils';
import { logAuditEvent, logAlertEvent } from '@/lib/observability';
import { createTopicWorkflow } from '@/lib/topic-workflow';
import { normalizeUrlForInventory } from '@/lib/discovery/url-policy';
import { linkDocumentToPage, linkTaskToPage } from '@/lib/pages/linking';
import { getSerpIntelSnapshot } from '@/lib/serp/serp-intel';
import {
  DEFAULT_BLOG_SUBTYPE,
  DEFAULT_COLLECTION_SUBTYPE,
  DEFAULT_PAGE_TYPE,
  isBlogSubtype,
  isCollectionSubtype,
  isPageType,
  resolveDefaultContentType,
} from '@/lib/content-workflow-taxonomy';

function parseId(id: string): number | null {
  const n = Number.parseInt(id, 10);
  return Number.isFinite(n) ? n : null;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await ensureDb();
  const auth = await requireRole('editor');
  if (auth.error) return auth.error;

  const { id } = await params;
  const keywordId = parseId(id);
  if (!keywordId) {
    return NextResponse.json({ error: 'Invalid keyword id' }, { status: 400 });
  }
  if (!(await userCanAccessKeyword(auth.user, keywordId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const [keyword] = await db
      .select()
      .from(keywords)
      .where(eq(keywords.id, keywordId))
      .limit(1);

    if (!keyword) {
      return NextResponse.json({ error: 'Keyword not found' }, { status: 404 });
    }

    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const title = typeof body.title === 'string' && body.title.trim()
      ? body.title.trim()
      : keyword.keyword;
    const pageType = isPageType(body.pageType) ? body.pageType : DEFAULT_PAGE_TYPE;
    const subtype =
      pageType === 'blog'
        ? (isBlogSubtype(body.subtype) ? body.subtype : DEFAULT_BLOG_SUBTYPE)
        : pageType === 'collection'
          ? (isCollectionSubtype(body.subtype) ? body.subtype : DEFAULT_COLLECTION_SUBTYPE)
          : 'standard';
    const contentType = resolveDefaultContentType(pageType, subtype);

    let serpWarmStatus: 'cache_hit' | 'fetched' | 'timeout' | 'failed' | 'skipped' = 'skipped';
    if (keyword.keyword && keyword.keyword.trim().length > 0) {
      try {
        const warmup = getSerpIntelSnapshot({
          keyword: keyword.keyword,
          projectId: keyword.projectId,
          preferFresh: false,
        })
          .then(() => 'cache_hit' as const)
          .catch(() => 'failed' as const);
        const timed = new Promise<'timeout'>((resolve) =>
          setTimeout(() => resolve('timeout'), 3500)
        );
        serpWarmStatus = await Promise.race([warmup, timed]);
      } catch {
        serpWarmStatus = 'failed';
      }
    }

    const created = await createTopicWorkflow({
      user: auth.user,
      projectId: keyword.projectId,
      topic: title,
      entryPoint: 'keywords',
      keywordId: keyword.id,
      targetKeyword: keyword.keyword,
      contentType,
      options: {
        outlineReviewOptional: true,
        seoReviewRequired: true,
      },
    });

    let linkedPageId: number | null = null;
    if (keyword.targetUrl) {
      try {
        const normalizedTarget = normalizeUrlForInventory(keyword.targetUrl);
        const [page] = await db
          .select({ id: pages.id })
          .from(pages)
          .where(and(eq(pages.projectId, keyword.projectId), eq(pages.normalizedUrl, normalizedTarget)))
          .limit(1);
        if (page?.id) {
          linkedPageId = page.id;
          await linkTaskToPage({
            taskId: created.taskId,
            projectId: keyword.projectId,
            pageId: page.id,
            keywordId: keyword.id,
            linkType: 'keyword_topic',
          });
          if (created.contentDocumentId) {
            await linkDocumentToPage({
              documentId: created.contentDocumentId,
              pageId: page.id,
              relationType: 'secondary',
              isPrimary: false,
            });
          }
        }
      } catch (error) {
        console.warn('Keyword task link-to-page skipped:', error);
      }
    }

    await db
      .update(keywords)
      .set({
        status: 'in_progress',
        ownerId: keyword.ownerId || auth.user.id,
        lastTaskId: created.taskId,
        updatedAt: dbNow(),
      })
      .where(eq(keywords.id, keywordId));

    await logAuditEvent({
      userId: auth.user.id,
      action: 'keyword.create_task',
      resourceType: 'keyword',
      resourceId: keyword.id,
      projectId: keyword.projectId,
      metadata: {
        taskId: created.taskId,
        documentId: created.contentDocumentId ?? null,
        keyword: keyword.keyword,
        pageType,
        subtype,
        contentType,
        reused: created.reused,
        linkedPageId,
        serpWarmStatus,
      },
    });

    return NextResponse.json({
      success: true,
      keywordId: keyword.id,
      documentId: created.contentDocumentId ?? null,
      taskId: created.taskId,
      reused: created.reused,
      serpWarmStatus,
    });
  } catch (error) {
    await logAlertEvent({
      source: 'keywords',
      eventType: 'create_task_failed',
      severity: 'error',
      message: 'Failed to create Mission Control task from keyword',
      resourceId: keywordId,
      metadata: { error: error instanceof Error ? error.message : 'Unknown error' },
    });
    console.error('Error creating task from keyword:', error);
    return NextResponse.json({ error: 'Failed to create task' }, { status: 500 });
  }
}
