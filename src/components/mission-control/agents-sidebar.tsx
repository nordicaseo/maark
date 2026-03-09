'use client';

import { useEffect, useMemo, useState } from 'react';
import { Bot, ChevronDown, Loader2, Users } from 'lucide-react';
import Image from 'next/image';
import { useActiveProject } from '@/hooks/use-active-project';
import { useTeamMembers } from './team-members-provider';

interface AgentProfileSummary {
  role: string;
  laneKey?: string | null;
  displayName: string;
  emoji: string | null;
  avatarUrl: string | null;
  shortDescription: string | null;
  mission: string | null;
  tools: string[];
  updatedAt: string;
}

interface RuntimeAgentSummary {
  id: string;
  name: string;
  role: string;
  status: string;
  slotKey: string;
  laneKey: string | null;
  currentTaskId: string | null;
  specialization: string | null;
}

const ROLE_BADGES: Record<string, string> = {
  writer: 'mc-badge-writer',
  editor: 'mc-badge-editor',
  researcher: 'mc-badge-researcher',
  outliner: 'mc-badge-editor',
  'seo-reviewer': 'mc-badge-researcher',
  'project-manager': 'mc-badge-writer',
  seo: 'mc-badge-researcher',
  content: 'mc-badge-editor',
  lead: 'mc-badge-writer',
};

const STATUS_DOTS: Record<string, string> = {
  ONLINE: 'online',
  WORKING: 'working',
  IDLE: 'idle',
  OFFLINE: 'offline',
};

const STATUS_ORDER: Array<'WORKING' | 'ONLINE' | 'IDLE' | 'OFFLINE'> = [
  'WORKING',
  'ONLINE',
  'IDLE',
  'OFFLINE',
];

