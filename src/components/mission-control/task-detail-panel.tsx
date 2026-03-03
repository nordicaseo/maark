'use client';

import { useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { api } from '../../../convex/_generated/api';
import type { Doc, Id } from '../../../convex/_generated/dataModel';
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
} from 'lucide-react';

type Task = Doc<'tasks'>;

const STATUS_LABELS: Record<string, string> = {
  BACKLOG: 'Inbox',
  PENDING: 'Assigned',
  IN_PROGRESS: 'Working',
  IN_REVIEW: 'Review',
  COMPLETED: 'Done',
};

const PRIORITY_LABELS: Record<string, { label: string; color: string }> = {
  LOW: { label: 'Low', color: 'var(--mc-complete)' },
  MEDIUM: { label: 'Medium', color: 'var(--mc-pending)' },
  HIGH: { label: 'High', color: 'var(--mc-review)' },
  URGENT: { label: 'Urgent', color: 'var(--mc-overdue)' },
};

interface TaskDetailPanelProps {
  taskId: Id<'tasks'> | null;
  onClose: () => void;
}

export function TaskDetailPanel({ taskId, onClose }: TaskDetailPanelProps) {
  const tasks = useQuery(api.tasks.list, {});
  const task = tasks?.find((t) => t._id === taskId) ?? null;
  const agents = useQuery(api.agents.list);
  const updateTask = useMutation(api.tasks.update);
  const updateStatus = useMutation(api.tasks.updateStatus);
  const updateAgentStatus = useMutation(api.agents.updateStatus);

  const [agentRunning, setAgentRunning] = useState(false);
  const [feedbackRunning, setFeedbackRunning] = useState(false);
  const [lastResult, setLastResult] = useState<any>(null);

  if (!taskId || !task) return null;

  const assignedAgent = agents?.find((a) => a._id === task.assignedAgentId);
  const onlineAgents = agents?.filter((a) => a.status === 'ONLINE') ?? [];
  const priority = PRIORITY_LABELS[task.priority] || PRIORITY_LABELS.MEDIUM;

  // ─── Start Agent: writes the article ─────────────────────────────
  const handleStartAgent = async () => {
    setAgentRunning(true);
    setLastResult(null);

    try {
      // Pick an agent (assigned, or first online)
      let agentId = task.assignedAgentId;
      if (!agentId && onlineAgents.length > 0) {
        agentId = onlineAgents[0]._id;
        await updateTask({ id: task._id, assignedAgentId: agentId });
      }

      // Move task to IN_PROGRESS
      await updateStatus({ id: task._id, status: 'IN_PROGRESS' });

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
        documentId: result.documentId,
        deliverables: [...existingDeliverables, result.deliverable],
      });
      await updateStatus({ id: task._id, status: 'IN_REVIEW' });

      // Set agent back to ONLINE
      if (agentId) {
        await updateAgentStatus({ id: agentId, status: 'ONLINE' });
      }
    } catch (err) {
      console.error('Agent start error:', err);
      // Revert status on failure
      await updateStatus({ id: task._id, status: task.status });
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
      await updateStatus({ id: task._id, status: 'IN_PROGRESS' });

      const res = await fetch('/api/agent/process-feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskId: task._id,
          documentId: task.documentId,
          useResearch,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Feedback processing failed');
      }

      const result = await res.json();
      setLastResult(result);

      // Move back to IN_REVIEW
      await updateStatus({ id: task._id, status: 'IN_REVIEW' });
    } catch (err) {
      console.error('Feedback processing error:', err);
      await updateStatus({ id: task._id, status: 'IN_REVIEW' });
      setLastResult({ error: (err as Error).message });
    } finally {
      setFeedbackRunning(false);
    }
  };

  // ─── Mark Complete ───────────────────────────────────────────────
  const handleComplete = async () => {
    await updateStatus({ id: task._id, status: 'COMPLETED' });
  };

  const isProcessing = agentRunning || feedbackRunning;

  return (
    <div className="fixed inset-y-0 right-0 w-96 bg-white shadow-xl border-l z-50 flex flex-col"
         style={{ borderColor: 'var(--mc-border)' }}>
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b"
           style={{ borderColor: 'var(--mc-border)' }}>
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full" style={{ background: priority.color }} />
          <span className="mc-header-mono text-xs">{priority.label} Priority</span>
          <span className="text-xs px-2 py-0.5 rounded-full"
                style={{ background: 'var(--mc-overlay)', color: 'var(--mc-text-secondary)' }}>
            {STATUS_LABELS[task.status] || task.status}
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
                href={`/documents/${task.documentId}`}
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

        {/* Deliverables */}
        {task.deliverables && task.deliverables.length > 0 && (
          <div>
            <h3 className="mc-header-mono text-xs mb-2">Deliverables</h3>
            <div className="space-y-1.5">
              {task.deliverables.map((d) => (
                <a
                  key={d.id}
                  href={d.url}
                  target="_blank"
                  rel="noopener"
                  className="flex items-center gap-2 text-xs p-2 rounded-md"
                  style={{
                    background: 'var(--mc-accent-soft)',
                    color: 'var(--mc-accent)',
                  }}
                >
                  <Eye className="h-3.5 w-3.5" />
                  {d.title}
                </a>
              ))}
            </div>
          </div>
        )}

        {/* Agent Actions */}
        <div className="space-y-2">
          <h3 className="mc-header-mono text-xs">Agent Actions</h3>

          {/* Start Agent — available for BACKLOG, PENDING, or if no content yet */}
          {(task.status === 'BACKLOG' || task.status === 'PENDING' || !task.documentId) && (
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
          {task.status === 'IN_REVIEW' && task.documentId && (
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
          {task.status === 'IN_REVIEW' && (
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
          {task.status === 'IN_REVIEW' && (
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

        {/* Status Flow Diagram */}
        <div className="pt-2 border-t" style={{ borderColor: 'var(--mc-border)' }}>
          <h3 className="mc-header-mono text-xs mb-2">Status Flow</h3>
          <div className="flex items-center gap-1 text-[10px] flex-wrap"
               style={{ color: 'var(--mc-text-tertiary)' }}>
            {['BACKLOG', 'PENDING', 'IN_PROGRESS', 'IN_REVIEW', 'COMPLETED'].map((s, i) => (
              <span key={s} className="flex items-center gap-1">
                <span
                  className="px-1.5 py-0.5 rounded"
                  style={{
                    background: s === task.status ? 'var(--mc-accent-soft)' : 'var(--mc-overlay)',
                    color: s === task.status ? 'var(--mc-accent)' : 'var(--mc-text-tertiary)',
                    fontWeight: s === task.status ? 600 : 400,
                  }}
                >
                  {STATUS_LABELS[s]}
                </span>
                {i < 4 && <ArrowRight className="h-3 w-3" />}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
