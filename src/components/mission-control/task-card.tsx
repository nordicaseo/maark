'use client';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import NextImage from 'next/image';
import {
  FileText,
  MessageSquare,
  Calendar,
  Eye,
  Bot,
  Tag,
  Sparkles,
  Trash2,
  GripVertical,
} from 'lucide-react';
import type { Doc } from '../../../convex/_generated/dataModel';
import { useTeamMembers } from './team-members-provider';
import { useSkills } from './skills-provider';
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

export function SortableTaskCard({
  task,
  readOnly = false,
  onClick,
}: {
  task: Task;
  readOnly?: boolean;
  onClick?: () => void;
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
  dragAttributes,
  dragListeners,
  setDragHandleRef,
}: {
  task: Task;
  readOnly: boolean;
  dragAttributes: DragAttributes;
  dragListeners: DragListeners | undefined;
  setDragHandleRef: (element: HTMLElement | null) => void;
}) {
  const { getMember } = useTeamMembers();
  const { getSkillName } = useSkills();
  const assignee = task.assigneeId ? getMember(task.assigneeId) : undefined;
  const skillName = task.skillId ? getSkillName(task.skillId) : undefined;
  const isTopicWorkflow = task.workflowTemplateKey === 'topic_production_v1';
  const workflowStage = task.workflowCurrentStageKey || 'research';
  const workflowStageLabel =
    TOPIC_STAGE_LABELS[workflowStage as keyof typeof TOPIC_STAGE_LABELS] || workflowStage;
  const workflowLastEvent = task.workflowLastEventText;
  const workflowBlocked = isTopicWorkflow && task.workflowStageStatus === 'blocked';
  const workflowQueued = isTopicWorkflow && task.workflowStageStatus === 'queued';
  const workflowRuntimeState = resolveWorkflowRuntimeState({
    workflowTemplateKey: task.workflowTemplateKey,
    workflowCurrentStageKey: task.workflowCurrentStageKey,
    workflowStageStatus: task.workflowStageStatus,
    status: task.status,
  });
  const workflowRuntimeStyle = workflowRuntimeState
    ? WORKFLOW_RUNTIME_STATE_STYLES[workflowRuntimeState]
    : null;
  const researchReady =
    isTopicWorkflow &&
    !workflowBlocked &&
    !workflowQueued &&
    workflowStage !== 'research' &&
    workflowStage !== 'outline_build';

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
      {/* Header: priority + title + delete */}
      <div className="flex items-start gap-2">
        <div className={`mc-priority-dot mt-1.5 ${PRIORITY_COLORS[task.priority] || 'low'}`} />
        <div className="min-w-0 flex-1">
          {isTopicWorkflow && (
            <div className="flex items-center gap-1.5 mb-1 flex-wrap">
              <span className="mc-tag">{workflowStageLabel}</span>
              {workflowRuntimeState && workflowRuntimeStyle && (
                <span
                  className="mc-tag border"
                  style={{
                    background: workflowRuntimeStyle.background,
                    color: workflowRuntimeStyle.color,
                    borderColor: workflowRuntimeStyle.borderColor,
                  }}
                >
                  {WORKFLOW_RUNTIME_STATE_LABELS[workflowRuntimeState]}
                </span>
              )}
              {researchReady && (
                <span className="mc-tag text-green-400">Research Ready</span>
              )}
            </div>
          )}
          <p className="text-sm font-medium leading-snug" style={{ color: 'var(--mc-text-primary)' }}>
            {task.title}
          </p>
          {task.description && (
            <p className="text-xs mt-0.5 line-clamp-2" style={{ color: 'var(--mc-text-secondary)' }}>
              {task.description}
            </p>
          )}
          {isTopicWorkflow && workflowLastEvent && (
            <p
              className="text-[10px] mt-1 line-clamp-3"
              style={{
                color: workflowBlocked ? '#b91c1c' : 'var(--mc-text-tertiary)',
              }}
            >
              {workflowLastEvent}
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

      {/* Tags */}
      {task.tags && task.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {task.tags.slice(0, 3).map((tag) => (
            <span key={tag} className="mc-tag">
              <Tag className="h-2.5 w-2.5 mr-0.5" />
              {tag}
            </span>
          ))}
          {task.tags.length > 3 && (
            <span className="mc-tag">+{task.tags.length - 3}</span>
          )}
        </div>
      )}

      {/* Skill tag */}
      {skillName && (
        <div className="flex flex-wrap gap-1">
          <span className="mc-tag">
            <Sparkles className="h-2.5 w-2.5 mr-0.5" />
            {skillName}
          </span>
        </div>
      )}

      {/* Footer: metadata */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-[10px]" style={{ color: 'var(--mc-text-tertiary)' }}>
          {task.documentId && (
            <a
              href={withProjectScope(`/documents/${task.documentId}`, task.projectId)}
              className="flex items-center gap-0.5 hover:underline"
              style={{ color: 'var(--mc-accent)' }}
              onClick={(e) => e.stopPropagation()}
            >
              <FileText className="h-3 w-3" />
              Edit
            </a>
          )}
          {task.assignedAgentId && (
            <span className="flex items-center gap-0.5">
              <Bot className="h-3 w-3" />
              Agent
            </span>
          )}
          {task.commentCount && task.commentCount > 0 && (
            <span className="flex items-center gap-0.5">
              <MessageSquare className="h-3 w-3" />
              {task.commentCount}
            </span>
          )}
          {task.dueDate && (
            <span className="flex items-center gap-0.5">
              <Calendar className="h-3 w-3" />
              {new Date(task.dueDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {assignee && (
            assignee.image ? (
              <NextImage
                src={assignee.image}
                alt={assignee.name || ''}
                width={16}
                height={16}
                unoptimized
                className="h-4 w-4 rounded-full"
                title={assignee.name || assignee.email}
              />
            ) : (
              <div
                className="h-4 w-4 rounded-full bg-gray-200 flex items-center justify-center text-[8px] font-medium"
                title={assignee.name || assignee.email}
              >
                {(assignee.name || assignee.email).charAt(0).toUpperCase()}
              </div>
            )
          )}
          <span className="text-[10px]" style={{ color: 'var(--mc-text-muted)' }}>
            {timeAgo(task.workflowLastEventAt || task.updatedAt)}
          </span>
        </div>
      </div>

      {/* Deliverables */}
      {task.deliverables && task.deliverables.length > 0 && (
        <div className="flex flex-wrap items-start gap-1 pt-1 border-t min-w-0 overflow-hidden" style={{ borderColor: 'var(--mc-border)' }}>
          {task.deliverables.map((d) => (
            d.url ? (
              <a
                key={d.id}
                href={d.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex max-w-full min-w-0 items-start gap-0.5 text-[10px] px-1.5 py-0.5 rounded break-words whitespace-normal"
                style={{ background: 'var(--mc-accent-soft)', color: 'var(--mc-accent)' }}
                onClick={(e) => e.stopPropagation()}
              >
                <Eye className="h-3 w-3" />
                <span className="min-w-0">{d.title}</span>
              </a>
            ) : (
              <span
                key={d.id}
                className="inline-flex max-w-full min-w-0 items-start gap-0.5 text-[10px] px-1.5 py-0.5 rounded break-words whitespace-normal"
                style={{ background: 'var(--mc-overlay)', color: 'var(--mc-text-secondary)' }}
              >
                <FileText className="h-3 w-3" />
                <span className="min-w-0">{d.title}</span>
              </span>
            )
          ))}
        </div>
      )}
    </div>
  );
}
