'use client';

import { Loader2, RefreshCcw, Save, UserRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  FIXED_AGENT_ROLES,
  type AgentRole,
  type ProjectAgentProfile,
  type ProjectAgentLaneProfile,
} from '@/types/agent-profile';
import { AGENT_WRITER_LANES, type AgentLaneKey } from '@/types/agent-runtime';
import { roleLabel, laneLabel } from '../_lib/agent-helpers';

interface RuntimePoolHealth {
  laneHealth: Array<{
    laneKey: AgentLaneKey;
    availableWriters: number;
    queuedWriting: number;
  }>;
}

interface AgentSidebarProps {
  profiles: ProjectAgentProfile[];
  laneProfiles: ProjectAgentLaneProfile[];
  seededRoles: AgentRole[];
  seededLanes: Array<{ role: AgentRole; laneKey: AgentLaneKey }>;
  selectedRole: AgentRole;
  selectedLane: AgentLaneKey;
  sharedUserContent: string;
  savingSharedUser: boolean;
  runtimeHealth: RuntimePoolHealth | null;
  activeProjectId: number | null;
  onSelectRole: (role: AgentRole) => void;
  onSelectLane: (lane: AgentLaneKey) => void;
  onSharedUserChange: (content: string) => void;
  onSaveSharedUser: () => void;
  onRefreshLanes: () => void;
}

export function AgentSidebar({
  profiles,
  laneProfiles,
  seededRoles,
  seededLanes,
  selectedRole,
  selectedLane,
  sharedUserContent,
  savingSharedUser,
  runtimeHealth,
  activeProjectId,
  onSelectRole,
  onSelectLane,
  onSharedUserChange,
  onSaveSharedUser,
  onRefreshLanes,
}: AgentSidebarProps) {
  return (
    <div className="space-y-4">
      {/* Shared USER.md */}
      <div className="border border-border rounded-lg bg-card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold flex items-center gap-2 text-sm">
            <UserRound className="h-4 w-4" /> Shared USER.md
          </h2>
          <Button size="sm" variant="outline" onClick={onSaveSharedUser} disabled={savingSharedUser}>
            {savingSharedUser ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
            ) : (
              <Save className="h-3.5 w-3.5 mr-1" />
            )}
            Save
          </Button>
        </div>
        <Textarea
          value={sharedUserContent}
          onChange={(e) => onSharedUserChange(e.target.value)}
          className="min-h-[180px] text-xs font-mono"
          placeholder="Shared user context for all project role prompts..."
        />
      </div>

      {/* Role Profiles List */}
      <div className="border border-border rounded-lg bg-card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-sm">Role Profiles</h2>
          <Badge variant="outline">{profiles.length}</Badge>
        </div>
        {seededRoles.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Seeded: {seededRoles.map((role) => roleLabel(role)).join(', ')}
          </p>
        )}
        <div className="space-y-2">
          {FIXED_AGENT_ROLES.map((role) => {
            const profile = profiles.find((item) => item.role === role);
            const active = selectedRole === role;
            return (
              <button
                key={role}
                onClick={() => onSelectRole(role)}
                className={`w-full rounded-md border px-3 py-2 text-left transition-colors ${
                  active
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:bg-accent/40'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium text-sm truncate">
                      {(profile?.emoji || '') + ' '}
                      {profile?.displayName || roleLabel(role)}
                    </p>
                    <p className="text-[11px] text-muted-foreground truncate">{roleLabel(role)}</p>
                  </div>
                  <Badge variant={profile?.isEnabled === false ? 'secondary' : 'default'}>
                    {profile?.isEnabled === false ? 'Disabled' : 'Enabled'}
                  </Badge>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Writer Lanes */}
      <div className="border border-border rounded-lg bg-card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-sm">Writer Lanes</h2>
          <Button
            size="sm"
            variant="outline"
            onClick={onRefreshLanes}
            disabled={!activeProjectId}
          >
            <RefreshCcw className="h-3.5 w-3.5 mr-1" />
            Refresh
          </Button>
        </div>
        {seededLanes.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Seeded lanes: {seededLanes.map((item) => laneLabel(item.laneKey)).join(', ')}
          </p>
        )}
        <div className="grid grid-cols-2 gap-2">
          {AGENT_WRITER_LANES.map((lane) => {
            const laneProfile = laneProfiles.find((profile) => profile.laneKey === lane);
            const health = runtimeHealth?.laneHealth?.find((item) => item.laneKey === lane);
            const active = selectedLane === lane;
            return (
              <button
                key={lane}
                onClick={() => onSelectLane(lane)}
                className={`rounded-md border px-3 py-2 text-left transition-colors ${
                  active ? 'border-primary bg-primary/5' : 'border-border hover:bg-accent/40'
                }`}
              >
                <p className="text-sm font-medium truncate">
                  {laneProfile?.emoji ? `${laneProfile.emoji} ` : ''}
                  {laneLabel(lane)}
                </p>
                <p className="text-[11px] text-muted-foreground truncate">
                  {laneProfile?.displayName || `Writer ${laneLabel(lane)}`}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  avail {health?.availableWriters ?? 0} · queued {health?.queuedWriting ?? 0}
                </p>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
