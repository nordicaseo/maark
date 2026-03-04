'use client';

import { useState } from 'react';
import { useAuth } from '@/components/auth/auth-provider';
import { useConvexAvailable } from '@/lib/convex/provider';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { ProjectSwitcher } from '@/components/projects/project-switcher';
import { TeamMembersProvider } from '@/components/mission-control/team-members-provider';
import { SkillsProvider } from '@/components/mission-control/skills-provider';
import { ArrowLeft, Loader2, Bot, AlertTriangle, Activity } from 'lucide-react';
import Link from 'next/link';
import { useActiveProject } from '@/hooks/use-active-project';
import './mission-control-theme.css';

// Lazy-load all Convex-dependent components so their modules are only
// evaluated when Convex is actually configured — prevents runtime errors
// from useQuery/useMutation outside ConvexProvider.
const KanbanBoard = dynamic(
  () => import('@/components/mission-control/kanban-board').then((m) => m.KanbanBoard),
  { ssr: false, loading: () => <BoardSkeleton /> }
);
const AgentsSidebar = dynamic(
  () => import('@/components/mission-control/agents-sidebar').then((m) => m.AgentsSidebar),
  { ssr: false }
);
const NewTaskDialog = dynamic(
  () => import('@/components/mission-control/new-task-dialog').then((m) => m.NewTaskDialog),
  { ssr: false }
);
const TaskDetailPanel = dynamic(
  () => import('@/components/mission-control/task-detail-panel').then((m) => m.TaskDetailPanel),
  { ssr: false }
);
const ActivitySidebar = dynamic(
  () => import('@/components/mission-control/activity-sidebar').then((m) => m.ActivitySidebar),
  { ssr: false }
);

function BoardSkeleton() {
  return (
    <div className="flex gap-4">
      {[1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="mc-column w-64 shrink-0 animate-pulse">
          <div className="h-8 rounded mb-3" style={{ background: 'var(--mc-overlay, #f3f3f0)' }} />
          <div className="space-y-2">
            <div className="h-20 rounded" style={{ background: 'var(--mc-overlay, #f3f3f0)' }} />
            <div className="h-16 rounded" style={{ background: 'var(--mc-overlay, #f3f3f0)' }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function MissionControlPage() {
  const { user, isLoading } = useAuth();
  const convexAvailable = useConvexAvailable();
  const router = useRouter();
  const { activeProjectId: projectId, setActiveProjectId: setProjectId } = useActiveProject();
  const [showNewTask, setShowNewTask] = useState(false);
  const [showAgents, setShowAgents] = useState(true);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [showActivity, setShowActivity] = useState(true);

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

  // Convex not configured — show setup instructions
  if (!convexAvailable) {
    return (
      <div className="mc-wrapper">
        <header
          className="border-b px-6 py-4"
          style={{ borderColor: 'var(--mc-border)', background: 'var(--mc-surface)' }}
        >
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
        </header>
        <div className="flex items-center justify-center" style={{ minHeight: 'calc(100vh - 80px)' }}>
          <div className="max-w-md text-center space-y-4 p-8">
            <div
              className="mx-auto w-12 h-12 rounded-full flex items-center justify-center"
              style={{ background: 'var(--mc-overlay, #f3f3f0)' }}
            >
              <AlertTriangle className="h-6 w-6" style={{ color: 'var(--mc-review, #e6a756)' }} />
            </div>
            <h2 className="text-lg font-semibold" style={{ color: 'var(--mc-text-primary, #1a1a1a)' }}>
              Convex Not Configured
            </h2>
            <p className="text-sm" style={{ color: 'var(--mc-text-secondary, #666)' }}>
              Mission Control requires a Convex deployment for real-time task management. Set the{' '}
              <code
                className="px-1.5 py-0.5 rounded text-xs font-mono"
                style={{ background: 'var(--mc-overlay, #f3f3f0)' }}
              >
                NEXT_PUBLIC_CONVEX_URL
              </code>{' '}
              environment variable to get started.
            </p>
            <div
              className="text-xs space-y-1 text-left p-3 rounded-md font-mono"
              style={{ background: 'var(--mc-overlay, #f3f3f0)', color: 'var(--mc-text-secondary, #666)' }}
            >
              <p>1. npx convex dev</p>
              <p>2. Copy your deployment URL</p>
              <p>3. Add NEXT_PUBLIC_CONVEX_URL to .env.local</p>
            </div>
            <Link href="/documents" className="mc-btn-secondary inline-flex items-center gap-2">
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to Editor
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <TeamMembersProvider>
      <SkillsProvider>
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
                <ProjectSwitcher activeProjectId={projectId} onProjectChange={setProjectId} />
              </div>
              <button
                onClick={() => setShowAgents(!showAgents)}
                className="mc-btn-secondary flex items-center gap-1.5"
              >
                <Bot className="h-3.5 w-3.5" />
                Agents
              </button>
              <button
                onClick={() => setShowActivity(!showActivity)}
                className="mc-btn-secondary flex items-center gap-1.5"
              >
                <Activity className="h-3.5 w-3.5" />
                Activity
              </button>
              <button onClick={() => setShowNewTask(true)} className="mc-btn-primary">
                + New Task
              </button>
            </div>
          </div>
        </header>

        {/* Body */}
        <div className="flex">
          {/* Agents sidebar — left */}
          {showAgents && (
            <aside
              className="w-72 shrink-0 border-r overflow-y-auto"
              style={{ borderColor: 'var(--mc-border)', background: 'var(--mc-surface-alt)' }}
            >
              <AgentsSidebar />
            </aside>
          )}

          {/* Kanban area */}
          <main className="flex-1 min-w-0 p-6 overflow-x-auto">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2
                  className="text-sm font-semibold"
                  style={{ color: 'var(--mc-text-primary)', fontFamily: 'var(--mc-font-sans)' }}
                >
                  Content Queue
                </h2>
                <p className="mc-header-mono mt-0.5">Drag tasks between stages</p>
              </div>
            </div>
            <KanbanBoard
              projectId={projectId}
              onNewTask={() => setShowNewTask(true)}
              onTaskClick={(taskId: any) => setSelectedTaskId(taskId)}
            />
          </main>

          {/* Activity sidebar — right */}
          {showActivity && (
            <aside
              className="w-80 shrink-0 border-l overflow-y-auto"
              style={{ borderColor: 'var(--mc-border)', background: 'var(--mc-surface-alt)' }}
            >
              <ActivitySidebar projectId={projectId} />
            </aside>
          )}
        </div>

        <NewTaskDialog open={showNewTask} onOpenChange={setShowNewTask} projectId={projectId} />

        <TaskDetailPanel taskId={selectedTaskId as any} onClose={() => setSelectedTaskId(null)} />
      </div>
      </SkillsProvider>
    </TeamMembersProvider>
  );
}
