'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/components/auth/auth-provider';
import { useConvexAvailable } from '@/lib/convex/provider';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import type { Doc, Id } from '../../../convex/_generated/dataModel';
import { useQuery } from 'convex/react';
import { api } from '../../../convex/_generated/api';
import { ProjectSwitcher } from '@/components/projects/project-switcher';
import { TeamMembersProvider } from '@/components/mission-control/team-members-provider';
import { ArrowLeft, Loader2, Bot, AlertTriangle, Activity, Search, Globe } from 'lucide-react';
import Link from 'next/link';
import { useActiveProject } from '@/hooks/use-active-project';
import { useProjectScopeSync } from '@/hooks/use-project-scope-sync';
import { withProjectScope } from '@/lib/project-context';
import './mission-control-theme.css';

type TaskDoc = Doc<'tasks'>;

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

function MissionOverviewStrip({
  projectId,
  orgTasks,
}: {
  projectId: number | null;
  orgTasks: TaskDoc[];
}) {
  const agents = useQuery(
    api.agents.list,
    projectId ? { projectId, limit: 300 } : { limit: 300 }
  );
  const projectScopedTasks = useQuery(api.tasks.list, projectId ? { projectId, limit: 500 } : 'skip');
  const now = new Date();
  const tasks = projectId ? (projectScopedTasks || []) : orgTasks;

  const activeAgents = (agents || []).filter(
    (agent) => agent.status === 'ONLINE' || agent.status === 'WORKING'
  ).length;
  const queuedTasks = tasks.filter((task) => task.status !== 'COMPLETED').length;
  const workingTasks = tasks.filter((task) => task.status === 'IN_PROGRESS').length;

  return (
    <div
      className="hidden xl:flex items-center gap-2 px-3 py-1.5 rounded-xl border"
      style={{
        borderColor: 'var(--mc-border)',
        background: 'color-mix(in srgb, var(--mc-surface) 88%, white 12%)',
      }}
    >
      <div className="px-2">
        <p className="text-lg font-semibold leading-none" style={{ color: 'var(--mc-text-primary)' }}>
          {activeAgents}
        </p>
        <p className="mc-header-mono mt-1">Agents Active</p>
      </div>
      <div className="w-px h-8" style={{ background: 'var(--mc-border)' }} />
      <div className="px-2">
        <p className="text-lg font-semibold leading-none" style={{ color: 'var(--mc-text-primary)' }}>
          {queuedTasks}
        </p>
        <p className="mc-header-mono mt-1">Tasks In Queue</p>
      </div>
      <div className="w-px h-8" style={{ background: 'var(--mc-border)' }} />
      <div className="px-2">
        <p className="text-lg font-semibold leading-none" style={{ color: 'var(--mc-text-primary)' }}>
          {workingTasks}
        </p>
        <p className="mc-header-mono mt-1">Working Now</p>
      </div>
      <div className="w-px h-8" style={{ background: 'var(--mc-border)' }} />
      <div className="px-2">
        <p className="text-sm font-semibold leading-none" style={{ color: 'var(--mc-text-primary)' }}>
          {now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </p>
        <p className="mc-header-mono mt-1">
          {now.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}
        </p>
      </div>
    </div>
  );
}

export default function MissionControlPage() {
  const { user, isLoading } = useAuth();
  const convexAvailable = useConvexAvailable();
  const router = useRouter();
  const { activeProjectId: projectId, setActiveProjectId: setProjectId } = useActiveProject();
  useProjectScopeSync(projectId, setProjectId);
  const [showNewTask, setShowNewTask] = useState(false);
  const [showAgents, setShowAgents] = useState(true);
  const [selectedTaskId, setSelectedTaskId] = useState<Id<'tasks'> | null>(null);
  const [showActivity, setShowActivity] = useState(true);
  const [orgTasks, setOrgTasks] = useState<TaskDoc[]>([]);
  const [orgProjects, setOrgProjects] = useState<Array<{ id: number; name: string }>>([]);
  const [orgLoading, setOrgLoading] = useState(false);
  const [orgLoadingMore, setOrgLoadingMore] = useState(false);
  const [orgProjectFilter, setOrgProjectFilter] = useState<number | null>(null);
  const [orgNextCursor, setOrgNextCursor] = useState<string | null>(null);
  const lastInteractionAtRef = useRef<number>(Date.now());
  const isClientRole = user?.role === 'client';

  useEffect(() => {
    if (!isLoading && !user) {
      router.replace('/auth/signin');
    }
  }, [isLoading, user, router]);

  useEffect(() => {
    if (projectId !== null) {
      setOrgProjectFilter(null);
      setOrgNextCursor(null);
    }
  }, [projectId]);

  useEffect(() => {
    if (!user || projectId !== null) return;

    let cancelled = false;
    const fetchOrgTasks = async () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
        return;
      }
      setOrgLoading(true);
      try {
        const params = new URLSearchParams();
        params.set('limit', '320');
        if (orgProjectFilter !== null) {
          params.set('projectId', String(orgProjectFilter));
        }
        const res = await fetch(`/api/mission-control/tasks?${params.toString()}`);
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        setOrgTasks(Array.isArray(data.tasks) ? data.tasks : []);
        setOrgProjects(Array.isArray(data.projects) ? data.projects : []);
        setOrgNextCursor(typeof data.nextCursor === 'string' ? data.nextCursor : null);
      } catch (error) {
        if (!cancelled) {
          console.error('Failed to fetch org mission control tasks:', error);
        }
      } finally {
        if (!cancelled) {
          setOrgLoading(false);
        }
      }
    };

    void fetchOrgTasks();
    const interval = window.setInterval(() => {
      void fetchOrgTasks();
    }, 20000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [projectId, user, orgProjectFilter]);

  useEffect(() => {
    const markInteraction = () => {
      lastInteractionAtRef.current = Date.now();
    };
    window.addEventListener('pointerdown', markInteraction, { passive: true });
    window.addEventListener('keydown', markInteraction, { passive: true });
    window.addEventListener('wheel', markInteraction, { passive: true });
    window.addEventListener('mousemove', markInteraction, { passive: true });
    return () => {
      window.removeEventListener('pointerdown', markInteraction);
      window.removeEventListener('keydown', markInteraction);
      window.removeEventListener('wheel', markInteraction);
      window.removeEventListener('mousemove', markInteraction);
    };
  }, []);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    const sendPresence = async () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      const active = Date.now() - lastInteractionAtRef.current < 60_000;
      const scopedProjectId = projectId ?? orgProjectFilter ?? null;
      try {
        await fetch('/api/team/presence', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId: scopedProjectId,
            active,
          }),
        });
      } catch (error) {
        if (!cancelled) {
          console.error('Presence heartbeat failed:', error);
        }
      }
    };

    void sendPresence();
    const interval = window.setInterval(() => {
      void sendPresence();
    }, 30_000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [user, projectId, orgProjectFilter]);

  useEffect(() => {
    if (!user || isClientRole) return;

    let cancelled = false;
    const runAutoResume = async () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
        return;
      }
      try {
        const payload: Record<string, unknown> = {
          maxResumes: 4,
        };
        const scopedProjectId = projectId ?? orgProjectFilter;
        if (scopedProjectId !== null) {
          payload.projectId = scopedProjectId;
        }
        await fetch('/api/topic-workflow/auto-resume', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } catch (error) {
        if (!cancelled) {
          console.error('Auto-resume poll failed:', error);
        }
      }
    };

    void runAutoResume();
    const interval = window.setInterval(() => {
      void runAutoResume();
    }, 30000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [user, isClientRole, projectId, orgProjectFilter]);

  const orgProjectLabelById = useMemo(() => {
    const entries = orgProjects.map((project) => [project.id, project.name] as const);
    return Object.fromEntries(entries);
  }, [orgProjects]);

  const filteredOrgTasks = useMemo(() => {
    if (projectId !== null) return [];
    return orgTasks;
  }, [projectId, orgTasks]);

  const loadMoreOrgTasks = async () => {
    if (projectId !== null || !orgNextCursor || orgLoadingMore) return;
    setOrgLoadingMore(true);
    try {
      const params = new URLSearchParams();
      params.set('limit', '220');
      params.set('cursor', orgNextCursor);
      if (orgProjectFilter !== null) {
        params.set('projectId', String(orgProjectFilter));
      }
      const res = await fetch(`/api/mission-control/tasks?${params.toString()}`);
      if (!res.ok) return;
      const data = await res.json();
      const incoming = Array.isArray(data.tasks) ? data.tasks : [];
      setOrgTasks((prev) => {
        const seen = new Set(prev.map((task) => String(task._id)));
        const merged = [...prev];
        for (const task of incoming) {
          const key = String(task?._id || '');
          if (!key || seen.has(key)) continue;
          seen.add(key);
          merged.push(task);
        }
        return merged;
      });
      setOrgNextCursor(typeof data.nextCursor === 'string' ? data.nextCursor : null);
    } catch (error) {
      console.error('Failed to load more org tasks:', error);
    } finally {
      setOrgLoadingMore(false);
    }
  };

  if (isLoading) {
    return (
      <div className="mc-wrapper flex items-center justify-center h-screen">
        <Loader2 className="h-6 w-6 animate-spin" style={{ color: 'var(--mc-text-tertiary)' }} />
      </div>
    );
  }

  if (!user) {
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
              href={withProjectScope('/documents', projectId)}
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
            <Link
              href={withProjectScope('/documents', projectId)}
              className="mc-btn-secondary inline-flex items-center gap-2"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to Editor
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <TeamMembersProvider projectId={projectId}>
      <div className="mc-wrapper">
        {/* Header */}
        <header
          className="border-b px-6 py-4"
          style={{ borderColor: 'var(--mc-border)', background: 'var(--mc-surface)' }}
        >
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <Link
                href={withProjectScope('/documents', projectId)}
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

            <MissionOverviewStrip
              projectId={projectId}
              orgTasks={projectId === null ? filteredOrgTasks : []}
            />

            <div className="flex items-center gap-3">
              <div className="w-48">
                <ProjectSwitcher activeProjectId={projectId} onProjectChange={setProjectId} />
              </div>
              <Link
                href={withProjectScope('/keywords', projectId)}
                className="mc-btn-secondary flex items-center gap-1.5"
              >
                <Search className="h-3.5 w-3.5" />
                Keywords
              </Link>
              <Link
                href={withProjectScope('/pages', projectId)}
                className="mc-btn-secondary flex items-center gap-1.5"
              >
                <Globe className="h-3.5 w-3.5" />
                Pages
              </Link>
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
              <button
                onClick={() => setShowNewTask(true)}
                className="mc-btn-primary"
                disabled={!projectId || isClientRole}
                title={isClientRole ? 'Clients have read-only Mission Control access' : undefined}
              >
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
                <p className="mc-header-mono mt-0.5">
                  {isClientRole ? 'Read-only view for client role' : 'Drag tasks between stages'}
                </p>
              </div>
            </div>
            {!projectId && (
              <div className="mb-4 space-y-2">
                <div
                  className="rounded-md border px-3 py-2 text-xs"
                  style={{ borderColor: 'var(--mc-border)', color: 'var(--mc-text-secondary)' }}
                >
                  Org view: showing combined tasks across accessible projects.
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setOrgProjectFilter(null)}
                    className={`mc-tag border ${orgProjectFilter === null ? 'font-semibold' : ''}`}
                    style={{ borderColor: 'var(--mc-border)' }}
                  >
                    All Projects
                  </button>
                  {orgProjects.map((project) => (
                    <button
                      key={project.id}
                      type="button"
                      onClick={() => setOrgProjectFilter(project.id)}
                      className={`mc-tag border ${orgProjectFilter === project.id ? 'font-semibold' : ''}`}
                      style={{ borderColor: 'var(--mc-border)' }}
                    >
                      {project.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <KanbanBoard
              projectId={projectId}
              tasksOverride={projectId === null ? filteredOrgTasks : null}
              projectLabelById={orgProjectLabelById}
              showProjectBadge={projectId === null}
              readOnly={isClientRole}
              onNewTask={() => setShowNewTask(true)}
              onTaskClick={setSelectedTaskId}
            />
            {!projectId && orgLoading && (
              <div className="mt-3 text-xs mc-header-mono">
                Refreshing org task stream{orgNextCursor ? ' (paged)' : ''}...
              </div>
            )}
            {!projectId && !orgLoading && orgNextCursor && (
              <div className="mt-3">
                <button
                  type="button"
                  onClick={() => void loadMoreOrgTasks()}
                  disabled={orgLoadingMore}
                  className="mc-btn-secondary"
                >
                  {orgLoadingMore ? 'Loading…' : 'Load more'}
                </button>
              </div>
            )}
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

        <TaskDetailPanel
          taskId={selectedTaskId}
          projectId={projectId}
          readOnly={isClientRole}
          onClose={() => setSelectedTaskId(null)}
        />
      </div>
    </TeamMembersProvider>
  );
}
