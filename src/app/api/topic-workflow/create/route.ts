import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { requireRole } from '@/lib/auth';
import {
  userCanAccessDocument,
  userCanAccessKeyword,
  userCanAccessPage,
  userCanAccessProject,
  userCanAccessSkill,
} from '@/lib/access';
import { db, ensureDb } from '@/db';
import { documents, keywords, pages, skills } from '@/db/schema';
import {
  createTopicWorkflow,
  type TopicWorkflowEntryPoint,
} from '@/lib/topic-workflow';
import { isAgentLaneKey, resolveLaneFromContentType } from '@/lib/content-workflow-taxonomy';
import { logAlertEvent, logAuditEvent } from '@/lib/observability';

const ENTRY_POINTS = new Set<TopicWorkflowEntryPoint>([
  'mission_control',
  'content_engine',
  'keywords',
  'pages',
  'onboarding',
]);

function parseOptionalNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const n = Number.parseInt(String(value), 10);
  return Number.isFinite(n) ? n : undefined;
}

export async function POST(req: NextRequest) {
  await ensureDb();
  const auth = await requireRole('writer');
  if (auth.error) return auth.error;

  try {
    const body = await req.json();

    const projectId = parseOptionalNumber(body.projectId);
    const topic = typeof body.topic === 'string' ? body.topic.trim() : '';
    const entryPoint = body.entryPoint as TopicWorkflowEntryPoint;

    if (!projectId) {
      return NextResponse.json({ error: 'projectId is required' }, { status: 400 });
    }
    if (!topic) {
      return NextResponse.json({ error: 'topic is required' }, { status: 400 });
    }
    if (!ENTRY_POINTS.has(entryPoint)) {
      return NextResponse.json({ error: 'Invalid entryPoint' }, { status: 400 });
    }

    if (!(await userCanAccessProject(auth.user, projectId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const documentId = parseOptionalNumber(body.documentId);
    const skillId = parseOptionalNumber(body.skillId);
    const keywordId = parseOptionalNumber(body.keywordId);
    const pageId = parseOptionalNumber(body.pageId);
    const siteId = parseOptionalNumber(body.siteId);
    const keywordClusterId = parseOptionalNumber(body.keywordClusterId);

    if (documentId) {
      if (!(await userCanAccessDocument(auth.user, documentId))) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
      const [doc] = await db
        .select({ id: documents.id, projectId: documents.projectId })
        .from(documents)
        .where(eq(documents.id, documentId))
        .limit(1);
      if (!doc) {
        return NextResponse.json({ error: 'Document not found' }, { status: 404 });
      }
      if (doc.projectId !== projectId) {
        return NextResponse.json({ error: 'Document does not belong to active project' }, { status: 400 });
      }
    }

    if (skillId) {
      if (!(await userCanAccessSkill(auth.user, skillId))) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
      const [skill] = await db
        .select({ id: skills.id, projectId: skills.projectId, isGlobal: skills.isGlobal })
        .from(skills)
        .where(eq(skills.id, skillId))
        .limit(1);
      if (!skill) {
        return NextResponse.json({ error: 'Skill not found' }, { status: 404 });
      }
      if (skill.projectId !== null && skill.projectId !== projectId && skill.isGlobal !== 1) {
        return NextResponse.json({ error: 'Skill does not belong to active project' }, { status: 400 });
      }
    }

    if (keywordId) {
      if (!(await userCanAccessKeyword(auth.user, keywordId))) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
      const [keyword] = await db
        .select({ id: keywords.id, projectId: keywords.projectId })
        .from(keywords)
        .where(eq(keywords.id, keywordId))
        .limit(1);
      if (!keyword) {
        return NextResponse.json({ error: 'Keyword not found' }, { status: 404 });
      }
      if (keyword.projectId !== projectId) {
        return NextResponse.json({ error: 'Keyword does not belong to active project' }, { status: 400 });
      }
    }

    if (pageId) {
      if (!(await userCanAccessPage(auth.user, pageId))) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
      const [page] = await db
        .select({ id: pages.id, projectId: pages.projectId })
        .from(pages)
        .where(eq(pages.id, pageId))
        .limit(1);
      if (!page) {
        return NextResponse.json({ error: 'Page not found' }, { status: 404 });
      }
      if (page.projectId !== projectId) {
        return NextResponse.json({ error: 'Page does not belong to active project' }, { status: 400 });
      }
    }

    const result = await createTopicWorkflow({
      user: auth.user,
      projectId,
      topic,
      entryPoint,
      documentId,
      skillId,
      contentType: typeof body.contentType === 'string' ? body.contentType : undefined,
      contentFormat: typeof body.contentFormat === 'string' ? body.contentFormat : undefined,
      pageType: typeof body.pageType === 'string' ? body.pageType : undefined,
      subtype: typeof body.subtype === 'string' ? body.subtype : undefined,
      laneKey: isAgentLaneKey(body.laneKey)
        ? body.laneKey
        : resolveLaneFromContentType(
            typeof body.contentFormat === 'string'
              ? body.contentFormat
              : typeof body.contentType === 'string'
                ? body.contentType
                : undefined
          ),
      targetKeyword: typeof body.targetKeyword === 'string' ? body.targetKeyword : null,
      siteId,
      pageId,
      keywordId,
      keywordClusterId,
      options: body.options,
    });

    await logAuditEvent({
      userId: auth.user.id,
      action: 'topic_workflow.create',
      resourceType: 'task',
      resourceId: result.taskId,
      projectId,
      metadata: {
        entryPoint,
        topic,
        workflowStage: result.workflowStage,
        laneKey: result.laneKey ?? null,
        taskId: result.taskId,
        contentDocumentId: result.contentDocumentId ?? null,
        reused: result.reused,
      },
    });

    return NextResponse.json(result);
  } catch (error) {
    await logAlertEvent({
      source: 'topic_workflow',
      eventType: 'create_failed',
      severity: 'error',
      message: 'Topic workflow creation failed.',
      metadata: { error: error instanceof Error ? error.message : 'Unknown error' },
    });
    console.error('Topic workflow create failed:', error);
    return NextResponse.json({ error: 'Failed to create topic workflow' }, { status: 500 });
  }
}
