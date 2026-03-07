import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db, ensureDb } from '@/db';
import { keywordClusterMembers, keywordClusters, keywords } from '@/db/schema';
import { requireRole } from '@/lib/auth';
import { userCanAccessProject } from '@/lib/access';
import { createTopicWorkflow } from '@/lib/topic-workflow';
import { dbNow } from '@/db/utils';
import { logAuditEvent, logAlertEvent } from '@/lib/observability';
import { getSerpIntelSnapshot } from '@/lib/serp/serp-intel';
import { resolveLaneFromContentType } from '@/lib/content-workflow-taxonomy';

function parseId(value: string): number | null {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await ensureDb();
  const auth = await requireRole('editor');
  if (auth.error) return auth.error;

  const { id } = await params;
  const clusterId = parseId(id);
  if (!clusterId) {
    return NextResponse.json({ error: 'Invalid cluster id' }, { status: 400 });
  }

  try {
    const [cluster] = await db
      .select({
        id: keywordClusters.id,
        projectId: keywordClusters.projectId,
        name: keywordClusters.name,
        mainKeywordId: keywordClusters.mainKeywordId,
        notes: keywordClusters.notes,
      })
      .from(keywordClusters)
      .where(eq(keywordClusters.id, clusterId))
      .limit(1);

    if (!cluster) {
      return NextResponse.json({ error: 'Cluster not found' }, { status: 404 });
    }

    if (!(await userCanAccessProject(auth.user, cluster.projectId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    if (!cluster.mainKeywordId) {
      return NextResponse.json({ error: 'Cluster is missing a main keyword.' }, { status: 400 });
    }

    const [mainKeyword] = await db
      .select({
        id: keywords.id,
        keyword: keywords.keyword,
        targetUrl: keywords.targetUrl,
        ownerId: keywords.ownerId,
      })
      .from(keywords)
      .where(and(eq(keywords.id, cluster.mainKeywordId), eq(keywords.projectId, cluster.projectId)))
      .limit(1);

    if (!mainKeyword) {
      return NextResponse.json({ error: 'Main keyword not found in project scope' }, { status: 404 });
    }

    const memberRows = await db
      .select({
        keywordId: keywordClusterMembers.keywordId,
        role: keywordClusterMembers.role,
        keyword: keywords.keyword,
      })
      .from(keywordClusterMembers)
      .leftJoin(keywords, eq(keywordClusterMembers.keywordId, keywords.id))
      .where(eq(keywordClusterMembers.clusterId, clusterId));

    const secondaryKeywords = memberRows
      .filter((row: (typeof memberRows)[number]) => row.role !== 'primary' && row.keyword)
      .map((row: (typeof memberRows)[number]) => String(row.keyword))
      .slice(0, 10);

    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const taskTopic =
      typeof body.title === 'string' && body.title.trim().length > 0
        ? body.title.trim()
        : `${mainKeyword.keyword}`;
    const contentType =
      typeof body.contentType === 'string' && body.contentType.trim()
        ? body.contentType.trim()
        : 'blog_post';
    const laneKey = resolveLaneFromContentType(contentType);

    let serpWarmStatus: 'cache_hit' | 'fetched' | 'timeout' | 'failed' | 'skipped' = 'skipped';
    if (mainKeyword.keyword && mainKeyword.keyword.trim().length > 0) {
      try {
        const warmup = getSerpIntelSnapshot({
          keyword: mainKeyword.keyword,
          projectId: cluster.projectId,
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
      projectId: cluster.projectId,
      topic: taskTopic,
      entryPoint: 'keywords',
      keywordId: mainKeyword.id,
      keywordClusterId: cluster.id,
      targetKeyword: mainKeyword.keyword,
      contentType,
      laneKey,
      options: {
        outlineReviewOptional: true,
        seoReviewRequired: true,
      },
    });

    await db
      .update(keywords)
      .set({
        status: 'in_progress',
        ownerId: mainKeyword.ownerId || auth.user.id,
        lastTaskId: created.taskId,
        updatedAt: dbNow(),
      })
      .where(eq(keywords.id, mainKeyword.id));

    await db
      .update(keywordClusters)
      .set({ updatedAt: dbNow() })
      .where(eq(keywordClusters.id, cluster.id));

    await logAuditEvent({
      userId: auth.user.id,
      action: 'keyword_cluster.create_task',
      resourceType: 'keyword_cluster',
      resourceId: cluster.id,
      projectId: cluster.projectId,
      metadata: {
        taskId: created.taskId,
        documentId: created.contentDocumentId ?? null,
        reused: created.reused,
        mainKeywordId: mainKeyword.id,
        secondaryKeywords,
        laneKey,
        serpWarmStatus,
      },
    });

    return NextResponse.json({
      success: true,
      taskId: created.taskId,
      documentId: created.contentDocumentId ?? null,
      reused: created.reused,
      clusterId: cluster.id,
      mainKeyword: mainKeyword.keyword,
      secondaryKeywords,
      serpWarmStatus,
    });
  } catch (error) {
    await logAlertEvent({
      source: 'keywords',
      eventType: 'cluster_create_task_failed',
      severity: 'error',
      message: 'Failed to create Mission Control task from keyword cluster',
      resourceId: clusterId,
      metadata: { error: error instanceof Error ? error.message : 'Unknown error' },
    });
    console.error('Error creating keyword cluster task:', error);
    return NextResponse.json({ error: 'Failed to create task from cluster' }, { status: 500 });
  }
}
