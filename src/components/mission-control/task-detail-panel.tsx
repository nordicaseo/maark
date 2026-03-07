'use client';

import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import NextImage from 'next/image';
import { useMutation, useQuery } from 'convex/react';
import { api } from '../../../convex/_generated/api';
import type { Id } from '../../../convex/_generated/dataModel';
import {
  taskStatusToDocumentStatus,
  SYNC_SOURCE_KEY,
  SYNC_SOURCE_CONVEX,
} from '@/lib/sync/document-task-sync';
import type { Document as SqlDocument } from '@/types/document';
import { useTeamMembers } from './team-members-provider';
import { generateHTML } from '@tiptap/core';
import type { JSONContent } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import TiptapImage from '@tiptap/extension-image';
import Underline from '@tiptap/extension-underline';
import Highlight from '@tiptap/extension-highlight';
import Link from '@tiptap/extension-link';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { useAuth } from '@/components/auth/auth-provider';
import { withProjectScope } from '@/lib/project-context';
import {
  TASK_STATUS_LABELS,
  TASK_STATUS_ORDER,
  TOPIC_STAGES,
  TOPIC_STAGE_LABELS,
  TOPIC_STAGE_NEXT,
  TOPIC_STAGE_OWNERS,
  resolveWorkflowRuntimeState,
  WORKFLOW_RUNTIME_STATE_LABELS,
  WORKFLOW_RUNTIME_STATE_STYLES,
  type TopicStageKey,
} from '@/lib/content-workflow-taxonomy';
import {
  X,
  Play,
  RefreshCw,
  FileText,
  Bot,
  Calendar,
  Tag,
  Eye,
  CheckCircle2,
  Loader2,
  MessageSquare,
  ArrowRight,
  User,
  ChevronDown,
  ChevronUp,
  Send,
  CheckCheck,
} from 'lucide-react';

const PRIORITY_LABELS: Record<string, { label: string; color: string }> = {
  LOW: { label: 'Low', color: 'var(--mc-complete)' },
  MEDIUM: { label: 'Medium', color: 'var(--mc-pending)' },
  HIGH: { label: 'High', color: 'var(--mc-review)' },
  URGENT: { label: 'Urgent', color: 'var(--mc-overdue)' },
};

interface TaskDetailPanelProps {
  taskId: Id<'tasks'> | null;
  onClose: () => void;
  projectId?: number | null;
  readOnly?: boolean;
}

interface AgentRunResult {
  error?: string;
  revisionsApplied?: number;
  wordCount?: number;
  aiDetectionScore?: number | null;
  contentQualityScore?: number | null;
  previewUrl?: string;
}

interface WorkflowEvent {
  _id: Id<'taskWorkflowEvents'>;
  stageKey: string;
  eventType: string;
  actorType: string;
  actorName?: string;
  summary: string;
  payload?: {
    status?: string;
    reason?: string;
    reasonCode?: string;
    configuredSlotKey?: string;
    configuredAgentName?: string;
    configuredWriterStatus?: string;
    repairAttempted?: boolean;
    repairOutcomeCode?: string;
    outlineGap?: {
      expectedHeadings?: number;
      coveredHeadings?: number;
      coverage?: number;
      missingHeadings?: string[];
    };
    diagnostics?: {
      missingHeadings?: string[];
      headingCoverage?: number;
      wordGap?: number;
      abruptEnding?: boolean;
      continuationAttempts?: number;
      configuredSlotKey?: string;
      configuredAgentName?: string;
      configuredWriterStatus?: string;
      repairAttempted?: boolean;
      repairOutcomeCode?: string;
      [key: string]: unknown;
    };
    meta?: {
      stageRole?: string;
      skillNames?: string[];
      model?: {
        providerName?: string;
        model?: string;
      };
    };
    artifact?: {
      title: string;
      body?: string;
      data?: unknown;
    };
    deliverable?: {
      title?: string;
      url?: string;
      type?: string;
    };
    [key: string]: unknown;
  };
  createdAt: number;
}

interface DeliverableDraftState {
  researchSummary: string;
  researchFactsText: string;
  outlineMarkdown: string;
  brandContextReady: boolean;
  internalLinksReady: boolean;
  unresolvedQuestions: number;
}

function toTextList(values: string[] | undefined): string {
  if (!values || values.length === 0) return '';
  return values.join('\n');
}

