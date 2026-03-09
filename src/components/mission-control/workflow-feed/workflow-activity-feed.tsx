'use client';

import { useState, useMemo } from 'react';
import { useQuery } from 'convex/react';
import { api } from '../../../../convex/_generated/api';
import type { Id } from '../../../../convex/_generated/dataModel';
import { Activity } from 'lucide-react';
import { resolveAgentIdentity } from '@/lib/activity-feed/agent-identity';
import { groupFeedEvents } from '@/lib/activity-feed/group-events';
import type { WorkflowEvent } from '@/lib/activity-feed/humanize-event';
import {
  TOPIC_STAGE_LABELS,
} from '@/lib/content-workflow-taxonomy';
import { ThinkingIndicator } from './thinking-indicator';
import { FeedItem } from './feed-item';

interface WorkflowActivityFeedProps {
  projectId?: number | null;
  taskId?: Id<'tasks'> | null;
  compact?: boolean;
}

function stageLabel(key?: string | null): string {
  if (!key) return '';
  return (TOPIC_STAGE_LABELS as Record<string, string>)[key] ?? key;
}

export function WorkflowActivityFeed({ projectId, taskId, compact }: WorkflowActivityFeedProps) {
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});

  // ── Data fetching ────────────────────────────────────────────
  // Task mode (editor): query by taskId
  const taskEvents = useQuery(
    api.topicWorkflow.listWorkflowHistory,
    taskId ? { taskId, limit: 80 } : 'skip',
  );

  // Project mode (mission control): query by projectId
  const projectEvents = useQuery(
    api.topicWorkflow.listProjectWorkflowFeed,
    !taskId && projectId ? { projectId, limit: 80 } : 'skip',
  );

  // Normalize to a flat event array
  const rawEvents: WorkflowEvent[] = useMemo(() => {
    if (taskId && taskEvents?.events) {
      return taskEvents.events as unknown as WorkflowEvent[];
    }
    if (projectEvents) {
      return projectEvents as unknown as WorkflowEvent[];
    }
    return [];
  }, [taskId, taskEvents, projectEvents]);

  // ── Processing pipeline ──────────────────────────────────────
  const groups = useMemo(() => groupFeedEvents(rawEvents), [rawEvents]);

  // ── Active agent detection ───────────────────────────────────
  const activeAgent = useMemo(() => {
    if (rawEvents.length === 0) return null;
    const latest = rawEvents[0];
    const payload = latest.payload as Record<string, unknown> | undefined;
    const fiveMinAgo = Date.now() - 5 * 60 * 1000;

    if (
      latest.eventType === 'stage_progress' &&
      payload?.status === 'started' &&
      latest.createdAt > fiveMinAgo
    ) {
      return {
        identity: resolveAgentIdentity(latest.actorName, latest.actorType, latest.stageKey),
        stageName: stageLabel(latest.stageKey),
      };
    }
    return null;
  }, [rawEvents]);

  // ── Toggle handler ───────────────────────────────────────────
  const toggleExpand = (groupId: string) => {
    setExpandedGroups((prev) => ({ ...prev, [groupId]: !prev[groupId] }));
  };

  // ── Loading state ────────────────────────────────────────────
  const isLoading = taskId ? !taskEvents : projectId ? !projectEvents : false;

  if (!projectId && !taskId) {
    return (
      <div className="flex-1 flex items-center justify-center p-4">
        <p className="text-xs" style={{ color: 'var(--mc-text-tertiary)' }}>
          Select a project to load activity.
        </p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center p-4">
        <div
          className="text-xs animate-pulse"
          style={{ color: 'var(--mc-text-tertiary)' }}
        >
          Loading activity...
        </div>
      </div>
    );
  }

  if (groups.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
        <div
          className="w-10 h-10 rounded-full flex items-center justify-center mb-3"
          style={{ background: 'var(--mc-overlay, #f3f3f0)' }}
        >
          <Activity className="h-5 w-5" style={{ color: 'var(--mc-text-tertiary)' }} />
        </div>
        <p className="text-xs" style={{ color: 'var(--mc-text-tertiary)' }}>
          No activity yet
        </p>
        <p className="text-xs mt-1" style={{ color: 'var(--mc-text-tertiary)' }}>
          Activity will appear here as the workflow progresses.
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className={compact ? 'p-2 space-y-1' : 'p-3 space-y-1'}>
        {/* Active agent indicator */}
        {activeAgent && (
          <ThinkingIndicator
            identity={activeAgent.identity}
            stageName={activeAgent.stageName}
          />
        )}

        {/* Feed items */}
        {groups.map((group) => (
          <FeedItem
            key={group.id}
            group={group}
            onToggleExpand={toggleExpand}
            isExpanded={!!expandedGroups[group.id]}
            compact={compact}
          />
        ))}
      </div>
    </div>
  );
}
