'use client';

import { useState, useCallback } from 'react';
import {
  DndContext,
  DragOverlay,
  closestCorners,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { useDroppable } from '@dnd-kit/core';
import { useQuery, useMutation } from 'convex/react';
import { api } from '../../../convex/_generated/api';
import { SortableTaskCard } from './task-card';
import { Plus } from 'lucide-react';
import type { Doc, Id } from '../../../convex/_generated/dataModel';
import {
  taskStatusToDocumentStatus,
  SYNC_SOURCE_KEY,
  SYNC_SOURCE_CONVEX,
} from '@/lib/sync/document-task-sync';

type Task = Doc<'tasks'>;

const COLUMNS = [
  { id: 'BACKLOG', label: 'Inbox', color: 'var(--mc-backlog)' },
  { id: 'PENDING', label: 'Assigned', color: 'var(--mc-pending)' },
  { id: 'IN_PROGRESS', label: 'Working', color: 'var(--mc-progress)' },
  { id: 'IN_REVIEW', label: 'Review', color: 'var(--mc-review)' },
  { id: 'ACCEPTED', label: 'Accepted', color: 'var(--mc-accepted)' },
  { id: 'COMPLETED', label: 'Done', color: 'var(--mc-complete)' },
];

interface KanbanBoardProps {
  projectId?: number | null;
  onNewTask?: () => void;
  onTaskClick?: (taskId: Id<'tasks'>) => void;
}

export function KanbanBoard({ projectId, onNewTask, onTaskClick }: KanbanBoardProps) {
  const tasks = useQuery(api.tasks.list, projectId ? { projectId } : {});
  const updateStatus = useMutation(api.tasks.updateStatus);

  const [activeTask, setActiveTask] = useState<Task | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor)
  );

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const task = tasks?.find((t) => t._id === event.active.id);
      if (task) setActiveTask(task);
    },
    [tasks]
  );

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      setActiveTask(null);
      const { active, over } = event;
      if (!over) return;

      const taskId = active.id as Id<'tasks'>;

      // Determine target column
      let targetStatus: string | null = null;

      // Check if dropped on a column droppable
      const overIdStr = String(over.id);
      if (COLUMNS.some((c) => c.id === overIdStr)) {
        targetStatus = overIdStr;
      } else {
        // Dropped on another task — find which column that task is in
        const overTask = tasks?.find((t) => t._id === over.id);
        if (overTask) {
          targetStatus = overTask.status;
        }
      }

      if (!targetStatus) return;

      // Don't update if status hasn't changed
      const currentTask = tasks?.find((t) => t._id === taskId);
      if (currentTask?.status === targetStatus) return;

      // Optimistic: update immediately via Convex mutation
      await updateStatus({ id: taskId, status: targetStatus });

      // Sync status to linked Drizzle document (fire-and-forget)
      if (currentTask?.documentId) {
        const docStatus = taskStatusToDocumentStatus(targetStatus);
        fetch(`/api/documents/${currentTask.documentId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            status: docStatus,
            [SYNC_SOURCE_KEY]: SYNC_SOURCE_CONVEX,
          }),
        }).catch((err) =>
          console.error('Sync task status → Drizzle document failed:', err)
        );
      }
    },
    [tasks, updateStatus]
  );

  if (!tasks) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="mc-header-mono">Loading tasks...</p>
      </div>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="flex gap-4 overflow-x-auto pb-4">
        {COLUMNS.map((col) => {
          const columnTasks = tasks.filter((t) => t.status === col.id);
          return (
            <KanbanColumn
              key={col.id}
              id={col.id}
              label={col.label}
              color={col.color}
              count={columnTasks.length}
              tasks={columnTasks}
              onNewTask={col.id === 'BACKLOG' ? onNewTask : undefined}
              onTaskClick={onTaskClick}
            />
          );
        })}
      </div>

      <DragOverlay>
        {activeTask && (
          <div className="mc-card dragging w-64">
            <div className="flex items-start gap-2">
              <div className={`mc-priority-dot mt-1.5 ${activeTask.priority.toLowerCase()}`} />
              <p className="text-sm font-medium" style={{ color: 'var(--mc-text-primary)' }}>
                {activeTask.title}
              </p>
            </div>
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

function KanbanColumn({
  id,
  label,
  color,
  count,
  tasks,
  onNewTask,
  onTaskClick,
}: {
  id: string;
  label: string;
  color: string;
  count: number;
  tasks: Task[];
  onNewTask?: () => void;
  onTaskClick?: (taskId: Id<'tasks'>) => void;
}) {
  const { setNodeRef } = useDroppable({ id });

  return (
    <div className="mc-column w-64 shrink-0">
      <div className="mc-column-header">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full" style={{ background: color }} />
          <span className="mc-header-mono">{label}</span>
          <span
            className="text-[10px] font-medium px-1.5 rounded-full"
            style={{ background: 'var(--mc-overlay)', color: 'var(--mc-text-tertiary)' }}
          >
            {count}
          </span>
        </div>
        {onNewTask && (
          <button
            onClick={onNewTask}
            className="p-1 rounded hover:bg-black/5 transition-colors"
          >
            <Plus className="h-3.5 w-3.5" style={{ color: 'var(--mc-text-tertiary)' }} />
          </button>
        )}
      </div>

      <SortableContext items={tasks.map((t) => t._id)} strategy={verticalListSortingStrategy}>
        <div ref={setNodeRef} className="mc-column-body">
          {tasks.map((task) => (
            <SortableTaskCard
              key={task._id}
              task={task}
              onClick={() => onTaskClick?.(task._id)}
            />
          ))}
          {tasks.length === 0 && (
            <div className="flex items-center justify-center h-20">
              <p className="text-xs" style={{ color: 'var(--mc-text-muted)' }}>
                No tasks
              </p>
            </div>
          )}
        </div>
      </SortableContext>
    </div>
  );
}
