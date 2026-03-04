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
} from 'lucide-react';
import { useMutation } from 'convex/react';
import { api } from '../../../convex/_generated/api';
import type { Doc } from '../../../convex/_generated/dataModel';
import { useTeamMembers } from './team-members-provider';
import { useSkills } from './skills-provider';

type Task = Doc<'tasks'>;

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
  onClick,
}: {
  task: Task;
  onClick?: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task._id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={`mc-card group cursor-grab active:cursor-grabbing ${isDragging ? 'dragging' : ''}`}
      onClick={onClick}
    >
      <TaskCardContent task={task} />
    </div>
  );
}

function TaskCardContent({ task }: { task: Task }) {
  const { getMember } = useTeamMembers();
  const { getSkillName } = useSkills();
  const removeTask = useMutation(api.tasks.remove);
  const assignee = task.assigneeId ? getMember(task.assigneeId) : undefined;
  const skillName = task.skillId ? getSkillName(task.skillId) : undefined;

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (confirm('Delete this task?')) {
      removeTask({ id: task._id });
    }
  };

  return (
    <div className="space-y-2">
      {/* Header: priority + title + delete */}
      <div className="flex items-start gap-2">
        <div className={`mc-priority-dot mt-1.5 ${PRIORITY_COLORS[task.priority] || 'low'}`} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium leading-snug" style={{ color: 'var(--mc-text-primary)' }}>
            {task.title}
          </p>
          {task.description && (
            <p className="text-xs mt-0.5 line-clamp-2" style={{ color: 'var(--mc-text-secondary)' }}>
              {task.description}
            </p>
          )}
        </div>
        <button
          onClick={handleDelete}
          className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-red-500/20 hover:text-red-400 shrink-0 mt-0.5"
          style={{ color: 'var(--mc-text-muted)' }}
          title="Delete task"
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
              href={`/documents/${task.documentId}`}
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
            {timeAgo(task.updatedAt)}
          </span>
        </div>
      </div>

      {/* Deliverables */}
      {task.deliverables && task.deliverables.length > 0 && (
        <div className="flex gap-1 pt-1 border-t" style={{ borderColor: 'var(--mc-border)' }}>
          {task.deliverables.map((d) => (
            <a
              key={d.id}
              href={d.url}
              target="_blank"
              rel="noopener"
              className="flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded"
              style={{ background: 'var(--mc-accent-soft)', color: 'var(--mc-accent)' }}
              onClick={(e) => e.stopPropagation()}
            >
              <Eye className="h-3 w-3" />
              {d.title}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
