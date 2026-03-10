import { NextRequest, NextResponse } from 'next/server';
import { api } from '../../../../../../convex/_generated/api';
import type { Id } from '../../../../../../convex/_generated/dataModel';
import type { TopicStageKey } from '@/lib/content-workflow-taxonomy';
import { TOPIC_STAGE_LABELS } from '@/lib/content-workflow-taxonomy';
import { getConvexClient } from '@/lib/convex/server';
import { isModalAgentCallbackAuthorized } from '@/lib/agents/modal-runtime';
import { logAlertEvent } from '@/lib/observability';

const SUCCESS_STATUSES = new Set(['success', 'complete', 'completed', 'ok']);
const FAILURE_STATUSES = new Set(['failed', 'failure', 'error', 'blocked']);
const RUNNING_STATUSES = new Set(['running', 'working', 'in_progress']);
const QUEUED_STATUSES = new Set(['queued', 'pending', 'accepted']);
const STAGE_KEYS = new Set<TopicStageKey>(
  Object.keys(TOPIC_STAGE_LABELS) as TopicStageKey[]
);

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function readString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeStatus(raw: unknown): string {
  return String(raw || '')
    .trim()
    .toLowerCase();
}

function normalizeStage(raw: unknown, fallback: TopicStageKey): TopicStageKey {
  const stage = String(raw || '')
    .trim()
    .toLowerCase();
  return STAGE_KEYS.has(stage as TopicStageKey)
    ? (stage as TopicStageKey)
    : fallback;
}

function normalizeToStage(raw: unknown): TopicStageKey | null {
  const stage = String(raw || '')
    .trim()
    .toLowerCase();
  if (!stage) return null;
  return STAGE_KEYS.has(stage as TopicStageKey)
    ? (stage as TopicStageKey)
    : null;
}

function normalizeDeliverable(value: unknown): {
  id?: string;
  type: string;
  title: string;
  url?: string;
} | undefined {
  const source = asRecord(value);
  const type = readString(source.type);
  const title = readString(source.title);
  if (!type || !title) return undefined;
  const id = readString(source.id) || undefined;
  const url = readString(source.url) || undefined;
  return { id, type, title, url };
}