export function AgentsSidebar() {
  const { activeProjectId } = useActiveProject();
  const { members } = useTeamMembers();
  const [loading, setLoading] = useState(true);
  const [runtimeAgents, setRuntimeAgents] = useState<RuntimeAgentSummary[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [profileMap, setProfileMap] = useState<Record<string, AgentProfileSummary>>({});
  const [expandedHumanId, setExpandedHumanId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const loadProfiles = async () => {
      if (activeProjectId === null) {
        if (!cancelled) {
          setRuntimeAgents([]);
          setProfileMap({});
          setLoading(false);
        }
        return;
      }
      try {
        if (!cancelled) setLoading(true);
        const res = await fetch(`/api/mission-control/agents?projectId=${activeProjectId}`);
        if (!res.ok) return;
        const data = (await res.json()) as {
          runtimeAgents?: RuntimeAgentSummary[];
          profiles?: AgentProfileSummary[];
          laneProfiles?: AgentProfileSummary[];
        };
        if (cancelled) return;
        const byRole: Record<string, AgentProfileSummary> = {};
        for (const profile of data.profiles || []) {
          byRole[profile.role.toLowerCase()] = profile;
        }
        for (const profile of data.laneProfiles || []) {
          const laneKey = String(profile.laneKey || '').toLowerCase();
          if (!laneKey) continue;
          byRole[`${profile.role.toLowerCase()}:${laneKey}`] = profile;
        }
        setProfileMap(byRole);
        setRuntimeAgents(data.runtimeAgents || []);
      } catch {
        if (!cancelled) {
          setRuntimeAgents([]);
          setProfileMap({});
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void loadProfiles();
    if (activeProjectId) {
      intervalId = setInterval(() => {
        void loadProfiles();
      }, 20_000);
    }

    return () => {
      cancelled = true;
      if (intervalId) clearInterval(intervalId);
    };
  }, [activeProjectId]);

  const sections = STATUS_ORDER.map((status) => ({
    label: status.charAt(0) + status.slice(1).toLowerCase(),
    agents: runtimeAgents.filter((agent) => agent.status === status),
  })).filter((section) => section.agents.length > 0);

  const humanMembers = members
    .slice()
    .sort((a, b) => {
      const aOnline = a.isOnline ? 1 : 0;
      const bOnline = b.isOnline ? 1 : 0;
      if (aOnline !== bOnline) return bOnline - aOnline;
      return (b.activeSeconds || 0) - (a.activeSeconds || 0);
    });

  if (loading && runtimeAgents.length === 0) {
    return (
      <div className="p-4">
        <p className="mc-header-mono flex items-center gap-2">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Loading agents...
        </p>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center gap-2">
        <Bot className="h-4 w-4" style={{ color: 'var(--mc-text-secondary)' }} />
        <span className="mc-header-mono">Agents ({runtimeAgents.length})</span>
      </div>

      {runtimeAgents.length === 0 && (
        <p className="text-xs" style={{ color: 'var(--mc-text-muted)' }}>
          No agents registered yet
        </p>
      )}

      {sections.map((section) => (
        <div key={section.label}>
          <p className="mc-header-mono mb-2">{section.label}</p>
          <div className="space-y-1.5">
            {section.agents.map((agent) => {
              const laneKey = String(agent.laneKey || '').toLowerCase();
              const profile =
                laneKey && agent.role.toLowerCase() === 'writer'
                  ? profileMap[`writer:${laneKey}`] || profileMap[agent.role.toLowerCase()]
                  : profileMap[agent.role.toLowerCase()];
              return (
                <AgentCard
                  key={agent.id}
                  agent={agent}
                  profile={profile}
                  expanded={expandedId === agent.id}
                  onToggle={() => setExpandedId((prev) => (prev === agent.id ? null : agent.id))}
                />
              );
            })}
          </div>
        </div>
      ))}

      <div className="pt-1">
        <div className="flex items-center gap-2 mb-2">
          <Users className="h-4 w-4" style={{ color: 'var(--mc-text-secondary)' }} />
          <span className="mc-header-mono">Human Workforce ({humanMembers.length})</span>
        </div>
        <div className="space-y-1.5">
          {humanMembers.map((member) => (
            <HumanCard
              key={member.id}
              member={member}
              expanded={expandedHumanId === member.id}
              onToggle={() =>
                setExpandedHumanId((prev) => (prev === member.id ? null : member.id))
              }
            />
          ))}
          {humanMembers.length === 0 && (
            <p className="text-xs" style={{ color: 'var(--mc-text-muted)' }}>
              No human members in current scope.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function formatDuration(seconds: number | undefined): string {
  const total = Math.max(0, Math.floor(seconds || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function timeAgoFromIso(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return 'unknown';
  const diffMs = Date.now() - parsed.getTime();
  if (diffMs < 60_000) return 'just now';
  if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)}m ago`;
  if (diffMs < 86_400_000) return `${Math.floor(diffMs / 3_600_000)}h ago`;
  return `${Math.floor(diffMs / 86_400_000)}d ago`;
}

function AgentAvatar({
  agent,
  profile,
}: {
  agent: RuntimeAgentSummary;
  profile?: AgentProfileSummary;
}) {
  if (profile?.avatarUrl) {
    return (
      <Image
        src={profile.avatarUrl}
        alt={`${profile.displayName || agent.name} avatar`}
        width={28}
        height={28}
        unoptimized
        className="h-7 w-7 rounded-md object-cover shrink-0 border border-[var(--mc-border)]"
      />
    );
  }

  const emoji = profile?.emoji || '';
  if (emoji) {
    return (
      <div className="h-7 w-7 rounded-md shrink-0 border border-[var(--mc-border)] bg-[var(--mc-surface)] flex items-center justify-center text-sm">
        {emoji}
      </div>
    );
  }

  return (
    <div className="h-7 w-7 rounded-md shrink-0 border border-[var(--mc-border)] bg-[var(--mc-overlay)] flex items-center justify-center text-xs font-semibold">
      {agent.name.charAt(0).toUpperCase()}
    </div>
  );
}

function HumanCard({
  member,
  expanded,
  onToggle,
}: {
  member: {
    id: string;
    name: string | null;
    email: string;
    image: string | null;
    role: string;
    isOnline?: boolean;
    lastSeenAt?: string | null;
    onlineSeconds?: number;
    activeSeconds?: number;
    activityRatio?: number;
  };
  expanded: boolean;
  onToggle: () => void;
}) {
  const label = member.name || member.email;
  const statusClass = member.isOnline ? 'online' : 'offline';
  const activityPercent = Math.round((member.activityRatio || 0) * 100);

  return (
    <button
      type="button"
      onClick={onToggle}
      className="w-full text-left rounded-lg border border-[var(--mc-border)] bg-[color-mix(in_srgb,var(--mc-surface)_92%,white_8%)] px-2.5 py-2 transition-colors hover:border-[var(--mc-border-hover)]"
      aria-expanded={expanded}
    >
      <div className="flex items-start gap-2.5">
        {member.image ? (
          <Image
            src={member.image}
            alt={label}
            width={28}
            height={28}
            unoptimized
            className="h-7 w-7 rounded-full object-cover border border-[var(--mc-border)]"
          />
        ) : (
          <div className="h-7 w-7 rounded-full border border-[var(--mc-border)] bg-[var(--mc-overlay)] flex items-center justify-center text-xs font-semibold">
            {label.charAt(0).toUpperCase()}
          </div>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-medium truncate" style={{ color: 'var(--mc-text-primary)' }}>
              {label}
            </span>
            <span className={`mc-status-dot ${statusClass}`} />
          </div>
          <p className="text-[11px] leading-4 truncate" style={{ color: 'var(--mc-text-secondary)' }}>
            {member.role}
          </p>
        </div>

        <ChevronDown
          className={`h-3.5 w-3.5 transition-transform ${expanded ? 'rotate-180' : ''}`}
          style={{ color: 'var(--mc-text-tertiary)' }}
        />
      </div>

      {expanded && (
        <div className="mt-2.5 border-t border-[var(--mc-border)] pt-2.5 space-y-1.5">
          <p className="text-[11px]" style={{ color: 'var(--mc-text-secondary)' }}>
            Status: {member.isOnline ? 'Online' : 'Offline'} · Last seen {timeAgoFromIso(member.lastSeenAt)}
          </p>
          <p className="text-[11px]" style={{ color: 'var(--mc-text-secondary)' }}>
            Online time: {formatDuration(member.onlineSeconds)} · Active time: {formatDuration(member.activeSeconds)}
          </p>
          <p className="text-[11px]" style={{ color: 'var(--mc-text-secondary)' }}>
            Activity ratio: {activityPercent}%
          </p>
        </div>
      )}
    </button>
  );
}

function AgentCard({
  agent,
  profile,
  expanded,
  onToggle,
}: {
  agent: RuntimeAgentSummary;
  profile?: AgentProfileSummary;
  expanded: boolean;
  onToggle: () => void;
}) {
  const tools = useMemo(() => profile?.tools?.slice(0, 6) || [], [profile?.tools]);
  const cardTitle = agent.name || profile?.displayName || agent.role;
  const runtimeIdentity = [agent.slotKey, agent.laneKey ? `lane ${agent.laneKey}` : null]
    .filter(Boolean)
    .join(' · ');
  const subtitle = profile?.shortDescription || agent.specialization || `${agent.role} agent`;

  return (
    <button
      type="button"
      onClick={onToggle}
      className="w-full text-left rounded-lg border border-[var(--mc-border)] bg-[color-mix(in_srgb,var(--mc-surface)_90%,white_10%)] px-2.5 py-2 transition-colors hover:border-[var(--mc-border-hover)]"
      aria-expanded={expanded}
    >
      <div className="flex items-start gap-2.5">
        <AgentAvatar agent={agent} profile={profile} />

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-medium truncate" style={{ color: 'var(--mc-text-primary)' }}>
              {cardTitle}
            </span>
            <span className={`mc-status-dot ${STATUS_DOTS[agent.status] || 'offline'}`} />
          </div>
          <p className="text-[11px] leading-4 truncate" style={{ color: 'var(--mc-text-secondary)' }}>
            {subtitle}
          </p>
          <p className="text-[10px] leading-4 truncate" style={{ color: 'var(--mc-text-muted)' }}>
            Runtime: {runtimeIdentity}
          </p>
        </div>

        <div className="flex items-center gap-1">
          <span className={`mc-badge ${ROLE_BADGES[agent.role] || ''}`}>{agent.role}</span>
          <ChevronDown
            className={`h-3.5 w-3.5 transition-transform ${expanded ? 'rotate-180' : ''}`}
            style={{ color: 'var(--mc-text-tertiary)' }}
          />
        </div>
      </div>

      {expanded && (
        <div className="mt-2.5 border-t border-[var(--mc-border)] pt-2.5 space-y-2">
          {profile?.mission && (
            <p className="text-[11px] leading-4" style={{ color: 'var(--mc-text-secondary)' }}>
              {profile.mission}
            </p>
          )}
          {tools.length > 0 && (
            <div>
              <p className="mc-header-mono mb-1">Tools</p>
              <ul className="space-y-0.5">
                {tools.map((tool) => (
                  <li
                    key={tool}
                    className="text-[11px] leading-4 truncate"
                    style={{ color: 'var(--mc-text-secondary)' }}
                  >
                    • {tool}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </button>
  );
}
