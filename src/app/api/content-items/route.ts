import { NextRequest, NextResponse } from 'next/server';
import { desc, eq, or, sql } from 'drizzle-orm';
import { db, ensureDb } from '@/db';
import { documents, users } from '@/db/schema';
import { api } from '../../../../convex/_generated/api';
import { getConvexClient } from '@/lib/convex/server';
import { getAuthUser } from '@/lib/auth';
import {
  getAccessibleProjectIds,
  getRequestedProjectId,
  isAdminUser,
  userCanAccessProject,
} from '@/lib/access';
import {
  resolveWorkflowRuntimeState,
  TOPIC_STAGE_LABELS,
  type TopicStageKey,
} from '@/lib/content-workflow-taxonomy';
import type { ContentItemCard } from '@/types/content-item';

type TaskLike = {
  _id: string;
  documentId?: number;
  status: string;
  workflowTemplateKey?: string;
  workflowCurrentStageKey?: string;
  workflowStageStatus?: string;
  workflowLastEventText?: string;
  workflowLastEventAt?: number;
  deliverables?: Array<{
    id: string;
    type: string;
    title: string;
    url?: string;
    createdAt: number;
  }>;
  assigneeId?: string;
  assignedAgentId?: string;
  updatedAt?: number;
};

function parseBooleanParam(value: string | null, defaultValue: boolean): boolean {
  if (value === null) return defaultValue;
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(String(value ?? ''));
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

function getTimeMs(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  const parsed = Date.parse(String(value ?? ''));
  return Number.isNaN(parsed) ? 0 : parsed;
}

function normalizeTask(task: unknown): TaskLike {
  return task as TaskLike;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => typeof item === 'string' && item.trim().length > 0);
}

function getDeliverableReadiness(doc: {
  researchSnapshot: unknown;
  outlineSnapshot: unknown;
  prewriteChecklist: unknown;
}) {
  const research = doc.researchSnapshot && typeof doc.researchSnapshot === 'object'
    ? (doc.researchSnapshot as Record<string, unknown>)
    : null;
  const outline = doc.outlineSnapshot && typeof doc.outlineSnapshot === 'object'
    ? (doc.outlineSnapshot as Record<string, unknown>)
    : null;
  const prewrite = doc.prewriteChecklist && typeof doc.prewriteChecklist === 'object'
    ? (doc.prewriteChecklist as Record<string, unknown>)
    : null;

  const researchReady =
    isNonEmptyString(research?.summary) ||
    toStringArray(research?.facts).length > 0;
  const outlineReady =
    isNonEmptyString(outline?.markdown) ||
    toStringArray(outline?.headings).length > 0;
  const brandContextReady = Boolean(prewrite?.brandContextReady);
  const internalLinksReady = Boolean(prewrite?.internalLinksReady);
  const unresolvedQuestions = Number(prewrite?.unresolvedQuestions ?? 0);
  const prewriteReady =
    brandContextReady &&
    internalLinksReady &&
    Number.isFinite(unresolvedQuestions) &&
    unresolvedQuestions <= 0;

  return {
    researchReady,
    outlineReady,
    prewriteReady,
    writingReady: researchReady && outlineReady && prewriteReady,
  };
}

