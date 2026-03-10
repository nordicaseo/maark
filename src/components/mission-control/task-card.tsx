'use client';

import { useState, useEffect } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import NextImage from 'next/image';
import {
  FileText,
  Eye,
  Tag,
  Trash2,
  GripVertical,
} from 'lucide-react';
import type { Doc } from '../../../convex/_generated/dataModel';
import { useTeamMembers } from './team-members-provider';
import { withProjectScope } from '@/lib/project-context';
import {
  TOPIC_STAGE_LABELS,
  resolveWorkflowRuntimeState,
  WORKFLOW_RUNTIME_STATE_LABELS,
  WORKFLOW_RUNTIME_STATE_STYLES,
} from '@/lib/content-workflow-taxonomy';

type Task = Doc<'tasks'>;
type DragAttributes = ReturnType<typeof useSortable>['attributes'];
type DragListeners = NonNullable<ReturnType<typeof useSortable>['listeners']>;

const PRIORITY_COLORS: Record<string, string> = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  URGENT: 'urgent',
};

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

const ROUTED_STAGE_ORDER = [
  'research',
  'seo_intel_review',
  'outline_build',
  'writing',
  'editing',
  'final_review',
] as const;

interface PipelineStep {
  key: string;
  label: string;
  state: 'completed' | 'active' | 'future';
  owner?: string;
}

function buildPipeline(task: Task): PipelineStep[] {
  const currentStage = task.workflowCurrentStageKey || 'research';
  const plan =
    task.workflowStagePlan && typeof task.workflowStagePlan === 'object'
      ? (task.workflowStagePlan as Record<string, unknown>)
      : null;
  const owners =
    plan?.owners && typeof plan.owners === 'object'
      ? (plan.owners as Record<string, unknown>)
      : null;

  // Filter enabled stages
  const enabledStages = ROUTED_STAGE_ORDER.filter((stage) => {
    if (!owners) return true;
    const owner =
      owners[stage] && typeof owners[stage] === 'object'
        ? (owners[stage] as Record<string, unknown>)
        : null;
    if (!owner || owner.enabled === undefined) return true;
    return owner.enabled === true || String(owner.enabled).toLowerCase() === 'true';
  });

  const currentIdx = enabledStages.indexOf(currentStage as typeof enabledStages[number]);

  return enabledStages.map((stage, i) => {
    const owner =
      owners?.[stage] && typeof owners[stage] === 'object'
        ? (owners[stage] as Record<string, unknown>)
        : null;
    const ownerName =
      typeof owner?.agentName === 'string' && owner.agentName.trim().length > 0
        ? owner.agentName.trim()
        : undefined;

    let state: 'completed' | 'active' | 'future' = 'future';
    if (currentIdx >= 0) {
      if (i < currentIdx) state = 'completed';
      else if (i === currentIdx) state = 'active';
    }

    return {
      key: stage,
      label: TOPIC_STAGE_LABELS[stage as keyof typeof TOPIC_STAGE_LABELS] || stage,
      state,
      owner: ownerName,
    };
  });
}

