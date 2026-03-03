'use client';

import { useState } from 'react';
import { useAuth } from '@/components/auth/auth-provider';
import { useRouter } from 'next/navigation';
import { KanbanBoard } from '@/components/mission-control/kanban-board';
import { AgentsSidebar } from '@/components/mission-control/agents-sidebar';
import { NewTaskDialog } from '@/components/mission-control/new-task-dialog';
import { TaskDetailPanel } from '@/components/mission-control/task-detail-panel';
import { ProjectSwitcher } from '@/components/projects/project-switcher';
import { ArrowLeft, Loader2, Bot } from 'lucide-react';
import Link from 'next/link';
import type { Id } from '../../../convex/_generated/dataModel';
import './mission-control-theme.css';

export default function MissionControlPage() {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const [projectId, setProjectId] = useState<number | null>(null);
  const [showNewTask, setShowNewTask] = useState(false);
  const [showAgents, setShowAgents] = useState(true);
  const [selectedTaskId, setSelectedTaskId] = useState<Id<'tasks'> | null>(null);

  if (isLoading) {
    return (
      <div className="mc-wrapper flex items-center justify-center h-screen">
        <Loader2 className="h-6 w-6 animate-spin" style={{ color: 'var(--mc-text-tertiary)' }} />
      </div>
    );
  }

  if (!user) {
    router.replace('/auth/signin');
    return null;
  }

  const handleTaskClick = (taskId: Id<'tasks'>) => {
    setSelectedTaskId(taskId);
  };

  return (
    <div className="mc-wrapper">
      {/* Header */}
      <header
        className="border-b px-6 py-4"
        style={{ borderColor: 'var(--mc-border)', background: 'var(--mc-surface)' }}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link
              href="/documents"
              style={{ color: 'var(--mc-text-secondary)' }}
              className="hover:opacity-80 transition-opacity"
            >
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <div>
              <h1
                className="text-xl font-bold"
                style={{ color: 'var(--mc-text-primary)', fontFamily: 'var(--mc-font-sans)' }}
              >
                Mission Control
              </h1>
              <p className="mc-header-mono mt-0.5">Content pipeline &middot; Real-time</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="w-48">
              <ProjectSwitcher
                activeProjectId={projectId}
                onProjectChange={setProjectId}
              />
            </div>
            <button
              onClick={() => setShowAgents(!showAgents)}
              className="mc-btn-secondary flex items-center gap-1.5"
            >
              <Bot className="h-3.5 w-3.5" />
              Agents
            </button>
            <button
              onClick={() => setShowNewTask(true)}
              className="mc-btn-primary"
            >
              + New Task
            </button>
          </div>
        </div>
      </header>

      {/* Body */}
      <div className="flex">
        {/* Kanban area */}
        <main className="flex-1 min-w-0 p-6 overflow-x-auto">
          <KanbanBoard
            projectId={projectId}
            onNewTask={() => setShowNewTask(true)}
            onTaskClick={handleTaskClick}
          />
        </main>

        {/* Agents sidebar */}
        {showAgents && (
          <aside
            className="w-72 shrink-0 border-l overflow-y-auto"
            style={{ borderColor: 'var(--mc-border)', background: 'var(--mc-surface-alt)' }}
          >
            <AgentsSidebar />
          </aside>
        )}
      </div>

      <NewTaskDialog
        open={showNewTask}
        onOpenChange={setShowNewTask}
        projectId={projectId}
      />

      <TaskDetailPanel
        taskId={selectedTaskId}
        onClose={() => setSelectedTaskId(null)}
      />
    </div>
  );
}
