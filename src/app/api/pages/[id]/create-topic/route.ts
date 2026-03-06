import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { requireRole } from '@/lib/auth';
import { userCanAccessPage } from '@/lib/access';
import { db, ensureDb } from '@/db';
import { keywords, pageKeywordMappings, pages } from '@/db/schema';
import { createTopicWorkflow } from '@/lib/topic-workflow';
import { logAuditEvent, logAlertEvent } from '@/lib/observability';
import { linkDocumentToPage, linkTaskToPage } from '@/lib/pages/linking';
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
  const pageId = parseId(id);
  if (!pageId) {
    return NextResponse.json({ error: 'Invalid page id' }, { status: 400 });
  }

  if (!(await userCanAccessPage(auth.user, pageId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const [page] = await db
      .select({
        id: pages.id,
        projectId: pages.projectId,
        url: pages.url,
        title: pages.title,
      })
      .from(pages)
      .where(eq(pages.id, pageId))
      .limit(1);

    if (!page) {
      return NextResponse.json({ error: 'Page not found' }, { status: 404 });
    }

    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const [primaryMapping] = await db
      .select({
        keywordId: pageKeywordMappings.keywordId,
        keyword: keywords.keyword,
      })
      .from(pageKeywordMappings)
      .innerJoin(keywords, eq(keywords.id, pageKeywordMappings.keywordId))
      .where(
        and(
          eq(pageKeywordMappings.projectId, page.projectId),
          eq(pageKeywordMappings.pageId, page.id),
          eq(pageKeywordMappings.mappingType, 'primary')
        )
      )
      .limit(1);

    const topic = typeof body.topic === 'string' && body.topic.trim()
      ? body.topic.trim()
      : page.title || `Content for ${page.url}`;
    const pageType = isPageType(body.pageType) ? body.pageType : DEFAULT_PAGE_TYPE;
    const subtype =
      pageType === 'blog'
        ? (isBlogSubtype(body.subtype) ? body.subtype : DEFAULT_BLOG_SUBTYPE)
        : pageType === 'collection'
          ? (isCollectionSubtype(body.subtype) ? body.subtype : DEFAULT_COLLECTION_SUBTYPE)
          : 'standard';
    const contentType = resolveDefaultContentType(pageType, subtype);

    const mappedPrimaryKeyword = primaryMapping?.keyword ? String(primaryMapping.keyword) : null;
    const explicitTargetKeyword = typeof body.targetKeyword === 'string' && body.targetKeyword.trim()
      ? body.targetKeyword.trim()
      : null;

    const created = await createTopicWorkflow({
      user: auth.user,
      projectId: page.projectId,
      topic,
      entryPoint: 'pages',
      pageId: page.id,
      keywordId: primaryMapping?.keywordId ? Number(primaryMapping.keywordId) : undefined,
      contentType,
      targetKeyword: explicitTargetKeyword || mappedPrimaryKeyword,
      options: {
        outlineReviewOptional: true,
        seoReviewRequired: true,
      },
    });

    if (created.contentDocumentId) {
      await linkDocumentToPage({
        documentId: created.contentDocumentId,
        pageId: page.id,
        relationType: 'primary',
        isPrimary: true,
      });
    }
    await linkTaskToPage({
      taskId: created.taskId,
      projectId: page.projectId,
      pageId: page.id,
      keywordId: primaryMapping?.keywordId ? Number(primaryMapping.keywordId) : null,
      linkType: 'content_topic',
    });

    await logAuditEvent({
      userId: auth.user.id,
      action: 'page.create_topic',
      resourceType: 'page',
      resourceId: page.id,
      projectId: page.projectId,
      metadata: {
        url: page.url,
        topic,
        pageType,
        subtype,
        contentType,
        primaryKeywordId: primaryMapping?.keywordId ? Number(primaryMapping.keywordId) : null,
        primaryKeyword: mappedPrimaryKeyword,
        taskId: created.taskId,
        documentId: created.contentDocumentId ?? null,
        reused: created.reused,
      },
    });

    return NextResponse.json({
      success: true,
      pageId: page.id,
      taskId: created.taskId,
      documentId: created.contentDocumentId ?? null,
      reused: created.reused,
    });
  } catch (error) {
    await logAlertEvent({
      source: 'pages',
      eventType: 'create_topic_failed',
      severity: 'error',
      message: 'Failed to create topic workflow from page',
      resourceId: pageId,
      metadata: { error: error instanceof Error ? error.message : 'Unknown error' },
    });

    console.error('Error creating topic from page:', error);
    return NextResponse.json({ error: 'Failed to create topic' }, { status: 500 });
  }
}
