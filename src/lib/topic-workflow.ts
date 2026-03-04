import { api } from '../../convex/_generated/api';
import { getConvexClient } from '@/lib/convex/server';
import { db, ensureDb } from '@/db';
import { documents } from '@/db/schema';
import type { AppUser } from '@/lib/auth';
import { userCanAccessProject } from '@/lib/access';
import type { Doc, Id } from '../../convex/_generated/dataModel';

export type TopicWorkflowEntryPoint =
  | 'mission_control'
  | 'content_engine'
  | 'keywords'
  | 'pages'
  | 'onboarding';

export type TopicStageKey =
  | 'research'
  | 'outline_build'
  | 'outline_review'
  | 'prewrite_context'
  | 'writing'
  | 'final_review'
  | 'complete';

export type TopicApprovalGate = 'outline_human' | 'outline_seo' | 'seo_final';

export interface CreateTopicWorkflowInput {
  user: AppUser;
  projectId: number;
  topic: string;
  entryPoint: TopicWorkflowEntryPoint;
  documentId?: number;
  skillId?: number;
  contentType?: string;
  targetKeyword?: string | null;
  siteId?: number;
  pageId?: number;
  keywordId?: number;
  keywordClusterId?: number;
  options?: {
    outlineReviewOptional?: boolean;
    seoReviewRequired?: boolean;
  };
}

export interface AdvanceTopicWorkflowInput {
  user: AppUser;
  taskId: Id<'tasks'>;
  toStage: TopicStageKey;
  note?: string;
  skipOptionalOutlineReview?: boolean;
}

export interface RecordTopicApprovalInput {
  user: AppUser;
  taskId: Id<'tasks'>;
  gate: TopicApprovalGate;
  approved: boolean;
  note?: string;
}

export async function createTopicWorkflow(input: CreateTopicWorkflowInput) {
  await ensureDb();
  const convex = getConvexClient();
  if (!convex) {
    throw new Error('Mission Control is not configured (Convex URL missing)');
  }

  const created = await convex.mutation(api.topicWorkflow.createTopicFromSource, {
    projectId: input.projectId,
    topic: input.topic,
    entryPoint: input.entryPoint,
    siteId: input.siteId,
    pageId: input.pageId,
    keywordId: input.keywordId,
    keywordClusterId: input.keywordClusterId,
    requestedByUserId: input.user.id,
    documentId: input.documentId,
    skillId: input.skillId,
    options: input.options,
  });

  let contentDocumentId = created.contentDocumentId;
  if (!created.reused && !contentDocumentId) {
    const [doc] = await db
      .insert(documents)
      .values({
        title: input.topic,
        contentType: input.contentType || 'blog_post',
        targetKeyword: input.targetKeyword ?? input.topic,
        projectId: input.projectId,
        authorId: input.user.id,
        content: { type: 'doc', content: [{ type: 'paragraph' }] },
        plainText: '',
        wordCount: 0,
        status: 'draft',
      })
      .returning();
    contentDocumentId = doc.id;

    await convex.mutation(api.tasks.update, {
      id: created.taskId,
      documentId: contentDocumentId,
    });
  }

  return {
    taskId: String(created.taskId),
    workflowStage: created.workflowStage,
    contentDocumentId,
    reused: Boolean(created.reused),
  };
}

export async function getWorkflowTaskForUser(user: AppUser, taskId: Id<'tasks'>) {
  const convex = getConvexClient();
  if (!convex) {
    throw new Error('Mission Control is not configured (Convex URL missing)');
  }

  const task = await convex.query(api.tasks.get, { id: taskId });
  if (!task) {
    throw new Error('Task not found');
  }

  const canAccess = await userCanAccessProject(user, task.projectId ?? null);
  if (!canAccess) {
    throw new Error('Forbidden');
  }

  return { convex, task };
}

export async function advanceTopicWorkflowStage(input: AdvanceTopicWorkflowInput) {
  const { convex } = await getWorkflowTaskForUser(input.user, input.taskId);
  return await convex.mutation(api.topicWorkflow.advanceStage, {
    taskId: input.taskId,
    toStage: input.toStage,
    actorType: 'user',
    actorId: input.user.id,
    actorName: input.user.name || input.user.email,
    note: input.note,
    skipOptionalOutlineReview: input.skipOptionalOutlineReview,
  });
}

export async function recordTopicWorkflowApproval(input: RecordTopicApprovalInput) {
  const { convex } = await getWorkflowTaskForUser(input.user, input.taskId);
  return await convex.mutation(api.topicWorkflow.recordApproval, {
    taskId: input.taskId,
    gate: input.gate,
    approved: input.approved,
    actorType: 'user',
    actorId: input.user.id,
    actorName: input.user.name || input.user.email,
    note: input.note,
  });
}

export async function listTopicWorkflowHistoryForUser(
  user: AppUser,
  taskId: Id<'tasks'>,
  limit?: number,
  cursor?: string
) {
  const { convex } = await getWorkflowTaskForUser(user, taskId);
  return await convex.query(api.topicWorkflow.listWorkflowHistory, {
    taskId,
    limit,
    cursor,
  });
}

export async function getTopicWorkflowContextForUser(
  user: AppUser,
  taskId: Id<'tasks'>
): Promise<{
  task: Doc<'tasks'> | null;
  events: Doc<'taskWorkflowEvents'>[];
}> {
  const { convex } = await getWorkflowTaskForUser(user, taskId);
  const context = await convex.query(api.topicWorkflow.getWorkflowContext, { taskId });
  return {
    task: context.task,
    events: context.events,
  };
}
