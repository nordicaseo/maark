'use client';

import { useState, useCallback } from 'react';
import {
  DndContext,
  DragOverlay,
  closestCorners,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragCancelEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { useDroppable } from '@dnd-kit/core';
import { useQuery } from 'convex/react';
import { api } from '../../../convex/_generated/api';
import { SortableTaskCard } from './task-card';
import { Plus } from 'lucide-react';
import type { Doc, Id } from '../../../convex/_generated/dataModel';
import {
  taskStatusToDocumentStatus,
  SYNC_SOURCE_KEY,
  SYNC_SOURCE_CONVEX,
} from '@/lib/sync/document-task-sync';
import { TASK_STATUS_COLUMNS, type TaskStatus } from '@/lib/content-workflow-taxonomy';

type Task = Doc<'tasks'>;

interface KanbanBoardProps {
  projectId?: number | null;
  readOnly?: boolean;
  onNewTask?: () => void;
  onTaskClick?: (taskId: Id<'tasks'>) => void;
}

export function KanbanBoard({ projectId, readOnly = false, onNewTask, onTaskClick }: KanbanBoardProps) {
  const tasks = useQuery(api.tasks.list, projectId ? { projectId, limit: 500 } : 'skip');

  const [activeTask, setActiveTask] = useState<Task | null>(null);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 120, tolerance: 6 },
    }),
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
      if (readOnly) return;

      const taskId = active.id as Id<'tasks'>;

      // Determine target column
      let targetStatus: TaskStatus | null = null;

      // Check if dropped on a column droppable
      const overIdStr = String(over.id);
      if (TASK_STATUS_COLUMNS.some((c) => c.id === overIdStr)) {
        targetStatus = overIdStr as TaskStatus;
      } else {
        // Dropped on another task — find which column that task is in
        const overTask = tasks?.find((t) => t._id === over.id);
        if (overTask) {
          targetStatus = overTask.status as TaskStatus;
        }
      }

      if (!targetStatus) return;

      // Don't update if status hasn't changed
      const currentTask = tasks?.find((t) => t._id === taskId);
      if (currentTask?.status === targetStatus) return;

      try {
        const res = await fetch(`/api/mission-control/tasks/${taskId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            status: targetStatus,
          }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || 'Failed to update task status');
        }
      } catch (error) {
        console.error('Failed to update task status from drag-and-drop:', error);
        return;
      }

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
    [readOnly, tasks]
  );

  const handleDragCancel = useCallback((_event: DragCancelEvent) => {
    setActiveTask(null);
  }, []);

  if (!projectId) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="mc-header-mono">Select a project to load tasks</p>
      </div>
    );
  }

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
      onDragCancel={handleDragCancel}
    >
      <div className="flex gap-4 overflow-x-auto pb-4">
        {TASK_STATUS_COLUMNS.map((col) => {
          const columnTasks = tasks.filter((t) => t.status === col.id);
          return (
            <KanbanColumn
              key={col.id}
              id={col.id}
              label={col.label}
              color={col.color}
              count={columnTasks.length}
              tasks={columnTasks}
              readOnly={readOnly}
              onNewTask={col.id === 'BACKLOG' && !readOnly ? onNewTask : undefined}
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
  readOnly,
  onNewTask,
  onTaskClick,
}: {
  id: TaskStatus;
  label: string;
  color: string;
  count: number;
  tasks: Task[];
  readOnly: boolean;
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
              readOnly={readOnly}
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
