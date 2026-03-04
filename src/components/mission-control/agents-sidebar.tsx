'use client';

import { useQuery } from 'convex/react';
import { api } from '../../../convex/_generated/api';
import { Bot } from 'lucide-react';
import type { Doc } from '../../../convex/_generated/dataModel';

type Agent = Doc<'agents'>;

const ROLE_BADGES: Record<string, string> = {
  writer: 'mc-badge-writer',
  editor: 'mc-badge-editor',
  researcher: 'mc-badge-researcher',
};

const STATUS_DOTS: Record<string, string> = {
  ONLINE: 'online',
  WORKING: 'working',
  IDLE: 'idle',
  OFFLINE: 'offline',
};

export function AgentsSidebar() {
  const agents = useQuery(api.agents.list, { limit: 300 });

  if (!agents) {
    return (
      <div className="p-4">
        <p className="mc-header-mono">Loading agents...</p>
      </div>
    );
  }

  const working = agents.filter((a) => a.status === 'WORKING');
  const online = agents.filter((a) => a.status === 'ONLINE');
  const idle = agents.filter((a) => a.status === 'IDLE');
  const offline = agents.filter((a) => a.status === 'OFFLINE');

  const sections = [
    { label: 'Working', agents: working },
    { label: 'Online', agents: online },
    { label: 'Idle', agents: idle },
    { label: 'Offline', agents: offline },
  ].filter((s) => s.agents.length > 0);

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center gap-2">
        <Bot className="h-4 w-4" style={{ color: 'var(--mc-text-secondary)' }} />
        <span className="mc-header-mono">Agents ({agents.length})</span>
      </div>

      {agents.length === 0 && (
        <p className="text-xs" style={{ color: 'var(--mc-text-muted)' }}>
          No agents registered yet
        </p>
      )}

      {sections.map((section) => (
        <div key={section.label}>
          <p className="mc-header-mono mb-2">{section.label}</p>
          <div className="space-y-2">
            {section.agents.map((agent) => (
              <AgentCard key={agent._id} agent={agent} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function AgentCard({ agent }: { agent: Agent }) {
  return (
    <div className="mc-card">
      <div className="flex items-start gap-3">
        {/* Avatar */}
        <div
          className="w-9 h-9 rounded-lg flex items-center justify-center text-white text-sm font-semibold shrink-0"
          style={{
            background: `linear-gradient(135deg, var(--mc-accent), ${
              agent.role === 'writer'
                ? '#4C8FE8'
                : agent.role === 'editor'
                  ? '#C47ADB'
                  : '#E8A84C'
            })`,
          }}
        >
          {agent.name.charAt(0).toUpperCase()}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium" style={{ color: 'var(--mc-text-primary)' }}>
              {agent.name}
            </span>
            <span className={`mc-status-dot ${STATUS_DOTS[agent.status] || 'offline'}`} />
          </div>

          <div className="flex items-center gap-2 mt-1">
            <span className={`mc-badge ${ROLE_BADGES[agent.role] || ''}`}>
              {agent.role}
            </span>
            {agent.tasksCompleted != null && agent.tasksCompleted > 0 && (
              <span className="text-[10px]" style={{ color: 'var(--mc-text-tertiary)' }}>
                {agent.tasksCompleted} done
              </span>
            )}
          </div>

          {agent.skills && agent.skills.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1.5">
              {agent.skills.map((skill) => (
                <span key={skill} className="mc-tag">{skill}</span>
              ))}
            </div>
          )}

          {agent.specialization && (
            <p className="text-[10px] mt-1" style={{ color: 'var(--mc-text-tertiary)' }}>
              {agent.specialization}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
