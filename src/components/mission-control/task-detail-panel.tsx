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
  };
  createdAt: number;
}

export function TaskDetailPanel({ taskId, onClose, projectId }: TaskDetailPanelProps) {
  const { user } = useAuth();
  const task = useQuery(
    api.tasks.get,
    taskId ? { id: taskId, projectId: projectId ?? undefined } : 'skip'
  );
  const agents = useQuery(api.agents.list, { limit: 300 });
  const updateTask = useMutation(api.tasks.update);
  const updateStatus = useMutation(api.tasks.updateStatus);
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
  const [workflowLoading, setWorkflowLoading] = useState(false);
  const [workflowError, setWorkflowError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<AgentRunResult | null>(null);
  const [messageText, setMessageText] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [workflowEvents, setWorkflowEvents] = useState<WorkflowEvent[]>([]);

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

  if (!taskId || !task) return null;

  const isTopicWorkflow = task.workflowTemplateKey === 'topic_production_v1';
  const workflowStage = (task.workflowCurrentStageKey || 'research') as TopicStageKey;
  const workflowFlags = task.workflowFlags || {};
  const workflowApprovals = task.workflowApprovals || {};
  const defaultNextStage = TOPIC_STAGE_NEXT[workflowStage];
  const workflowNextStage =
    workflowStage === 'outline_build' &&
    Boolean(workflowFlags.outlineReviewOptional) &&
    Boolean(workflowApprovals.outlineSkipped)
      ? 'prewrite_context'
      : defaultNextStage;

  const assignedAgent = agents?.find((a) => a._id === task.assignedAgentId);
  const onlineAgents = agents?.filter((a) => a.status === 'ONLINE') ?? [];
  const priority = PRIORITY_LABELS[task.priority] || PRIORITY_LABELS.MEDIUM;

  const handleAdvanceWorkflowStage = async (
    toStage: TopicStageKey,
    options?: { skipOptionalOutlineReview?: boolean; note?: string }
  ) => {
    if (!isTopicWorkflow) return;
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
    if (!isTopicWorkflow) return;
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
    if (!isTopicWorkflow) return;
    setWorkflowRunBusy(true);
    setWorkflowError(null);
    try {
      const res = await fetch('/api/topic-workflow/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskId: task._id,
          autoContinue,
          maxStages: autoContinue ? 6 : 1,
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

  // ─── Start Agent: writes the article ─────────────────────────────
  const handleStartAgent = async () => {
    setAgentRunning(true);
    setLastResult(null);

    try {
      // Pick an agent (assigned, or first online)
      let agentId = task.assignedAgentId;
        if (!agentId && onlineAgents.length > 0) {
          agentId = onlineAgents[0]._id;
        await updateTask({
          id: task._id,
          expectedProjectId: task.projectId ?? undefined,
          assignedAgentId: agentId,
        });
      }

      // Move task to IN_PROGRESS
      await updateStatus({
        id: task._id,
        status: 'IN_PROGRESS',
        expectedProjectId: task.projectId ?? undefined,
      });
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
      await updateStatus({
        id: task._id,
        status: 'IN_REVIEW',
        expectedProjectId: task.projectId ?? undefined,
      });
      syncStatusToDrizzle(result.documentId || task.documentId, 'IN_REVIEW');

      // Set agent back to ONLINE
      if (agentId) {
        await updateAgentStatus({ id: agentId, status: 'ONLINE' });
      }
    } catch (err) {
      console.error('Agent start error:', err);
      // Revert status on failure
      await updateStatus({
        id: task._id,
        status: task.status,
        expectedProjectId: task.projectId ?? undefined,
      });
      setLastResult({ error: (err as Error).message });
    } finally {
      setAgentRunning(false);
    }
  };

  // ─── Process Feedback: revises based on comments ─────────────────
  const handleProcessFeedback = async (useResearch: boolean = false) => {
    if (!task.documentId) return;
    setFeedbackRunning(true);
    setLastResult(null);

    try {
      // Move back to IN_PROGRESS while processing
      await updateStatus({
        id: task._id,
        status: 'IN_PROGRESS',
        expectedProjectId: task.projectId ?? undefined,
      });
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
      await updateStatus({
        id: task._id,
        status: 'IN_REVIEW',
        expectedProjectId: task.projectId ?? undefined,
      });
      syncStatusToDrizzle(task.documentId, 'IN_REVIEW');
    } catch (err) {
      console.error('Feedback processing error:', err);
      await updateStatus({
        id: task._id,
        status: 'IN_REVIEW',
        expectedProjectId: task.projectId ?? undefined,
      });
      setLastResult({ error: (err as Error).message });
    } finally {
      setFeedbackRunning(false);
    }
  };

  // ─── Mark Complete ───────────────────────────────────────────────
  const handleComplete = async () => {
    if (isTopicWorkflow) {
      await handleAdvanceWorkflowStage('complete');
      return;
    }
    await updateStatus({
      id: task._id,
      status: 'COMPLETED',
      expectedProjectId: task.projectId ?? undefined,
    });
    syncStatusToDrizzle(task.documentId, 'COMPLETED');
  };

  const isProcessing = agentRunning || feedbackRunning;
  const stageArtifacts = workflowEvents.filter(
    (event) => event.eventType === 'stage_artifact' && Boolean(event.payload?.artifact)
  );
  const showStartAgent = isTopicWorkflow
    ? false
    : (task.status === 'BACKLOG' || task.status === 'PENDING' || !task.documentId);
  const showProcessFeedback = isTopicWorkflow
    ? workflowStage === 'final_review' && Boolean(task.documentId)
    : task.status === 'IN_REVIEW' && Boolean(task.documentId);
  const showRerun = isTopicWorkflow
    ? workflowStage === 'final_review'
    : task.status === 'IN_REVIEW';
  const showComplete = isTopicWorkflow
    ? workflowStage === 'final_review'
    : task.status === 'IN_REVIEW';

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
              {TOPIC_STAGES.map((stage) => (
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
            {task.workflowLastEventText && (
              <p className="text-xs rounded-md px-2 py-1.5" style={{ background: 'var(--mc-overlay)', color: 'var(--mc-text-secondary)' }}>
                {task.workflowLastEventText}
              </p>
            )}
            {workflowError && (
              <p className="text-xs text-red-500">{workflowError}</p>
            )}

            <div className="flex items-center gap-2 flex-wrap">
              {workflowStage !== 'complete' && workflowStage !== 'outline_review' && workflowStage !== 'final_review' && (
                <>
                  <button
                    onClick={() => handleRunWorkflow(false)}
                    disabled={workflowRunBusy || workflowBusy}
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
                    disabled={workflowRunBusy || workflowBusy}
                    className="mc-btn-secondary text-xs flex items-center gap-1.5"
                  >
                    <RefreshCw className="h-3 w-3" />
                    Run Full Workflow
                  </button>
                </>
              )}
              {workflowNextStage &&
                workflowStage !== 'complete' &&
                workflowStage !== 'prewrite_context' && (
                <button
                  onClick={() => handleAdvanceWorkflowStage(workflowNextStage as TopicStageKey)}
                  disabled={workflowBusy || workflowRunBusy}
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
              {workflowStage === 'prewrite_context' && (
                <button
                  onClick={() =>
                    handleAdvanceWorkflowStage('writing', {
                      note: 'Prewrite approved by human. Start writing stage.',
                    })
                  }
                  disabled={workflowBusy || workflowRunBusy}
                  className="mc-btn-primary text-xs flex items-center gap-1.5"
                >
                  {workflowBusy ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <CheckCheck className="h-3 w-3" />
                  )}
                  Approve Prewrite & Start Writing
                </button>
              )}
              {workflowStage === 'outline_build' && workflowFlags.outlineReviewOptional && (
                <button
                  onClick={() =>
                    handleAdvanceWorkflowStage('prewrite_context', {
                      skipOptionalOutlineReview: true,
                      note: 'Outline review skipped by PM/lead.',
                    })
                  }
                  disabled={workflowBusy || workflowRunBusy}
                  className="mc-btn-secondary text-xs"
                >
                  Skip Optional Outline Review
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
                      disabled={workflowBusy || workflowRunBusy}
                      className="mc-btn-secondary text-xs flex items-center gap-1.5"
                    >
                      <CheckCheck className="h-3 w-3" />
                      Human approve
                    </button>
                    <button
                      onClick={() => handleWorkflowApproval('outline_seo', true)}
                      disabled={workflowBusy || workflowRunBusy}
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
                      disabled={workflowBusy || workflowRunBusy}
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

            <div>
              <p className="text-xs font-medium mb-1.5" style={{ color: 'var(--mc-text-secondary)' }}>
                Workflow Timeline
              </p>
              <div className="max-h-36 overflow-y-auto space-y-1.5">
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
            </div>

            {stageArtifacts.length > 0 && (
              <div>
                <p className="text-xs font-medium mb-1.5" style={{ color: 'var(--mc-text-secondary)' }}>
                  Stage Outputs
                </p>
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

        {/* Workflow Context from Document */}
        {task.documentId && docPreview && (
          <div className="space-y-2">
            <h3 className="mc-header-mono text-xs">Research & Prewrite Context</h3>
            <div className="rounded-md border p-2.5 space-y-2 text-xs" style={{ borderColor: 'var(--mc-border)' }}>
              {docPreview.researchSnapshot?.summary ? (
                <div>
                  <p className="font-medium mb-0.5" style={{ color: 'var(--mc-text-secondary)' }}>
                    Research summary
                  </p>
                  <p style={{ color: 'var(--mc-text-tertiary)' }}>{docPreview.researchSnapshot.summary}</p>
                  {docPreview.researchSnapshot.facts && docPreview.researchSnapshot.facts.length > 0 && (
                    <div className="mt-1 space-y-0.5" style={{ color: 'var(--mc-text-tertiary)' }}>
                      {docPreview.researchSnapshot.facts.slice(0, 4).map((fact, idx) => (
                        <p key={`${fact}-${idx}`}>• {fact}</p>
                      ))}
                    </div>
                  )}
                  {docPreview.researchSnapshot.statistics && docPreview.researchSnapshot.statistics.length > 0 && (
                    <div className="mt-1 space-y-0.5" style={{ color: 'var(--mc-text-tertiary)' }}>
                      {docPreview.researchSnapshot.statistics.slice(0, 4).map((stat, idx) => (
                        <p key={`${stat.stat}-${idx}`}>
                          • {stat.stat}
                          {stat.source ? ` (${stat.source})` : ''}
                        </p>
                      ))}
                    </div>
                  )}
                  {docPreview.researchSnapshot.sources && docPreview.researchSnapshot.sources.length > 0 && (
                    <div className="mt-1.5 space-y-0.5">
                      <p className="font-medium" style={{ color: 'var(--mc-text-secondary)' }}>
                        Sources
                      </p>
                      {docPreview.researchSnapshot.sources.slice(0, 3).map((source, idx) => (
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
                  )}
                </div>
              ) : (
                <p style={{ color: 'var(--mc-text-muted)' }}>No research summary yet.</p>
              )}
              {docPreview.outlineSnapshot?.markdown ? (
                <div>
                  <p className="font-medium mb-0.5" style={{ color: 'var(--mc-text-secondary)' }}>
                    Outline snapshot
                  </p>
                  <pre
                    className="whitespace-pre-wrap text-[11px] leading-4 max-h-28 overflow-y-auto"
                    style={{ color: 'var(--mc-text-tertiary)' }}
                  >
                    {docPreview.outlineSnapshot.markdown}
                  </pre>
                </div>
              ) : (
                <p style={{ color: 'var(--mc-text-muted)' }}>No outline snapshot yet.</p>
              )}
              {docPreview.prewriteChecklist && (
                <div style={{ color: 'var(--mc-text-tertiary)' }}>
                  <p>
                    Brand context: {docPreview.prewriteChecklist.brandContextReady ? 'ready' : 'pending'}
                  </p>
                  <p>
                    Internal links: {docPreview.prewriteChecklist.internalLinksReady ? 'ready' : 'pending'}
                  </p>
                  <p>
                    Unresolved questions: {docPreview.prewriteChecklist.unresolvedQuestions}
                  </p>
                </div>
              )}
              {docPreview.agentQuestions && docPreview.agentQuestions.length > 0 && (
                <div>
                  <p className="font-medium mb-1" style={{ color: 'var(--mc-text-secondary)' }}>
                    Agent questions
                  </p>
                  <div className="space-y-1">
                    {docPreview.agentQuestions.slice(0, 4).map((q) => (
                      <p key={q.id} style={{ color: 'var(--mc-text-tertiary)' }}>
                        • {q.question} ({q.status})
                      </p>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Agent Actions */}
        <div className="space-y-2">
          <h3 className="mc-header-mono text-xs">Agent Actions</h3>

          {/* Start Agent — available for BACKLOG, PENDING, or if no content yet */}
          {showStartAgent && (
            <button
              onClick={handleStartAgent}
              disabled={isProcessing}
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
                disabled={isProcessing}
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
                disabled={isProcessing}
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
              disabled={isProcessing}
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
              disabled={isProcessing}
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
              ? TOPIC_STAGES.map((stage, i) => (
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
                    {i < TOPIC_STAGES.length - 1 && <ArrowRight className="h-3 w-3" />}
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
            if (!text || !taskId) return;
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
          />
          <button
            type="submit"
            disabled={!messageText.trim()}
            className="p-1.5 rounded-md transition-colors"
            style={{
              background: messageText.trim() ? 'var(--mc-accent)' : 'var(--mc-overlay)',
              color: messageText.trim() ? 'white' : 'var(--mc-text-muted)',
            }}
          >
            <Send className="h-3.5 w-3.5" />
          </button>
        </form>
      </div>
    </div>
  );
}