function parseTextList(value: string): string[] {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

const ROUTED_STAGE_PLAN_ORDER: TopicStageKey[] = [
  'research',
  'seo_intel_review',
  'outline_build',
  'writing',
  'editing',
  'final_review',
];

function parseWorkflowStagePlan(task: {
  workflowStagePlan?: unknown;
}): Array<{
  stage: TopicStageKey;
  slotKey: string | null;
  agentName: string | null;
  agentRole: string | null;
  enabled: boolean;
}> {
  const plan =
    task.workflowStagePlan && typeof task.workflowStagePlan === 'object'
      ? (task.workflowStagePlan as Record<string, unknown>)
      : null;
  const owners =
    plan?.owners && typeof plan.owners === 'object'
      ? (plan.owners as Record<string, unknown>)
      : null;
  if (!owners) return [];

  return ROUTED_STAGE_PLAN_ORDER.map((stage) => {
    const row =
      owners[stage] && typeof owners[stage] === 'object'
        ? (owners[stage] as Record<string, unknown>)
        : null;
    return {
      stage,
      slotKey:
        typeof row?.slotKey === 'string' && row.slotKey.trim().length > 0
          ? row.slotKey.trim()
          : null,
      agentName:
        typeof row?.agentName === 'string' && row.agentName.trim().length > 0
          ? row.agentName.trim()
          : null,
      agentRole:
        typeof row?.agentRole === 'string' && row.agentRole.trim().length > 0
          ? row.agentRole.trim()
          : null,
      enabled:
        row?.enabled === undefined
          ? true
          : row.enabled === true || String(row.enabled).toLowerCase() === 'true',
    };
  });
}

export function TaskDetailPanel({ taskId, onClose, projectId, readOnly = false }: TaskDetailPanelProps) {
  const { user } = useAuth();
  const task = useQuery(
    api.tasks.get,
    taskId ? { id: taskId, projectId: projectId ?? undefined } : 'skip'
  );
  const agents = useQuery(api.agents.list, { limit: 300 });
  const updateTask = useMutation(api.tasks.update);
  const updateAgentStatus = useMutation(api.agents.updateStatus);

  const taskMessages = useQuery(
    api.messages.list,
    taskId ? { taskId, limit: 30 } : 'skip'
  );
  const sendMessage = useMutation(api.messages.send);

  const { members: teamMembers, getMember } = useTeamMembers();
  const [agentRunning, setAgentRunning] = useState(false);
  const [feedbackRunning, setFeedbackRunning] = useState(false);
  const [workflowBusy, setWorkflowBusy] = useState(false);
  const [workflowRunBusy, setWorkflowRunBusy] = useState(false);
  const [workflowRecoverBusy, setWorkflowRecoverBusy] = useState(false);
  const [workflowLoading, setWorkflowLoading] = useState(false);
  const [workflowError, setWorkflowError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<AgentRunResult | null>(null);
  const [messageText, setMessageText] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [workflowEvents, setWorkflowEvents] = useState<WorkflowEvent[]>([]);
  const [timelineExpanded, setTimelineExpanded] = useState(false);
  const [outputsExpanded, setOutputsExpanded] = useState(false);
  const [deliverablesExpanded, setDeliverablesExpanded] = useState(true);
  const [deliverableDraft, setDeliverableDraft] = useState<DeliverableDraftState>({
    researchSummary: '',
    researchFactsText: '',
    outlineMarkdown: '',
    brandContextReady: false,
    internalLinksReady: false,
    unresolvedQuestions: 0,
  });
  const [deliverableDirty, setDeliverableDirty] = useState(false);
  const [deliverableSaving, setDeliverableSaving] = useState(false);
  const [deliverableError, setDeliverableError] = useState<string | null>(null);
  const [deliverableSavedAt, setDeliverableSavedAt] = useState<number | null>(null);

  // ─── Document content preview ──────────────────────────────────
  const [docPreview, setDocPreview] = useState<{
    title: string;
    content: JSONContent | null;
    plainText: string | null;
    wordCount: number;
    status: string;
    contentType: string;
    researchSnapshot?: SqlDocument['researchSnapshot'];
    outlineSnapshot?: SqlDocument['outlineSnapshot'];
    prewriteChecklist?: SqlDocument['prewriteChecklist'];
    agentQuestions?: SqlDocument['agentQuestions'];
  } | null>(null);
  const [docPreviewLoading, setDocPreviewLoading] = useState(false);
  const [previewExpanded, setPreviewExpanded] = useState(true);

  // Extensions for generating HTML from TipTap JSON
  const previewExtensions = useMemo(() => [
    StarterKit.configure({ heading: { levels: [1, 2, 3, 4] } }),
    TiptapImage,
    Underline,
    Highlight.configure({ multicolor: true }),
    Link.configure({ openOnClick: false }),
    Table.configure({ resizable: false }),
    TableRow,
    TableCell,
    TableHeader,
    TaskList,
    TaskItem,
  ], []);

  useEffect(() => {
    if (!task?.documentId) {
      setDocPreview(null);
      return;
    }
    let cancelled = false;
    setDocPreviewLoading(true);
    fetch(`/api/documents/${task.documentId}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((doc) => {
        if (!cancelled && doc) {
          setDocPreview({
            title: doc.title,
            content: doc.content as JSONContent | null,
            plainText: doc.plainText,
            wordCount: doc.wordCount || 0,
            status: doc.status,
            contentType: doc.contentType,
            researchSnapshot: doc.researchSnapshot,
            outlineSnapshot: doc.outlineSnapshot,
            prewriteChecklist: doc.prewriteChecklist,
            agentQuestions: doc.agentQuestions,
          });
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setDocPreviewLoading(false);
      });
    return () => { cancelled = true; };
  }, [task?.documentId, task?.updatedAt]);

  useEffect(() => {
    if (!docPreview) {
      setDeliverableDraft({
        researchSummary: '',
        researchFactsText: '',
        outlineMarkdown: '',
        brandContextReady: false,
        internalLinksReady: false,
        unresolvedQuestions: 0,
      });
      setDeliverableDirty(false);
      return;
    }

    setDeliverableDraft({
      researchSummary: docPreview.researchSnapshot?.summary || '',
      researchFactsText: toTextList(docPreview.researchSnapshot?.facts),
      outlineMarkdown: docPreview.outlineSnapshot?.markdown || '',
      brandContextReady: Boolean(docPreview.prewriteChecklist?.brandContextReady),
      internalLinksReady: Boolean(docPreview.prewriteChecklist?.internalLinksReady),
      unresolvedQuestions: docPreview.prewriteChecklist?.unresolvedQuestions ?? 0,
    });
    setDeliverableDirty(false);
    setDeliverableError(null);
  }, [docPreview, task?.documentId]);

  const refreshWorkflowContext = useCallback(async () => {
    if (!taskId || task?.workflowTemplateKey !== 'topic_production_v1') {
      setWorkflowEvents([]);
      setWorkflowError(null);
      return;
    }

    setWorkflowLoading(true);
    setWorkflowError(null);
    try {
      const res = await fetch(`/api/topic-workflow/context?taskId=${taskId}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to load workflow context');
      }
      const data = await res.json();
      setWorkflowEvents(Array.isArray(data.events) ? data.events : []);
    } catch (err) {
      setWorkflowError((err as Error).message);
    } finally {
      setWorkflowLoading(false);
    }
  }, [taskId, task?.workflowTemplateKey]);

  useEffect(() => {
    void refreshWorkflowContext();
  }, [refreshWorkflowContext, task?.updatedAt]);

  // Generate HTML from TipTap JSON content
  const previewHtml = useMemo(() => {
    if (!docPreview?.content) return null;
    try {
      return generateHTML(docPreview.content, previewExtensions);
    } catch {
      return null;
    }
  }, [docPreview?.content, previewExtensions]);

  // Sync a task status change to the linked Drizzle document (fire-and-forget)
  const syncStatusToDrizzle = useCallback(
    (documentId: number | undefined, taskStatus: string) => {
      if (!documentId) return;
      const docStatus = taskStatusToDocumentStatus(taskStatus);
      fetch(`/api/documents/${documentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: docStatus,
          [SYNC_SOURCE_KEY]: SYNC_SOURCE_CONVEX,
        }),
      }).catch((err) =>
        console.error('Sync task status → Drizzle document failed:', err)
      );
    },
    []
  );

  const patchMissionTask = useCallback(
    async (payload: Record<string, unknown>) => {
      if (!taskId) return;
      const res = await fetch(`/api/mission-control/tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to update task');
      }
    },
    [taskId]
  );

  if (!taskId || !task) return null;

  const isTopicWorkflow = task.workflowTemplateKey === 'topic_production_v1';
  const workflowStage = (task.workflowCurrentStageKey || 'research') as TopicStageKey;
  const workflowApprovals = task.workflowApprovals || {};
  const workflowNextStage = TOPIC_STAGE_NEXT[workflowStage];

  const assignedAgent = agents?.find((a) => a._id === task.assignedAgentId);
  const onlineAgents = agents?.filter((a) => a.status === 'ONLINE') ?? [];
  const priority = PRIORITY_LABELS[task.priority] || PRIORITY_LABELS.MEDIUM;
  const workflowRuntimeState = resolveWorkflowRuntimeState({
    workflowTemplateKey: task.workflowTemplateKey,
    workflowCurrentStageKey: task.workflowCurrentStageKey,
    workflowStageStatus: task.workflowStageStatus,
    status: task.status,
  });
  const workflowRuntimeStyle = workflowRuntimeState
    ? WORKFLOW_RUNTIME_STATE_STYLES[workflowRuntimeState]
    : null;
  const plannedStageOwners = isTopicWorkflow ? parseWorkflowStagePlan(task) : [];
  const visibleWorkflowStages = (() => {
    if (!isTopicWorkflow) {
      return Array.from(TOPIC_STAGES) as TopicStageKey[];
    }
    const stageSet = new Set<TopicStageKey>(['human_review', 'complete', workflowStage]);
    if (plannedStageOwners.length > 0) {
      for (const owner of plannedStageOwners) {
        if (owner.enabled) stageSet.add(owner.stage);
      }
    } else {
      for (const stage of TOPIC_STAGES) stageSet.add(stage);
    }
    return (Array.from(TOPIC_STAGES) as TopicStageKey[]).filter((stage) => stageSet.has(stage));
  })();

  const handleAdvanceWorkflowStage = async (
    toStage: TopicStageKey,
    options?: { skipOptionalOutlineReview?: boolean; note?: string; runAfterAdvance?: boolean }
  ) => {
    if (!isTopicWorkflow || readOnly) return;
    setWorkflowBusy(true);
    setWorkflowError(null);
    try {
      const res = await fetch('/api/topic-workflow/advance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskId: task._id,
          toStage,
          note: options?.note,
          skipOptionalOutlineReview: options?.skipOptionalOutlineReview,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to advance workflow stage');
      }
      if (options?.runAfterAdvance) {
        const runRes = await fetch('/api/topic-workflow/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            taskId: task._id,
            autoContinue: true,
            maxStages: 10,
          }),
        });
        if (!runRes.ok) {
          const err = await runRes.json().catch(() => ({}));
          throw new Error(err.error || 'Advanced stage, but failed to resume workflow');
        }
      }
      await refreshWorkflowContext();
    } catch (err) {
      setWorkflowError((err as Error).message);
    } finally {
      setWorkflowBusy(false);
    }
  };

  const handleWorkflowApproval = async (
    gate: 'outline_human' | 'outline_seo' | 'seo_final',
    approved: boolean
  ) => {
    if (!isTopicWorkflow || readOnly) return;
    setWorkflowBusy(true);
    setWorkflowError(null);
    try {
      const res = await fetch('/api/topic-workflow/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskId: task._id,
          gate,
          approved,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to record approval');
      }
      await refreshWorkflowContext();
    } catch (err) {
      setWorkflowError((err as Error).message);
    } finally {
      setWorkflowBusy(false);
    }
  };

  const handleRunWorkflow = async (autoContinue: boolean) => {
    if (!isTopicWorkflow || readOnly) return;
    setWorkflowRunBusy(true);
    setWorkflowError(null);
    try {
      const res = await fetch('/api/topic-workflow/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            taskId: task._id,
            autoContinue,
            maxStages: autoContinue ? 10 : 1,
          }),
        });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to run workflow stage');
      }
      await refreshWorkflowContext();
    } catch (err) {
      setWorkflowError((err as Error).message);
    } finally {
      setWorkflowRunBusy(false);
    }
  };

  const handleRerunWorkflowFromStage = async (
    fromStage: 'research' | 'outline_build' | 'writing'
  ) => {
    if (!isTopicWorkflow || readOnly) return;
    setWorkflowRecoverBusy(true);
    setWorkflowError(null);
    try {
      const res = await fetch('/api/topic-workflow/rerun', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskId: task._id,
          fromStage,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to recover workflow');
      }
      await refreshWorkflowContext();
    } catch (err) {
      setWorkflowError((err as Error).message);
    } finally {
      setWorkflowRecoverBusy(false);
    }
  };

  const handleSaveDeliverables = async () => {
    if (!task.documentId || readOnly) return;

    setDeliverableSaving(true);
    setDeliverableError(null);
    try {
      const facts = parseTextList(deliverableDraft.researchFactsText);
      const unresolvedQuestions = Number.isFinite(deliverableDraft.unresolvedQuestions)
        ? Math.max(0, Math.floor(deliverableDraft.unresolvedQuestions))
        : 0;
      const now = Date.now();

      const payload = {
        researchSnapshot: {
          ...(docPreview?.researchSnapshot || {}),
          summary: deliverableDraft.researchSummary.trim() || undefined,
          facts: facts.length > 0 ? facts : undefined,
          analyzedAt: docPreview?.researchSnapshot?.analyzedAt || now,
        },
        outlineSnapshot: {
          ...(docPreview?.outlineSnapshot || {}),
          markdown: deliverableDraft.outlineMarkdown.trim() || undefined,
          generatedAt: docPreview?.outlineSnapshot?.generatedAt || now,
        },
        prewriteChecklist: {
          brandContextReady: deliverableDraft.brandContextReady,
          internalLinksReady: deliverableDraft.internalLinksReady,
          unresolvedQuestions,
          completedAt:
            deliverableDraft.brandContextReady &&
            deliverableDraft.internalLinksReady &&
            unresolvedQuestions === 0
              ? now
              : undefined,
        },
      };

      const res = await fetch(`/api/documents/${task.documentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to save deliverables');
      }

      const updated = await res.json();
      setDocPreview((prev) =>
        prev
          ? {
              ...prev,
              researchSnapshot: updated.researchSnapshot ?? null,
              outlineSnapshot: updated.outlineSnapshot ?? null,
              prewriteChecklist: updated.prewriteChecklist ?? null,
            }
          : prev
      );
      setDeliverableDirty(false);
      setDeliverableSavedAt(Date.now());
    } catch (err) {
      setDeliverableError((err as Error).message);
    } finally {
      setDeliverableSaving(false);
    }
  };

  // ─── Start Agent: writes the article ─────────────────────────────
  const handleStartAgent = async () => {
    if (readOnly) return;
    setAgentRunning(true);
    setLastResult(null);

    try {
      // Pick an agent (assigned, or first online)
      let agentId = task.assignedAgentId;
        if (!agentId && onlineAgents.length > 0) {
          agentId = onlineAgents[0]._id;
        await patchMissionTask({ assignedAgentId: agentId });
      }

      // Move task to IN_PROGRESS
      await patchMissionTask({ status: 'IN_PROGRESS' });
      syncStatusToDrizzle(task.documentId, 'IN_PROGRESS');

      // Set agent to WORKING
      if (agentId) {
        await updateAgentStatus({
          id: agentId,
          status: 'WORKING',
          currentTaskId: task._id,
        });
      }

      // Call the agent execute API
      const res = await fetch('/api/agent/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskId: task._id,
          title: task.title,
          description: task.description,
          documentId: task.documentId,
          projectId: task.projectId,
          skillId: task.skillId,
          agentId,
          contentType: 'blog_post',
          targetKeyword: task.title, // Use title as keyword fallback
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Agent execution failed');
      }

      const result = await res.json();
      setLastResult(result);

      // Update task with deliverable and move to IN_REVIEW
      const existingDeliverables = task.deliverables || [];
      await updateTask({
        id: task._id,
        expectedProjectId: task.projectId ?? undefined,
        documentId: result.documentId,
        deliverables: [...existingDeliverables, result.deliverable],
      });
      await patchMissionTask({ status: 'IN_REVIEW' });
      syncStatusToDrizzle(result.documentId || task.documentId, 'IN_REVIEW');

      // Set agent back to ONLINE
      if (agentId) {
        await updateAgentStatus({ id: agentId, status: 'ONLINE' });
      }
    } catch (err) {
      console.error('Agent start error:', err);
      // Revert status on failure
      await patchMissionTask({ status: task.status });
      setLastResult({ error: (err as Error).message });
    } finally {
      setAgentRunning(false);
    }
  };

  // ─── Process Feedback: revises based on comments ─────────────────
  const handleProcessFeedback = async (useResearch: boolean = false) => {
    if (!task.documentId || readOnly) return;
    setFeedbackRunning(true);
    setLastResult(null);

    try {
      // Move back to IN_PROGRESS while processing
      await patchMissionTask({ status: 'IN_PROGRESS' });
      syncStatusToDrizzle(task.documentId, 'IN_PROGRESS');

      const res = await fetch('/api/agent/process-feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskId: task._id,
          documentId: task.documentId,
          useResearch,
          agentId: task.assignedAgentId,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Feedback processing failed');
      }

      const result = await res.json();
      setLastResult(result);

      // Move back to IN_REVIEW
      await patchMissionTask({ status: 'IN_REVIEW' });
      syncStatusToDrizzle(task.documentId, 'IN_REVIEW');
    } catch (err) {
      console.error('Feedback processing error:', err);
      await patchMissionTask({ status: 'IN_REVIEW' });
      setLastResult({ error: (err as Error).message });
    } finally {
      setFeedbackRunning(false);
    }
  };

  // ─── Mark Complete ───────────────────────────────────────────────
  const handleComplete = async () => {
    if (readOnly) return;
    if (isTopicWorkflow) {
      await handleAdvanceWorkflowStage('complete');
      return;
    }
    await patchMissionTask({ status: 'COMPLETED' });
    syncStatusToDrizzle(task.documentId, 'COMPLETED');
  };

  const isProcessing = agentRunning || feedbackRunning;
  const stageArtifacts = workflowEvents.filter(
    (event) => event.eventType === 'stage_artifact' && Boolean(event.payload?.artifact)
  );
  const latestBlockedEvent = workflowEvents.find(
    (event) =>
      event.payload?.status === 'blocked' ||
      event.eventType === 'assignment_blocked'
  );
  const latestQueuedEvent = workflowEvents.find(
    (event) =>
      event.payload?.status === 'queued' ||
      event.eventType === 'assignment_queued'
  );
  const queuedDiagnostics =
    latestQueuedEvent?.payload?.diagnostics &&
    typeof latestQueuedEvent.payload.diagnostics === 'object'
      ? (latestQueuedEvent.payload.diagnostics as Record<string, unknown>)
      : null;
  const queuedConfiguredSlot =
    (typeof latestQueuedEvent?.payload?.configuredSlotKey === 'string' &&
    latestQueuedEvent.payload.configuredSlotKey.trim().length > 0
      ? latestQueuedEvent.payload.configuredSlotKey
      : null) ||
    (typeof queuedDiagnostics?.configuredSlotKey === 'string' &&
    queuedDiagnostics.configuredSlotKey.trim().length > 0
      ? queuedDiagnostics.configuredSlotKey
      : null);
  const queuedConfiguredWriter =
    (typeof latestQueuedEvent?.payload?.configuredAgentName === 'string' &&
    latestQueuedEvent.payload.configuredAgentName.trim().length > 0
      ? latestQueuedEvent.payload.configuredAgentName
      : null) ||
    (typeof queuedDiagnostics?.configuredAgentName === 'string' &&
    queuedDiagnostics.configuredAgentName.trim().length > 0
      ? queuedDiagnostics.configuredAgentName
      : null);
  const queuedWriterStatus =
    (typeof latestQueuedEvent?.payload?.configuredWriterStatus === 'string' &&
    latestQueuedEvent.payload.configuredWriterStatus.trim().length > 0
      ? latestQueuedEvent.payload.configuredWriterStatus
      : null) ||
    (typeof queuedDiagnostics?.configuredWriterStatus === 'string' &&
    queuedDiagnostics.configuredWriterStatus.trim().length > 0
      ? queuedDiagnostics.configuredWriterStatus
      : null);
  const queuedRepairAttempted =
    latestQueuedEvent?.payload?.repairAttempted === true ||
    queuedDiagnostics?.repairAttempted === true;
  const queuedRepairOutcome =
    (typeof latestQueuedEvent?.payload?.repairOutcomeCode === 'string' &&
    latestQueuedEvent.payload.repairOutcomeCode.trim().length > 0
      ? latestQueuedEvent.payload.repairOutcomeCode
      : null) ||
    (typeof queuedDiagnostics?.repairOutcomeCode === 'string' &&
    queuedDiagnostics.repairOutcomeCode.trim().length > 0
      ? queuedDiagnostics.repairOutcomeCode
      : null);
  const queuedReasonCode =
    (typeof latestQueuedEvent?.payload?.reasonCode === 'string' &&
    latestQueuedEvent.payload.reasonCode.trim().length > 0
      ? latestQueuedEvent.payload.reasonCode
      : null) ||
    (typeof latestQueuedEvent?.payload?.reason === 'string' &&
    latestQueuedEvent.payload.reason.trim().length > 0
      ? latestQueuedEvent.payload.reason
      : null);
  const showStartAgent = isTopicWorkflow
    ? false
    : (task.status === 'BACKLOG' || task.status === 'PENDING' || !task.documentId);
  const showProcessFeedback = isTopicWorkflow
    ? workflowStage === 'human_review' && Boolean(task.documentId)
    : task.status === 'IN_REVIEW' && Boolean(task.documentId);
  const showRerun = isTopicWorkflow
    ? workflowStage === 'human_review'
    : task.status === 'IN_REVIEW';
  const showComplete = isTopicWorkflow
    ? workflowStage === 'human_review'
    : task.status === 'IN_REVIEW';
  const workflowRecoveryStage: 'research' | 'outline_build' | 'writing' =
    workflowStage === 'writing' || workflowStage === 'editing' || workflowStage === 'final_review'
      ? 'writing'
    : workflowStage === 'outline_build' ||
          workflowStage === 'outline_review'
        ? 'outline_build'
        : 'research';
  const showWorkflowRecoveryButton =
    isTopicWorkflow &&
    (task.workflowStageStatus === 'blocked' ||
      task.workflowStageStatus === 'queued' ||
      workflowRuntimeState === 'blocked');

  return (
    <div className="fixed inset-y-0 right-0 w-[640px] max-w-full bg-white shadow-xl border-l z-50 flex flex-col"
         style={{ borderColor: 'var(--mc-border)' }}>
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b"
           style={{ borderColor: 'var(--mc-border)' }}>
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full" style={{ background: priority.color }} />
          <span className="mc-header-mono text-xs">{priority.label} Priority</span>
          <span className="text-xs px-2 py-0.5 rounded-full"
                style={{ background: 'var(--mc-overlay)', color: 'var(--mc-text-secondary)' }}>
            {TASK_STATUS_LABELS[task.status as keyof typeof TASK_STATUS_LABELS] || task.status}
          </span>
          {workflowRuntimeState && workflowRuntimeStyle && (
            <span
              className="text-xs px-2 py-0.5 rounded-full border"
              style={{
                background: workflowRuntimeStyle.background,
                color: workflowRuntimeStyle.color,
                borderColor: workflowRuntimeStyle.borderColor,
              }}
            >
              {WORKFLOW_RUNTIME_STATE_LABELS[workflowRuntimeState]}
            </span>
          )}
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-black/5 transition-colors"
        >
          <X className="h-4 w-4" style={{ color: 'var(--mc-text-tertiary)' }} />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        {/* Title & Description */}
        <div>
          <h2 className="text-base font-semibold" style={{ color: 'var(--mc-text-primary)' }}>
            {task.title}
          </h2>
          {task.description && (
            <p className="text-sm mt-1" style={{ color: 'var(--mc-text-secondary)' }}>
              {task.description}
            </p>
          )}
        </div>

        {/* Metadata */}
        <div className="space-y-2">
          {task.documentId && (
            <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--mc-text-secondary)' }}>
              <FileText className="h-3.5 w-3.5" />
              <span>Document #{task.documentId}</span>
              <a
                href={withProjectScope(`/documents/${task.documentId}`, task.projectId)}
                className="underline"
                style={{ color: 'var(--mc-accent)' }}
              >
                Open
              </a>
            </div>
          )}
          {assignedAgent && (
            <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--mc-text-secondary)' }}>
              <Bot className="h-3.5 w-3.5" />
              <span>{assignedAgent.name}</span>
              <span className="mc-status-dot" data-status={assignedAgent.status.toLowerCase()} />
              <span>{assignedAgent.status}</span>
            </div>
          )}
          {task.tags && task.tags.length > 0 && (
            <div className="flex items-center gap-2 text-xs flex-wrap" style={{ color: 'var(--mc-text-secondary)' }}>
              <Tag className="h-3.5 w-3.5 shrink-0" />
              {task.tags.map((t) => (
                <span key={t} className="mc-tag">{t}</span>
              ))}
            </div>
          )}
          {task.dueDate && (
            <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--mc-text-secondary)' }}>
              <Calendar className="h-3.5 w-3.5" />
              <span>{new Date(task.dueDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</span>
            </div>
          )}
        </div>

        {/* Topic Workflow */}
        {isTopicWorkflow && (
          <div className="space-y-2.5">
            <h3 className="mc-header-mono text-xs">Topic Workflow</h3>
            <div className="flex items-center gap-2 flex-wrap text-[10px]">
              {visibleWorkflowStages.map((stage) => (
                <span
                  key={stage}
                  className="px-1.5 py-0.5 rounded"
                  style={{
                    background:
                      stage === workflowStage
                        ? 'var(--mc-accent-soft)'
                        : 'var(--mc-overlay)',
                    color:
                      stage === workflowStage
                        ? 'var(--mc-accent)'
                        : 'var(--mc-text-tertiary)',
                    fontWeight: stage === workflowStage ? 600 : 500,
                  }}
                >
                  {TOPIC_STAGE_LABELS[stage]}
                </span>
              ))}
            </div>
            <p className="text-[10px]" style={{ color: 'var(--mc-text-tertiary)' }}>
              Stage owner: {TOPIC_STAGE_OWNERS[workflowStage]}
            </p>
            {workflowRuntimeState && (
              <p className="text-[10px]" style={{ color: 'var(--mc-text-tertiary)' }}>
                Runtime status: {WORKFLOW_RUNTIME_STATE_LABELS[workflowRuntimeState]}
              </p>
            )}
            {plannedStageOwners.length > 0 && (
              <div className="rounded-md border p-2 space-y-1.5" style={{ borderColor: 'var(--mc-border)' }}>
                <p className="text-[10px] font-medium" style={{ color: 'var(--mc-text-secondary)' }}>
                  Planned stage owners
                </p>
                {plannedStageOwners.map((owner) => (
                  <div key={owner.stage} className="flex items-center justify-between gap-2 text-[10px]">
                    <span style={{ color: 'var(--mc-text-tertiary)' }}>
                      {TOPIC_STAGE_LABELS[owner.stage]}
                    </span>
                    <span style={{ color: owner.enabled ? 'var(--mc-text-secondary)' : '#b45309' }}>
                      {owner.enabled
                        ? owner.agentName || owner.slotKey || 'Unconfigured'
                        : `Disabled (${owner.slotKey || 'no slot'})`}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {task.workflowLastEventText && (
              <p className="text-xs rounded-md px-2 py-1.5" style={{ background: 'var(--mc-overlay)', color: 'var(--mc-text-secondary)' }}>
                {task.workflowLastEventText}
              </p>
            )}
            {(task.workflowStageStatus === 'blocked' || latestBlockedEvent) && (
              <div
                className="rounded-md border px-2 py-1.5 text-xs space-y-1"
                style={{ borderColor: '#fca5a5', background: '#fef2f2', color: '#991b1b' }}
              >
                <p className="font-medium">Stage blocked</p>
                <p>{latestBlockedEvent?.summary || task.workflowLastEventText || 'Workflow is blocked.'}</p>
                {(latestBlockedEvent?.payload?.reason || latestBlockedEvent?.payload?.reasonCode) && (
                  <p className="text-[11px]">
                    Reason: {latestBlockedEvent?.payload?.reason || latestBlockedEvent?.payload?.reasonCode}
                  </p>
                )}
                {latestBlockedEvent?.payload?.outlineGap?.missingHeadings &&
                  latestBlockedEvent.payload.outlineGap.missingHeadings.length > 0 && (
                    <p className="text-[11px]">
                      Missing headings: {latestBlockedEvent.payload.outlineGap.missingHeadings.slice(0, 5).join(', ')}
                    </p>
                  )}
                {(latestBlockedEvent?.payload?.diagnostics?.wordGap ?? 0) > 0 && (
                  <p className="text-[11px]">
                    Word gap: {latestBlockedEvent?.payload?.diagnostics?.wordGap}
                  </p>
                )}
                <button
                  onClick={() => handleRerunWorkflowFromStage(workflowRecoveryStage)}
                  disabled={workflowRecoverBusy || workflowBusy || workflowRunBusy || readOnly}
                  className="mc-btn-secondary text-xs mt-1"
                >
                  {workflowRecoverBusy ? 'Recovering…' : `Recover from ${TOPIC_STAGE_LABELS[workflowRecoveryStage]}`}
                </button>
              </div>
            )}
            {(task.workflowStageStatus === 'queued' || latestQueuedEvent) && (
              <div
                className="rounded-md border px-2 py-1.5 text-xs space-y-1"
                style={{ borderColor: '#fcd34d', background: '#fffbeb', color: '#92400e' }}
              >
                <p className="font-medium">
                  {workflowStage === 'writing' ? 'Writer queue' : 'Stage queue'}
                </p>
                <p>{latestQueuedEvent?.summary || task.workflowLastEventText || 'Waiting for configured owner availability.'}</p>
                {queuedReasonCode && (
                  <p className="text-[11px]">
                    Reason: {queuedReasonCode}
                  </p>
                )}
                {queuedConfiguredSlot && (
                  <p className="text-[11px]">
                    Configured slot: {queuedConfiguredSlot}
                  </p>
                )}
                {queuedConfiguredWriter && (
                  <p className="text-[11px]">
                    Configured writer: {queuedConfiguredWriter}
                    {queuedWriterStatus ? ` (${queuedWriterStatus})` : ''}
                  </p>
                )}
                {queuedRepairAttempted && (
                  <p className="text-[11px]">
                    Last repair attempt: {queuedRepairOutcome || 'attempted'}
                  </p>
                )}
                <p className="text-[11px]">
                  This task will resume automatically when the configured owner is available.
                </p>
                <button
                  onClick={() => handleRerunWorkflowFromStage(workflowRecoveryStage)}
                  disabled={workflowRecoverBusy || workflowBusy || workflowRunBusy || readOnly}
                  className="mc-btn-secondary text-xs mt-1"
                >
                  {workflowRecoverBusy ? 'Recovering…' : `Force Resume from ${TOPIC_STAGE_LABELS[workflowRecoveryStage]}`}
                </button>
              </div>
            )}
            {workflowError && (
              <p className="text-xs text-red-500">{workflowError}</p>
            )}

            <div className="flex items-center gap-2 flex-wrap">
              {workflowStage !== 'complete' && workflowStage !== 'human_review' && (
                <>
                  <button
                    onClick={() => handleRunWorkflow(false)}
                    disabled={workflowRunBusy || workflowBusy || readOnly}
                    className="mc-btn-primary text-xs flex items-center gap-1.5"
                  >
                    {workflowRunBusy ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Play className="h-3 w-3" />
                    )}
                    Run Current Stage
                  </button>
                  <button
                    onClick={() => handleRunWorkflow(true)}
                    disabled={workflowRunBusy || workflowBusy || readOnly}
                    className="mc-btn-secondary text-xs flex items-center gap-1.5"
                  >
                    <RefreshCw className="h-3 w-3" />
                    Run Full Workflow
                  </button>
                </>
              )}
              {workflowNextStage &&
                workflowStage !== 'complete' &&
                workflowStage !== 'human_review' && (
                <button
                  onClick={() => handleAdvanceWorkflowStage(workflowNextStage as TopicStageKey)}
                  disabled={workflowBusy || workflowRunBusy || readOnly}
                  className="mc-btn-secondary text-xs flex items-center gap-1.5"
                >
                  {workflowBusy ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <ArrowRight className="h-3 w-3" />
                  )}
                  Move to {TOPIC_STAGE_LABELS[workflowNextStage as TopicStageKey]}
                </button>
              )}
              {showWorkflowRecoveryButton && (
                <button
                  onClick={() => handleRerunWorkflowFromStage(workflowRecoveryStage)}
                  disabled={workflowRecoverBusy || workflowBusy || workflowRunBusy || readOnly}
                  className="mc-btn-secondary text-xs"
                >
                  {workflowRecoverBusy
                    ? 'Recovering…'
                    : `Recover Workflow from ${TOPIC_STAGE_LABELS[workflowRecoveryStage]}`}
                </button>
              )}
            </div>

            {(workflowStage === 'outline_review' || workflowStage === 'final_review') && (
              <div className="rounded-md border p-2.5 space-y-2" style={{ borderColor: 'var(--mc-border)' }}>
                <p className="text-xs font-medium" style={{ color: 'var(--mc-text-secondary)' }}>
                  Stage Approvals
                </p>
                {workflowStage === 'outline_review' && (
                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      onClick={() => handleWorkflowApproval('outline_human', true)}
                      disabled={workflowBusy || workflowRunBusy || readOnly}
                      className="mc-btn-secondary text-xs flex items-center gap-1.5"
                    >
                      <CheckCheck className="h-3 w-3" />
                      Human approve
                    </button>
                    <button
                      onClick={() => handleWorkflowApproval('outline_seo', true)}
                      disabled={workflowBusy || workflowRunBusy || readOnly}
                      className="mc-btn-secondary text-xs flex items-center gap-1.5"
                    >
                      <CheckCheck className="h-3 w-3" />
                      SEO approve
                    </button>
                    <span className="text-[10px]" style={{ color: 'var(--mc-text-tertiary)' }}>
                      Human: {workflowApprovals.outlineHuman ? 'approved' : 'pending'} · SEO: {workflowApprovals.outlineSeo ? 'approved' : 'pending'}
                    </span>
                  </div>
                )}
                {workflowStage === 'final_review' && (
                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      onClick={() => handleWorkflowApproval('seo_final', true)}
                      disabled={workflowBusy || workflowRunBusy || readOnly}
                      className="mc-btn-secondary text-xs flex items-center gap-1.5"
                    >
                      <CheckCheck className="h-3 w-3" />
                      Final SEO approve
                    </button>
                    <span className="text-[10px]" style={{ color: 'var(--mc-text-tertiary)' }}>
                      Final SEO: {workflowApprovals.seoFinal ? 'approved' : 'pending'}
                    </span>
                  </div>
                )}
              </div>
            )}

            <div className="rounded-md border" style={{ borderColor: 'var(--mc-border)' }}>
              <button
                type="button"
                onClick={() => setTimelineExpanded((prev) => !prev)}
                className="w-full flex items-center justify-between px-2.5 py-2 text-left"
              >
                <p className="text-xs font-medium" style={{ color: 'var(--mc-text-secondary)' }}>
                  Workflow Timeline
                </p>
                {timelineExpanded ? (
                  <ChevronUp className="h-3.5 w-3.5" style={{ color: 'var(--mc-text-tertiary)' }} />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5" style={{ color: 'var(--mc-text-tertiary)' }} />
                )}
              </button>
              {timelineExpanded && (
                <div className="px-2.5 pb-2.5 max-h-44 overflow-y-auto space-y-1.5">
                  {workflowLoading ? (
                    <div className="text-xs flex items-center gap-2" style={{ color: 'var(--mc-text-tertiary)' }}>
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Loading timeline...
                    </div>
                  ) : workflowEvents.length > 0 ? (
                    workflowEvents.map((event) => (
                      <div key={event._id} className="rounded-md px-2 py-1.5 text-xs" style={{ background: 'var(--mc-overlay)' }}>
                        <p style={{ color: 'var(--mc-text-secondary)' }}>{event.summary}</p>
                        {event.payload?.meta && (
                          <p className="text-[10px]" style={{ color: 'var(--mc-text-tertiary)' }}>
                            {event.payload.meta.stageRole ? `Role: ${event.payload.meta.stageRole}` : null}
                            {event.payload.meta.model?.model
                              ? `${event.payload.meta.stageRole ? ' · ' : ''}Model: ${event.payload.meta.model.providerName || 'ai'}/${event.payload.meta.model.model}`
                              : null}
                            {event.payload.meta.skillNames && event.payload.meta.skillNames.length > 0
                              ? `${event.payload.meta.stageRole || event.payload.meta.model?.model ? ' · ' : ''}Skills: ${event.payload.meta.skillNames.join(', ')}`
                              : null}
                          </p>
                        )}
                        {(event.payload?.reason || event.payload?.reasonCode) && (
                          <p className="text-[10px]" style={{ color: '#b91c1c' }}>
                            Reason: {event.payload?.reason || event.payload?.reasonCode}
                          </p>
                        )}
                        {(event.payload?.outlineGap?.missingHeadings &&
                          event.payload.outlineGap.missingHeadings.length > 0) && (
                          <p className="text-[10px]" style={{ color: '#b91c1c' }}>
                            Outline gaps: {event.payload.outlineGap.missingHeadings.slice(0, 4).join(', ')}
                          </p>
                        )}
                        {(event.payload?.diagnostics?.wordGap ?? 0) > 0 && (
                          <p className="text-[10px]" style={{ color: '#b91c1c' }}>
                            Word gap: {event.payload?.diagnostics?.wordGap}
                          </p>
                        )}
                        <p className="text-[10px]" style={{ color: 'var(--mc-text-tertiary)' }}>
                          {event.actorName || event.actorType} · {new Date(event.createdAt).toLocaleString()}
                        </p>
                      </div>
                    ))
                  ) : (
                    <p className="text-xs" style={{ color: 'var(--mc-text-muted)' }}>
                      No workflow events yet.
                    </p>
                  )}
                </div>
              )}
            </div>

            {stageArtifacts.length > 0 && (
              <div className="rounded-md border" style={{ borderColor: 'var(--mc-border)' }}>
                <button
                  type="button"
                  onClick={() => setOutputsExpanded((prev) => !prev)}
                  className="w-full flex items-center justify-between px-2.5 py-2 text-left"
                >
                  <p className="text-xs font-medium" style={{ color: 'var(--mc-text-secondary)' }}>
                    Stage Outputs
                  </p>
                  {outputsExpanded ? (
                    <ChevronUp className="h-3.5 w-3.5" style={{ color: 'var(--mc-text-tertiary)' }} />
                  ) : (
                    <ChevronDown className="h-3.5 w-3.5" style={{ color: 'var(--mc-text-tertiary)' }} />
                  )}
                </button>
                {outputsExpanded && (
                  <div className="px-2.5 pb-2.5">
                    <p className="text-[10px] mb-1.5" style={{ color: 'var(--mc-text-tertiary)' }}>
                      Research/prewrite outputs are also synced to the document Workflow tab in the editor.
                    </p>
                    <div className="max-h-48 overflow-y-auto space-y-2">
                      {stageArtifacts.slice(0, 8).map((event) => {
                        const artifact = event.payload?.artifact;
                        const deliverable = event.payload?.deliverable;
                        if (!artifact) return null;

                        return (
                          <div
                            key={`artifact-${event._id}`}
                            className="rounded-md border p-2 text-xs space-y-1.5"
                            style={{ borderColor: 'var(--mc-border)', background: 'var(--mc-overlay)' }}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <p className="font-medium" style={{ color: 'var(--mc-text-primary)' }}>
                                {artifact.title}
                              </p>
                              <span className="text-[10px]" style={{ color: 'var(--mc-text-muted)' }}>
                                {TOPIC_STAGE_LABELS[event.stageKey as TopicStageKey] || event.stageKey}
                              </span>
                            </div>
                            {(event.payload?.meta?.stageRole ||
                              event.payload?.meta?.model?.model ||
                              (event.payload?.meta?.skillNames && event.payload.meta.skillNames.length > 0)) && (
                              <p className="text-[10px]" style={{ color: 'var(--mc-text-tertiary)' }}>
                                {event.payload?.meta?.stageRole ? `Role: ${event.payload.meta.stageRole}` : null}
                                {event.payload?.meta?.model?.model
                                  ? `${event.payload?.meta?.stageRole ? ' · ' : ''}Model: ${event.payload.meta.model.providerName || 'ai'}/${event.payload.meta.model.model}`
                                  : null}
                                {event.payload?.meta?.skillNames && event.payload.meta.skillNames.length > 0
                                  ? `${event.payload?.meta?.stageRole || event.payload?.meta?.model?.model ? ' · ' : ''}Skills: ${event.payload.meta.skillNames.join(', ')}`
                                  : null}
                              </p>
                            )}
                            {artifact.body && (
                              <pre
                                className="whitespace-pre-wrap text-[11px] leading-4 max-h-28 overflow-y-auto"
                                style={{ color: 'var(--mc-text-secondary)' }}
                              >
                                {artifact.body}
                              </pre>
                            )}
                            {task.documentId && (
                              <a
                                href={withProjectScope(`/documents/${task.documentId}`, task.projectId)}
                                className="inline-flex items-center gap-1 underline"
                                style={{ color: 'var(--mc-accent)' }}
                              >
                                <FileText className="h-3 w-3" />
                                Open in Editor Workflow Tab
                              </a>
                            )}
                            {deliverable?.url ? (
                              <a
                                href={deliverable.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 underline"
                                style={{ color: 'var(--mc-accent)' }}
                              >
                                <Eye className="h-3 w-3" />
                                {deliverable.title || 'Open deliverable'}
                              </a>
                            ) : (
                              deliverable?.title && (
                                <p style={{ color: 'var(--mc-text-tertiary)' }}>
                                  Deliverable: {deliverable.title}
                                </p>
                              )
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Assignee */}
        <div>
          <h3 className="mc-header-mono text-xs mb-2">Assignee</h3>
          <select
            value={task.assigneeId || ''}
            onChange={async (e) => {
              const newAssignee = e.target.value || undefined;
              await updateTask({
                id: task._id,
                expectedProjectId: task.projectId ?? undefined,
                assigneeId: newAssignee,
              });
            }}
            className="w-full text-xs py-1.5 px-2 rounded-md border bg-white"
            style={{ borderColor: 'var(--mc-border)', color: 'var(--mc-text-primary)' }}
          >
            <option value="">Unassigned</option>
            {teamMembers.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name || m.email}
              </option>
            ))}
          </select>
          {task.assigneeId && (() => {
            const member = getMember(task.assigneeId);
            if (!member) return null;
            return (
              <div className="flex items-center gap-2 mt-1.5 text-xs" style={{ color: 'var(--mc-text-secondary)' }}>
                {member.image ? (
                  <NextImage
                    src={member.image}
                    alt={member.name || ''}
                    width={20}
                    height={20}
                    unoptimized
                    className="h-5 w-5 rounded-full"
                  />
                ) : (
                  <div className="h-5 w-5 rounded-full bg-gray-200 flex items-center justify-center text-[10px] font-medium">
                    {(member.name || member.email).charAt(0).toUpperCase()}
                  </div>
                )}
                <span>{member.name || member.email}</span>
              </div>
            );
          })()}
        </div>

        {/* Deliverables */}
        {task.deliverables && task.deliverables.length > 0 && (
          <div>
            <h3 className="mc-header-mono text-xs mb-2">Deliverables</h3>
            <div className="space-y-1.5">
              {task.deliverables.map((d) => (
                d.url ? (
                  <a
                    key={d.id}
                    href={d.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 text-xs p-2 rounded-md"
                    style={{
                      background: 'var(--mc-accent-soft)',
                      color: 'var(--mc-accent)',
                    }}
                  >
                    <Eye className="h-3.5 w-3.5" />
                    {d.title}
                  </a>
                ) : (
                  <div
                    key={d.id}
                    className="flex items-center gap-2 text-xs p-2 rounded-md"
                    style={{
                      background: 'var(--mc-overlay)',
                      color: 'var(--mc-text-secondary)',
                    }}
                  >
                    <FileText className="h-3.5 w-3.5" />
                    {d.title}
                  </div>
                )
              ))}
            </div>
          </div>
        )}

        {/* Document Content Preview */}
        {task.documentId && (
          <div>
            <button
              onClick={() => setPreviewExpanded(!previewExpanded)}
              className="flex items-center justify-between w-full mb-2"
            >
              <h3 className="mc-header-mono text-xs">Content Preview</h3>
              {previewExpanded ? (
                <ChevronUp className="h-3.5 w-3.5" style={{ color: 'var(--mc-text-tertiary)' }} />
              ) : (
                <ChevronDown className="h-3.5 w-3.5" style={{ color: 'var(--mc-text-tertiary)' }} />
              )}
            </button>
            {previewExpanded && (
              <div
                className="rounded-md border overflow-hidden"
                style={{ borderColor: 'var(--mc-border)' }}
              >
                {docPreviewLoading ? (
                  <div className="flex items-center justify-center h-32">
                    <Loader2 className="h-4 w-4 animate-spin" style={{ color: 'var(--mc-text-tertiary)' }} />
                  </div>
                ) : (previewHtml || docPreview?.plainText) ? (
                  <>
                    <div
                      className="flex items-center justify-between px-3 py-2 border-b text-xs"
                      style={{
                        background: 'var(--mc-surface-alt)',
                        borderColor: 'var(--mc-border)',
                        color: 'var(--mc-text-secondary)',
                      }}
                    >
                      <span className="font-medium truncate" style={{ color: 'var(--mc-text-primary)' }}>
                        {docPreview?.title}
                      </span>
                      <span className="shrink-0 ml-2">
                        {docPreview?.wordCount.toLocaleString()} words
                      </span>
                    </div>
                    {previewHtml ? (
                      <div
                        className="mc-content-preview px-3 py-2 overflow-y-auto max-h-80"
                        dangerouslySetInnerHTML={{ __html: previewHtml }}
                      />
                    ) : (
                      <div
                        className="px-3 py-2 text-xs leading-relaxed overflow-y-auto max-h-80 whitespace-pre-wrap"
                        style={{ color: 'var(--mc-text-secondary)' }}
                      >
                        {docPreview!.plainText!.length > 3000
                          ? docPreview!.plainText!.slice(0, 3000) + '\n\n… (truncated)'
                          : docPreview!.plainText}
                      </div>
                    )}
                  </>
                ) : (
                  <div className="flex items-center justify-center h-20">
                    <p className="text-xs" style={{ color: 'var(--mc-text-muted)' }}>
                      No content yet
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Deliverables Review */}
        {task.documentId && docPreview && (
          <div className="rounded-md border" style={{ borderColor: 'var(--mc-border)' }}>
            <button
              type="button"
              onClick={() => setDeliverablesExpanded((prev) => !prev)}
              className="w-full flex items-center justify-between px-2.5 py-2 text-left"
            >
              <div>
                <h3 className="mc-header-mono text-xs">Deliverables Review</h3>
                <p className="text-[10px]" style={{ color: 'var(--mc-text-tertiary)' }}>
                  Review and update research/outline before writing.
                </p>
              </div>
              {deliverablesExpanded ? (
                <ChevronUp className="h-3.5 w-3.5" style={{ color: 'var(--mc-text-tertiary)' }} />
              ) : (
                <ChevronDown className="h-3.5 w-3.5" style={{ color: 'var(--mc-text-tertiary)' }} />
              )}
            </button>
            {deliverablesExpanded && (
              <div className="px-2.5 pb-2.5 space-y-2.5 text-xs">
                <div className="space-y-1">
                  <p className="font-medium" style={{ color: 'var(--mc-text-secondary)' }}>
                    Research summary
                  </p>
                  <textarea
                    value={deliverableDraft.researchSummary}
                    onChange={(e) => {
                      setDeliverableDraft((prev) => ({ ...prev, researchSummary: e.target.value }));
                      setDeliverableDirty(true);
                    }}
                    disabled={readOnly}
                    rows={4}
                    className="w-full rounded-md border bg-white px-2 py-1.5 text-xs"
                    style={{ borderColor: 'var(--mc-border)', color: 'var(--mc-text-primary)' }}
                    placeholder="Summarize the research direction and key findings..."
                  />
                </div>

                <div className="space-y-1">
                  <p className="font-medium" style={{ color: 'var(--mc-text-secondary)' }}>
                    Research facts (one per line)
                  </p>
                  <textarea
                    value={deliverableDraft.researchFactsText}
                    onChange={(e) => {
                      setDeliverableDraft((prev) => ({ ...prev, researchFactsText: e.target.value }));
                      setDeliverableDirty(true);
                    }}
                    disabled={readOnly}
                    rows={5}
                    className="w-full rounded-md border bg-white px-2 py-1.5 text-xs"
                    style={{ borderColor: 'var(--mc-border)', color: 'var(--mc-text-primary)' }}
                    placeholder="Add key facts for writing guidance..."
                  />
                </div>

                <div className="space-y-1">
                  <p className="font-medium" style={{ color: 'var(--mc-text-secondary)' }}>
                    Outline
                  </p>
                  <textarea
                    value={deliverableDraft.outlineMarkdown}
                    onChange={(e) => {
                      setDeliverableDraft((prev) => ({ ...prev, outlineMarkdown: e.target.value }));
                      setDeliverableDirty(true);
                    }}
                    disabled={readOnly}
                    rows={8}
                    className="w-full rounded-md border bg-white px-2 py-1.5 text-xs font-mono"
                    style={{ borderColor: 'var(--mc-border)', color: 'var(--mc-text-primary)' }}
                    placeholder="Use markdown headings for final structure..."
                  />
                </div>

                <div className="rounded-md border p-2 space-y-1.5" style={{ borderColor: 'var(--mc-border)' }}>
                  <p className="font-medium" style={{ color: 'var(--mc-text-secondary)' }}>
                    Prewrite checklist
                  </p>
                  <label className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={deliverableDraft.brandContextReady}
                      onChange={(e) => {
                        setDeliverableDraft((prev) => ({
                          ...prev,
                          brandContextReady: e.target.checked,
                        }));
                        setDeliverableDirty(true);
                      }}
                      disabled={readOnly}
                    />
                    <span>Brand context ready</span>
                  </label>
                  <label className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={deliverableDraft.internalLinksReady}
                      onChange={(e) => {
                        setDeliverableDraft((prev) => ({
                          ...prev,
                          internalLinksReady: e.target.checked,
                        }));
                        setDeliverableDirty(true);
                      }}
                      disabled={readOnly}
                    />
                    <span>Internal links prepared</span>
                  </label>
                  <div className="flex items-center gap-2">
                    <span>Unresolved questions</span>
                    <input
                      type="number"
                      min={0}
                      value={deliverableDraft.unresolvedQuestions}
                      onChange={(e) => {
                        const next = Number.parseInt(e.target.value || '0', 10);
                        setDeliverableDraft((prev) => ({
                          ...prev,
                          unresolvedQuestions: Number.isNaN(next) ? 0 : Math.max(0, next),
                        }));
                        setDeliverableDirty(true);
                      }}
                      disabled={readOnly}
                      className="w-20 rounded border px-1.5 py-1 text-xs"
                      style={{ borderColor: 'var(--mc-border)', color: 'var(--mc-text-primary)' }}
                    />
                  </div>
                </div>

                {docPreview.agentQuestions && docPreview.agentQuestions.length > 0 && (
                  <div className="rounded-md border p-2" style={{ borderColor: 'var(--mc-border)' }}>
                    <p className="font-medium mb-1" style={{ color: 'var(--mc-text-secondary)' }}>
                      Agent questions
                    </p>
                    <div className="space-y-1">
                      {docPreview.agentQuestions.slice(0, 6).map((q) => (
                        <p key={q.id} style={{ color: 'var(--mc-text-tertiary)' }}>
                          • {q.question} ({q.status})
                        </p>
                      ))}
                    </div>
                  </div>
                )}

                {docPreview.researchSnapshot?.sources && docPreview.researchSnapshot.sources.length > 0 && (
                  <div className="rounded-md border p-2" style={{ borderColor: 'var(--mc-border)' }}>
                    <p className="font-medium mb-1" style={{ color: 'var(--mc-text-secondary)' }}>
                      Research sources
                    </p>
                    <div className="space-y-0.5">
                      {docPreview.researchSnapshot.sources.slice(0, 5).map((source, idx) => (
                        <a
                          key={`${source.url}-${idx}`}
                          href={source.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block underline truncate"
                          style={{ color: 'var(--mc-accent)' }}
                        >
                          {source.title || source.url}
                        </a>
                      ))}
                    </div>
                  </div>
                )}

                {deliverableError && (
                  <p className="text-xs text-red-600">{deliverableError}</p>
                )}

                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={handleSaveDeliverables}
                    disabled={readOnly || !deliverableDirty || deliverableSaving}
                    className="mc-btn-secondary text-xs"
                  >
                    {deliverableSaving ? 'Saving…' : 'Save deliverables'}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRerunWorkflowFromStage('outline_build')}
                    disabled={readOnly || workflowRecoverBusy || workflowBusy || workflowRunBusy}
                    className="mc-btn-secondary text-xs"
                  >
                    Regenerate from outline
                  </button>
                  {workflowStage === 'human_review' && (
                    <span className="text-[11px]" style={{ color: 'var(--mc-text-tertiary)' }}>
                      Review deliverables and draft, then approve to complete.
                    </span>
                  )}
                  {deliverableSavedAt && (
                    <span className="text-[11px]" style={{ color: 'var(--mc-text-muted)' }}>
                      Saved {new Date(deliverableSavedAt).toLocaleTimeString()}
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Agent Actions */}
        <div className="space-y-2">
          <h3 className="mc-header-mono text-xs">Agent Actions</h3>

          {/* Start Agent — available for BACKLOG, PENDING, or if no content yet */}
          {showStartAgent && (
            <button
              onClick={handleStartAgent}
              disabled={isProcessing || readOnly}
              className="mc-btn-primary w-full flex items-center justify-center gap-2"
            >
              {agentRunning ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Play className="h-4 w-4" />
              )}
              {agentRunning ? 'Agent Working...' : 'Start Agent'}
            </button>
          )}

          {/* Process Feedback — available when IN_REVIEW with a document */}
          {showProcessFeedback && (
            <div className="space-y-1.5">
              <button
                onClick={() => handleProcessFeedback(false)}
                disabled={isProcessing || readOnly}
                className="mc-btn-secondary w-full flex items-center justify-center gap-2"
              >
                {feedbackRunning ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
                {feedbackRunning ? 'Processing...' : 'Process Review Comments'}
              </button>
              <button
                onClick={() => handleProcessFeedback(true)}
                disabled={isProcessing || readOnly}
                className="mc-btn-secondary w-full flex items-center justify-center gap-2 text-xs"
              >
                <MessageSquare className="h-3.5 w-3.5" />
                Process with Research
              </button>
            </div>
          )}

          {/* Re-run Agent — available when IN_REVIEW to regenerate */}
          {showRerun && (
            <button
              onClick={handleStartAgent}
              disabled={isProcessing || readOnly}
              className="mc-btn-secondary w-full flex items-center justify-center gap-2 text-xs"
            >
              <Play className="h-3.5 w-3.5" />
              Re-run Agent (Full Rewrite)
            </button>
          )}

          {/* Mark Complete — available when IN_REVIEW */}
          {showComplete && (
            <button
              onClick={handleComplete}
              disabled={isProcessing || readOnly}
              className="w-full flex items-center justify-center gap-2 text-xs py-2 px-3 rounded-md border transition-colors hover:bg-green-50"
              style={{
                borderColor: 'var(--mc-complete)',
                color: 'var(--mc-complete)',
              }}
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              Approve &amp; Complete
            </button>
          )}
        </div>

        {/* Last Result */}
        {lastResult && (
          <div className="rounded-md p-3 text-xs space-y-1"
               style={{
                 background: lastResult.error ? '#FEF2F2' : 'var(--mc-accent-soft)',
                 color: lastResult.error ? '#991B1B' : 'var(--mc-text-secondary)',
               }}>
            {lastResult.error ? (
              <p>Error: {lastResult.error}</p>
            ) : (
              <>
                <p className="font-medium" style={{ color: 'var(--mc-text-primary)' }}>
                  {lastResult.revisionsApplied !== undefined
                    ? `${lastResult.revisionsApplied} revision(s) applied`
                    : 'Article generated'}
                </p>
                {lastResult.wordCount && <p>Words: {lastResult.wordCount}</p>}
                {lastResult.aiDetectionScore != null && (
                  <p>AI Detection: {Math.round(lastResult.aiDetectionScore)}%</p>
                )}
                {lastResult.contentQualityScore != null && (
                  <p>Quality: {Math.round(lastResult.contentQualityScore)}%</p>
                )}
                {lastResult.previewUrl && (
                  <a
                    href={lastResult.previewUrl}
                    target="_blank"
                    rel="noopener"
                    className="flex items-center gap-1 mt-1 underline"
                    style={{ color: 'var(--mc-accent)' }}
                  >
                    <Eye className="h-3 w-3" />
                    Open Preview
                    <ArrowRight className="h-3 w-3" />
                  </a>
                )}
              </>
            )}
          </div>
        )}

        {/* Status/Workflow Diagram */}
        <div className="pt-2 border-t" style={{ borderColor: 'var(--mc-border)' }}>
          <h3 className="mc-header-mono text-xs mb-2">
            {isTopicWorkflow ? 'Workflow Flow' : 'Status Flow'}
          </h3>
          <div className="flex items-center gap-1 text-[10px] flex-wrap"
               style={{ color: 'var(--mc-text-tertiary)' }}>
            {isTopicWorkflow
              ? visibleWorkflowStages.map((stage, i) => (
                  <span key={stage} className="flex items-center gap-1">
                    <span
                      className="px-1.5 py-0.5 rounded"
                      style={{
                        background:
                          stage === workflowStage ? 'var(--mc-accent-soft)' : 'var(--mc-overlay)',
                        color:
                          stage === workflowStage ? 'var(--mc-accent)' : 'var(--mc-text-tertiary)',
                        fontWeight: stage === workflowStage ? 600 : 400,
                      }}
                    >
                      {TOPIC_STAGE_LABELS[stage]}
                    </span>
                    {i < visibleWorkflowStages.length - 1 && <ArrowRight className="h-3 w-3" />}
                  </span>
                ))
              : TASK_STATUS_ORDER.map((s, i) => (
                  <span key={s} className="flex items-center gap-1">
                    <span
                      className="px-1.5 py-0.5 rounded"
                      style={{
                        background: s === task.status ? 'var(--mc-accent-soft)' : 'var(--mc-overlay)',
                        color: s === task.status ? 'var(--mc-accent)' : 'var(--mc-text-tertiary)',
                        fontWeight: s === task.status ? 600 : 400,
                      }}
                    >
                      {TASK_STATUS_LABELS[s]}
                    </span>
                    {i < TASK_STATUS_ORDER.length - 1 && <ArrowRight className="h-3 w-3" />}
                  </span>
                ))}
          </div>
        </div>

        {/* Task Messages */}
        <div className="pt-2 border-t" style={{ borderColor: 'var(--mc-border)' }}>
          <h3 className="mc-header-mono text-xs mb-2">Messages</h3>
          <div className="space-y-2 max-h-48 overflow-y-auto mb-2">
            {taskMessages && taskMessages.length > 0 ? (
              [...taskMessages].reverse().map((msg) => (
                <div
                  key={msg._id}
                  className="rounded-md p-2 text-xs"
                  style={{
                    background:
                      msg.authorType === 'agent'
                        ? 'rgba(76, 143, 232, 0.06)'
                        : 'var(--mc-overlay)',
                  }}
                >
                  <div className="flex items-center gap-1.5 mb-0.5">
                    {msg.authorType === 'agent' ? (
                      <Bot className="h-3 w-3" style={{ color: 'var(--mc-progress)' }} />
                    ) : (
                      <User className="h-3 w-3" style={{ color: 'var(--mc-text-tertiary)' }} />
                    )}
                    <span className="font-medium" style={{ color: 'var(--mc-text-primary)' }}>
                      {msg.authorName}
                    </span>
                    <span style={{ color: 'var(--mc-text-muted)' }}>
                      {new Date(msg.createdAt).toLocaleTimeString(undefined, {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>
                  <p style={{ color: 'var(--mc-text-secondary)' }}>{msg.content}</p>
                </div>
              ))
            ) : (
              <p className="text-xs" style={{ color: 'var(--mc-text-muted)' }}>
                No messages yet
              </p>
            )}
            <div ref={messagesEndRef} />
          </div>
        </div>
      </div>

      {/* Message Input — pinned to bottom */}
      <div className="p-3 border-t" style={{ borderColor: 'var(--mc-border)' }}>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const text = messageText.trim();
            if (!text || !taskId || readOnly) return;
            setMessageText('');
            await sendMessage({
              taskId,
              projectId: task.projectId ?? undefined,
              authorType: 'user',
              authorId: user?.id || 'current-user',
              authorName: user?.name || user?.email || 'User',
              content: text,
            });
            messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
          }}
          className="flex items-center gap-2"
        >
          <input
            type="text"
            value={messageText}
            onChange={(e) => setMessageText(e.target.value)}
            placeholder="Type a message…"
            className="flex-1 text-xs py-1.5 px-3 rounded-md border bg-white"
            style={{ borderColor: 'var(--mc-border)', color: 'var(--mc-text-primary)' }}
            disabled={readOnly}
          />
          <button
            type="submit"
            disabled={!messageText.trim() || readOnly}
            className="p-1.5 rounded-md transition-colors"
            style={{
              background: messageText.trim() && !readOnly ? 'var(--mc-accent)' : 'var(--mc-overlay)',
              color: messageText.trim() && !readOnly ? 'white' : 'var(--mc-text-muted)',
            }}
          >
            <Send className="h-3.5 w-3.5" />
          </button>
        </form>
      </div>
    </div>
  );
}