export async function GET(req: NextRequest) {
  await ensureDb();
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const convex = getConvexClient();
  if (!convex) {
    return NextResponse.json(
      { error: 'Mission Control is not configured (Convex URL missing)' },
      { status: 500 }
    );
  }

  const includeOrphans = parseBooleanParam(
    req.nextUrl.searchParams.get('includeOrphans'),
    false
  );
  const queryProjectIdRaw = req.nextUrl.searchParams.get('projectId');
  const queryProjectId =
    queryProjectIdRaw && queryProjectIdRaw.trim().length > 0
      ? Number.parseInt(queryProjectIdRaw, 10)
      : null;
  const requestedProjectId = Number.isFinite(queryProjectId as number)
    ? (queryProjectId as number)
    : getRequestedProjectId(req);

  try {
    const baseQuery = db
      .select({
        id: documents.id,
        projectId: documents.projectId,
        authorId: documents.authorId,
        authorName: users.name,
        title: documents.title,
        status: documents.status,
        contentType: documents.contentType,
        targetKeyword: documents.targetKeyword,
        wordCount: documents.wordCount,
        aiDetectionScore: documents.aiDetectionScore,
        semanticScore: documents.semanticScore,
        contentQualityScore: documents.contentQualityScore,
        researchSnapshot: documents.researchSnapshot,
        outlineSnapshot: documents.outlineSnapshot,
        prewriteChecklist: documents.prewriteChecklist,
        createdAt: documents.createdAt,
        updatedAt: documents.updatedAt,
      })
      .from(documents)
      .leftJoin(users, eq(documents.authorId, users.id))
      .orderBy(desc(documents.updatedAt));

    let docRows: Array<{
      id: number;
      projectId: number | null;
      authorId: string | null;
      authorName: string | null;
      title: string;
      status: string;
      contentType: string;
      targetKeyword: string | null;
      wordCount: number | null;
      aiDetectionScore: number | null;
      semanticScore: number | null;
      contentQualityScore: number | null;
      researchSnapshot: unknown;
      outlineSnapshot: unknown;
      prewriteChecklist: unknown;
      createdAt: unknown;
      updatedAt: unknown;
    }>;

    if (isAdminUser(user)) {
      if (requestedProjectId !== null) {
        if (!(await userCanAccessProject(user, requestedProjectId))) {
          return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }
        docRows = await baseQuery.where(eq(documents.projectId, requestedProjectId));
      } else {
        docRows = await baseQuery;
      }
    } else {
      const accessibleProjectIds = await getAccessibleProjectIds(user);

      if (requestedProjectId !== null) {
        if (!accessibleProjectIds.includes(requestedProjectId)) {
          return NextResponse.json([]);
        }
        docRows = await baseQuery.where(eq(documents.projectId, requestedProjectId));
      } else if (accessibleProjectIds.length > 0) {
        docRows = await baseQuery.where(
          or(
            sql`${documents.projectId} IN (${sql.join(
              accessibleProjectIds.map((id) => sql`${id}`),
              sql`, `
            )})`,
            eq(documents.authorId, user.id)
          )
        );
      } else {
        docRows = await baseQuery.where(eq(documents.authorId, user.id));
      }
    }

    const projectIds = Array.from(
      new Set(
        docRows
          .map((row) => row.projectId)
          .filter((projectId): projectId is number => Number.isFinite(projectId))
      )
    );

    const taskChunks = await Promise.all(
      projectIds.map((projectId) =>
        convex.query(api.tasks.list, {
          projectId,
          limit: 700,
        })
      )
    );

    const tasksByDocumentId = new Map<number, TaskLike[]>();
    for (const task of taskChunks.flat().map(normalizeTask)) {
      if (!task.documentId) continue;
      const arr = tasksByDocumentId.get(task.documentId) || [];
      arr.push(task);
      tasksByDocumentId.set(task.documentId, arr);
    }

    const items: ContentItemCard[] = [];

    for (const row of docRows) {
      const linkedTasks = (tasksByDocumentId.get(row.id) || []).sort(
        (a, b) =>
          (b.workflowLastEventAt || b.updatedAt || 0) -
          (a.workflowLastEventAt || a.updatedAt || 0)
      );
      const primaryTask =
        linkedTasks.find((task) => task.status !== 'COMPLETED') || linkedTasks[0] || null;

      if (!includeOrphans && !primaryTask) {
        continue;
      }

      const workflowRuntimeState = primaryTask
        ? resolveWorkflowRuntimeState({
            workflowTemplateKey: primaryTask.workflowTemplateKey,
            workflowCurrentStageKey: primaryTask.workflowCurrentStageKey,
            workflowStageStatus: primaryTask.workflowStageStatus,
            status: primaryTask.status,
          })
        : null;

      const stageLabel =
        primaryTask?.workflowCurrentStageKey &&
        Object.prototype.hasOwnProperty.call(
          TOPIC_STAGE_LABELS,
          primaryTask.workflowCurrentStageKey
        )
          ? TOPIC_STAGE_LABELS[primaryTask.workflowCurrentStageKey as TopicStageKey]
          : null;

      items.push({
        id: row.id,
        projectId: row.projectId,
        authorId: row.authorId,
        authorName: row.authorName,
        title: row.title,
        status: row.status as ContentItemCard['status'],
        contentType: row.contentType,
        targetKeyword: row.targetKeyword,
        wordCount: row.wordCount ?? 0,
        aiDetectionScore: row.aiDetectionScore,
        semanticScore: row.semanticScore,
        contentQualityScore: row.contentQualityScore,
        updatedAt: toIso(row.updatedAt),
        createdAt: toIso(row.createdAt),
        task: primaryTask
          ? {
              id: primaryTask._id,
              status: primaryTask.status,
              workflowTemplateKey: primaryTask.workflowTemplateKey,
              workflowCurrentStageKey: primaryTask.workflowCurrentStageKey,
              workflowStageStatus: primaryTask.workflowStageStatus,
              workflowLastEventText: primaryTask.workflowLastEventText,
              workflowLastEventAt: primaryTask.workflowLastEventAt,
              deliverables: primaryTask.deliverables,
              assigneeId: primaryTask.assigneeId,
              assignedAgentId: primaryTask.assignedAgentId,
              updatedAt: primaryTask.updatedAt,
            }
          : null,
        workflowRuntimeState,
        workflowStageLabel: stageLabel,
        deliverableReadiness: getDeliverableReadiness(row),
      });
    }

    items.sort((a, b) => {
      const aTaskTime = a.task?.workflowLastEventAt || a.task?.updatedAt || 0;
      const bTaskTime = b.task?.workflowLastEventAt || b.task?.updatedAt || 0;
      const aTime = Math.max(aTaskTime, getTimeMs(a.updatedAt));
      const bTime = Math.max(bTaskTime, getTimeMs(b.updatedAt));
      return bTime - aTime;
    });

    return NextResponse.json(items);
  } catch (error) {
    console.error('Error fetching content items:', error);
    return NextResponse.json([], { status: 200 });
  }
}