export async function POST(req: NextRequest) {
  if (!isModalAgentCallbackAuthorized(req.headers)) {
    return NextResponse.json({ error: 'Unauthorized callback' }, { status: 401 });
  }

  const convex = getConvexClient();
  if (!convex) {
    return NextResponse.json(
      { error: 'Mission Control is not configured (Convex URL missing)' },
      { status: 500 }
    );
  }

  const body = asRecord(await req.json().catch(() => ({})));
  const taskIdRaw = readString(body.taskId);
  const statusRaw = normalizeStatus(body.status);
  if (!taskIdRaw || !statusRaw) {
    return NextResponse.json(
      { error: 'taskId and status are required' },
      { status: 400 }
    );
  }

  const taskId = taskIdRaw as Id<'tasks'>;
  const task = await convex.query(api.tasks.get, { id: taskId }).catch(() => null);
  if (!task) {
    return NextResponse.json({ error: 'Task not found' }, { status: 404 });
  }

  const stage = normalizeStage(body.stage, normalizeStage(task.workflowCurrentStageKey, 'research'));
  const runtimeJobId =
    readString(body.runtimeJobId) ||
    readString(body.modalJobId) ||
    readString(body.jobId);
  const summary =
    readString(body.summary) ||
    `Modal runtime ${statusRaw} for ${stage}.`;

  const payloadMeta = asRecord(body.payload);

  if (QUEUED_STATUSES.has(statusRaw)) {
    await convex.mutation(api.tasks.update, {
      id: taskId,
      expectedProjectId: task.projectId ?? undefined,
      workflowStageStatus: 'queued',
      workflowLastEventAt: Date.now(),
      workflowLastEventText: summary,
    });
    await convex.mutation(api.topicWorkflow.recordStageProgress, {
      taskId,
      stageKey: stage,
      summary,
      actorType: 'system',
      actorId: 'modal-runtime',
      actorName: 'Modal Agent Runtime',
      payload: {
        status: 'queued',
        reasonCode: 'modal_runtime_queued',
        runtimeJobId,
        meta: payloadMeta,
      },
    });
    return NextResponse.json({
      ok: true,
      taskId: taskIdRaw,
      stage,
      status: 'queued',
    });
  }

  if (RUNNING_STATUSES.has(statusRaw)) {
    await convex.mutation(api.tasks.update, {
      id: taskId,
      expectedProjectId: task.projectId ?? undefined,
      workflowStageStatus: 'in_progress',
      workflowLastEventAt: Date.now(),
      workflowLastEventText: summary,
    });
    await convex.mutation(api.topicWorkflow.recordStageProgress, {
      taskId,
      stageKey: stage,
      summary,
      actorType: 'system',
      actorId: 'modal-runtime',
      actorName: 'Modal Agent Runtime',
      payload: {
        status: 'working',
        reasonCode: 'modal_runtime_working',
        runtimeJobId,
        meta: payloadMeta,
      },
    });
    return NextResponse.json({
      ok: true,
      taskId: taskIdRaw,
      stage,
      status: 'working',
    });
  }

  if (FAILURE_STATUSES.has(statusRaw)) {
    const failedSummary = `Modal runtime failed on ${stage}: ${summary}`;
    await convex.mutation(api.tasks.update, {
      id: taskId,
      expectedProjectId: task.projectId ?? undefined,
      workflowStageStatus: 'blocked',
      workflowLastEventAt: Date.now(),
      workflowLastEventText: failedSummary,
    });
    await convex.mutation(api.topicWorkflow.recordStageProgress, {
      taskId,
      stageKey: stage,
      summary: failedSummary,
      actorType: 'system',
      actorId: 'modal-runtime',
      actorName: 'Modal Agent Runtime',
      payload: {
        status: 'blocked',
        reasonCode: 'modal_runtime_failed',
        runtimeJobId,
        meta: payloadMeta,
      },
    });
    await logAlertEvent({
      source: 'modal_agent_runtime',
      eventType: 'stage_failed',
      severity: 'warning',
      projectId: task.projectId ?? null,
      resourceId: taskIdRaw,
      message: failedSummary,
      metadata: {
        taskId: taskIdRaw,
        stage,
        runtimeJobId,
        callbackPayload: body,
      },
    });
    return NextResponse.json({
      ok: true,
      taskId: taskIdRaw,
      stage,
      status: 'blocked',
    });
  }

  if (!SUCCESS_STATUSES.has(statusRaw)) {
    return NextResponse.json(
      { error: `Unsupported callback status: ${statusRaw}` },
      { status: 400 }
    );
  }

  const artifact = asRecord(body.artifact);
  const artifactTitle =
    readString(body.artifactTitle) ||
    readString(artifact.title) ||
    `${stage} output (Modal)`;
  const artifactBody =
    readString(body.artifactBody) ||
    readString(artifact.body) ||
    summary;
  const artifactData = body.artifactData ?? artifact.data ?? payloadMeta;
  const deliverable = normalizeDeliverable(body.deliverable);

  await convex.mutation(api.topicWorkflow.recordStageArtifact, {
    taskId,
    stageKey: stage,
    summary,
    actorType: 'system',
    actorId: 'modal-runtime',
    actorName: readString(body.actorName) || 'Modal Agent Runtime',
    artifact: {
      title: artifactTitle,
      body: artifactBody,
      data: artifactData,
    },
    deliverable,
    payload: {
      status: 'completed',
      reasonCode: 'modal_runtime_completed',
      runtimeJobId,
      meta: payloadMeta,
    },
  });

  const toStage = normalizeToStage(body.toStage);
  if (!toStage || toStage === stage) {
    await convex.mutation(api.tasks.update, {
      id: taskId,
      expectedProjectId: task.projectId ?? undefined,
      workflowStageStatus: 'pending',
      workflowLastEventAt: Date.now(),
      workflowLastEventText: `${summary} Waiting for explicit next-stage transition.`,
    });
    return NextResponse.json({
      ok: true,
      taskId: taskIdRaw,
      stage,
      status: 'completed',
      advanced: false,
    });
  }

  try {
    await convex.mutation(api.topicWorkflow.advanceStage, {
      taskId,
      toStage,
      actorType: 'system',
      actorId: 'modal-runtime',
      actorName: 'Modal Agent Runtime',
      note: summary,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown stage transition error';
    await convex.mutation(api.tasks.update, {
      id: taskId,
      expectedProjectId: task.projectId ?? undefined,
      workflowStageStatus: 'blocked',
      workflowLastEventAt: Date.now(),
      workflowLastEventText: `Modal callback advanceStage failed: ${message}`,
    });
    await convex.mutation(api.topicWorkflow.recordStageProgress, {
      taskId,
      stageKey: stage,
      summary: `Modal callback transition to ${toStage} failed: ${message}`,
      actorType: 'system',
      actorId: 'modal-runtime',
      actorName: 'Modal Agent Runtime',
      payload: {
        status: 'blocked',
        reasonCode: 'modal_runtime_advance_failed',
        toStage,
        runtimeJobId,
      },
    });
    return NextResponse.json(
      { error: `Failed to advance stage to ${toStage}` },
      { status: 409 }
    );
  }

  return NextResponse.json({
    ok: true,
    taskId: taskIdRaw,
    stage,
    status: 'completed',
    advanced: true,
    toStage,
  });
}