/** Fetch AI cost for a task (fire once, cache in state). */
function useTaskCost(taskId: string) {
  const [cost, setCost] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/admin/ai/usage?taskId=${encodeURIComponent(taskId)}`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (!cancelled && data?.totalCostFormatted) {
          setCost(data.totalCostFormatted);
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [taskId]);
  return cost;
}

export function SortableTaskCard({
  task,
  readOnly = false,
  onClick,
  projectLabel,
  showProjectBadge = false,
}: {
  task: Task;
  readOnly?: boolean;
  onClick?: () => void;
  projectLabel?: string;
  showProjectBadge?: boolean;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task._id, disabled: readOnly });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`mc-card group cursor-grab active:cursor-grabbing ${isDragging ? 'dragging' : ''}`}
      onClick={onClick}
    >
      <TaskCardContent
        task={task}
        readOnly={readOnly}
        projectLabel={projectLabel}
        showProjectBadge={showProjectBadge}
        dragAttributes={attributes}
        dragListeners={listeners}
        setDragHandleRef={setActivatorNodeRef}
      />
    </div>
  );
}

function TaskCardContent({
  task,
  readOnly,
  projectLabel,
  showProjectBadge,
  dragAttributes,
  dragListeners,
  setDragHandleRef,
}: {
  task: Task;
  readOnly: boolean;
  projectLabel?: string;
  showProjectBadge: boolean;
  dragAttributes: DragAttributes;
  dragListeners: DragListeners | undefined;
  setDragHandleRef: (element: HTMLElement | null) => void;
}) {
  const { getMember } = useTeamMembers();
  const assignee = task.assigneeId ? getMember(task.assigneeId) : undefined;
  const taskCost = useTaskCost(task._id);
  const isTopicWorkflow = task.workflowTemplateKey === 'topic_production_v1';
  const workflowStage = task.workflowCurrentStageKey || 'research';
  const workflowStageLabel =
    TOPIC_STAGE_LABELS[workflowStage as keyof typeof TOPIC_STAGE_LABELS] || workflowStage;
  const workflowLastEvent = task.workflowLastEventText;
  const workflowBlocked = isTopicWorkflow && task.workflowStageStatus === 'blocked';
  const workflowRuntimeState = resolveWorkflowRuntimeState({
    workflowTemplateKey: task.workflowTemplateKey,
    workflowCurrentStageKey: task.workflowCurrentStageKey,
    workflowStageStatus: task.workflowStageStatus,
    status: task.status,
  });
  const workflowRuntimeStyle = workflowRuntimeState
    ? WORKFLOW_RUNTIME_STATE_STYLES[workflowRuntimeState]
    : null;
  const filteredTags = (task.tags || []).filter(
    (tag) => !/^skill(?::|_|$)/i.test(String(tag || '').trim())
  );
  const visibleTags = filteredTags.slice(0, 2);
  const hiddenTagCount = filteredTags.length > 2 ? filteredTags.length - 2 : 0;
  const visibleDeliverables = task.deliverables ? task.deliverables.slice(0, 2) : [];
  const hiddenDeliverableCount =
    task.deliverables && task.deliverables.length > 2 ? task.deliverables.length - 2 : 0;
  const pipeline = isTopicWorkflow ? buildPipeline(task) : [];
  const activeStep = pipeline.findIndex((s) => s.state === 'active');

  // Banner state
  const bannerVariant = workflowBlocked
    ? 'blocked'
    : workflowRuntimeState === 'active' || workflowRuntimeState === 'working'
      ? 'working'
      : workflowRuntimeState === 'queued'
        ? 'queued'
        : 'idle';

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (readOnly) return;
    if (confirm('Delete this task?')) {
      try {
        const res = await fetch(`/api/mission-control/tasks/${task._id}`, {
          method: 'DELETE',
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || 'Failed to delete task');
        }
      } catch (error) {
        console.error('Failed to delete task:', error);
      }
    }
  };

  return (
    <div className="space-y-2 min-w-0 overflow-hidden">
      {/* ── Title first ── */}
      <div className="flex items-start gap-2">
        <div className={`mc-priority-dot mt-1.5 ${PRIORITY_COLORS[task.priority] || 'low'}`} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium leading-snug" style={{ color: 'var(--mc-text-primary)' }}>
            {task.title}
          </p>
          {task.description && (
            <p className="text-[11px] mt-0.5 line-clamp-1" style={{ color: 'var(--mc-text-tertiary)' }}>
              {task.description}
            </p>
          )}
        </div>
        <button
          type="button"
          ref={setDragHandleRef}
          {...dragAttributes}
          {...(dragListeners ?? {})}
          onClick={(e) => e.stopPropagation()}
          className={`opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-black/5 shrink-0 mt-0.5 ${
            readOnly ? 'cursor-default hidden' : 'cursor-grab active:cursor-grabbing'
          }`}
          style={{ color: 'var(--mc-text-muted)' }}
          title="Drag task"
          aria-label="Drag task"
          disabled={readOnly}
        >
          <GripVertical className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={handleDelete}
          className={`opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-red-500/20 hover:text-red-400 shrink-0 mt-0.5 ${
            readOnly ? 'hidden' : ''
          }`}
          style={{ color: 'var(--mc-text-muted)' }}
          title="Delete task"
          disabled={readOnly}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* ── Status tags (compact row below title) ── */}
      {isTopicWorkflow && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="mc-tag">{workflowStageLabel}</span>
          {workflowRuntimeState && workflowRuntimeStyle && (
            <span
              className="mc-tag"
              style={{
                background: workflowRuntimeStyle.background,
                color: workflowRuntimeStyle.color,
              }}
            >
              {WORKFLOW_RUNTIME_STATE_LABELS[workflowRuntimeState]}
            </span>
          )}
        </div>
      )}

      {/* ── Active state banner ── */}
      {isTopicWorkflow && workflowLastEvent && (
        <div className={`mc-active-banner ${bannerVariant}`}>
          {bannerVariant === 'working' && <span className="mc-alive-dot" />}
          <span className="text-[11px] leading-4 line-clamp-1 min-w-0">
            {workflowLastEvent}
          </span>
        </div>
      )}

      {/* ── Visual pipeline ── */}
      {isTopicWorkflow && pipeline.length > 0 && (
        <div className="flex items-center gap-2">
          <div className="mc-pipeline flex-1">
            {pipeline.map((step) => (
              <div
                key={step.key}
                className={`mc-pipeline-segment ${step.state}`}
                title={`${step.label}${step.owner ? ` (${step.owner})` : ''}`}
              />
            ))}
          </div>
          <span className="text-[9px] shrink-0 whitespace-nowrap" style={{ color: 'var(--mc-text-muted)' }}>
            {activeStep >= 0 ? `${activeStep + 1}/${pipeline.length}` : `${pipeline.length}/${pipeline.length}`}
          </span>
        </div>
      )}

      {/* ── Tags ── */}
      {(visibleTags.length > 0 || (showProjectBadge && projectLabel)) && (
        <div className="flex flex-wrap gap-1">
          {showProjectBadge && projectLabel && (
            <span className="mc-tag" style={{ borderColor: 'var(--mc-border)' }}>
              {projectLabel}
            </span>
          )}
          {visibleTags.map((tag) => (
            <span key={tag} className="mc-tag">
              <Tag className="h-2.5 w-2.5 mr-0.5" />
              {tag}
            </span>
          ))}
          {hiddenTagCount > 0 && (
            <span className="mc-tag">+{hiddenTagCount}</span>
          )}
        </div>
      )}

      {/* ── Footer: deliverables left, metadata right ── */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1 min-w-0 overflow-hidden">
          {visibleDeliverables.map((d) => (
            d.url ? (
              <a
                key={d.id}
                href={d.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded truncate"
                style={{ background: 'var(--mc-accent-soft)', color: 'var(--mc-accent)' }}
                onClick={(e) => e.stopPropagation()}
              >
                <FileText className="h-2.5 w-2.5 shrink-0" />
                <span className="truncate">{d.title}</span>
              </a>
            ) : (
              <span
                key={d.id}
                className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded truncate"
                style={{ background: 'var(--mc-overlay)', color: 'var(--mc-text-secondary)' }}
              >
                <FileText className="h-2.5 w-2.5 shrink-0" />
                <span className="truncate">{d.title}</span>
              </span>
            )
          ))}
          {hiddenDeliverableCount > 0 && (
            <span className="text-[10px] px-1" style={{ color: 'var(--mc-text-muted)' }}>
              +{hiddenDeliverableCount}
            </span>
          )}
          {task.documentId && isTopicWorkflow && workflowStage === 'writing' && (workflowRuntimeState === 'active' || workflowRuntimeState === 'working') && (
            <a
              href={withProjectScope(`/documents/${task.documentId}`, task.projectId)}
              className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded"
              style={{ color: '#22c55e' }}
              onClick={(e) => e.stopPropagation()}
            >
              <Eye className="h-2.5 w-2.5" />
              Live
            </a>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0 text-[10px]" style={{ color: 'var(--mc-text-muted)' }}>
          {taskCost && taskCost !== '$0.00' && (
            <span style={{ color: '#a78bfa' }}>{taskCost}</span>
          )}
          {taskCost && taskCost !== '$0.00' && <span>&middot;</span>}
          <span>{timeAgo(task.workflowLastEventAt || task.updatedAt)}</span>
          {assignee && (
            assignee.image ? (
              <NextImage
                src={assignee.image}
                alt={assignee.name || ''}
                width={14}
                height={14}
                unoptimized
                className="h-3.5 w-3.5 rounded-full ml-0.5"
                title={assignee.name || assignee.email}
              />
            ) : (
              <div
                className="h-3.5 w-3.5 rounded-full bg-gray-200 flex items-center justify-center text-[7px] font-medium ml-0.5"
                title={assignee.name || assignee.email}
              >
                {(assignee.name || assignee.email).charAt(0).toUpperCase()}
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
}
