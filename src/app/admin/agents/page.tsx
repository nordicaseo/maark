'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bot,
  HeartPulse,
  Loader2,
  RefreshCcw,
  Save,
  ShieldCheck,
  UserRound,
} from 'lucide-react';
import { useActiveProject } from '@/hooks/use-active-project';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  AGENT_FILE_KEYS,
  AGENT_KNOWLEDGE_PART_TYPES,
  FIXED_AGENT_ROLES,
  type AgentKnowledgePart,
  type AgentFileKey,
  type AgentRole,
  type ProjectAgentFileBundle,
  type ProjectAgentLaneProfile,
  type ProjectAgentModelOverrides,
  type ProjectAgentProfile,
} from '@/types/agent-profile';
import {
  AGENT_WRITER_LANES,
  DEFAULT_LANE_CAPACITY_SETTINGS,
  type AgentLaneKey,
  type ProjectLaneCapacitySettings,
} from '@/types/agent-runtime';

interface Project {
  id: number;
  name: string;
}

interface HeartbeatResponse {
  runAt: string;
  projectSummary: string;
  suggestedActions: string[];
}

interface AgentProfilesResponse {
  projectId: number;
  seededRoles: AgentRole[];
  profiles: ProjectAgentProfile[];
}

interface AgentLaneProfilesResponse {
  projectId: number;
  seededLaneProfiles: Array<{ role: AgentRole; laneKey: AgentLaneKey }>;
  profiles: ProjectAgentLaneProfile[];
}

interface RuntimePoolHealth {
  projectId: number;
  totalAgents: number;
  totalDedicated: number;
  availableWriters: number;
  queuedWriting: number;
  staleLocks: number;
  writerRows: Array<{
    id: string;
    name: string;
    status: string;
    lockHealth: string;
    currentTaskId: string | null;
    laneKey: AgentLaneKey | null;
    isTemporary?: boolean;
  }>;
  laneHealth: Array<{
    laneKey: AgentLaneKey;
    totalWriters: number;
    availableWriters: number;
    workingWriters: number;
    queuedWriting: number;
    oldestQueueAgeSec: number;
  }>;
}

interface ProfileDraft {
  displayName: string;
  emoji: string;
  avatarUrl: string;
  shortDescription: string;
  mission: string;
  isEnabled: boolean;
  fileBundle: ProjectAgentFileBundle;
  knowledgeParts: AgentKnowledgePart[];
  modelOverrides: ProjectAgentModelOverrides;
}

const FILE_HINTS: Record<AgentFileKey, string> = {
  SOUL: 'Agent personality, non-negotiables, and quality standards.',
  IDENTITY: 'Short identity card (name, mission, role, emoji).',
  HEARTBEAT: 'Manual heartbeat protocol and cadence.',
  AGENTS: 'Collaboration rules and handoff behavior.',
  TOOLS: 'Environment notes, shortcuts, and runtime constraints.',
  MEMORY: 'Long-term notes automatically appended by workflow activity.',
  WORKING: 'Current working state updated by workflow stage events.',
  BOOTSTRAP: 'First-run startup checklist for this role profile.',
};

const EMPTY_FILE_BUNDLE: ProjectAgentFileBundle = {
  SOUL: '',
  IDENTITY: '',
  HEARTBEAT: '',
  AGENTS: '',
  TOOLS: '',
  MEMORY: '',
  WORKING: '',
  BOOTSTRAP: '',
};

function roleLabel(role: AgentRole): string {
  return role
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function laneLabel(lane: AgentLaneKey): string {
  return lane.charAt(0).toUpperCase() + lane.slice(1);
}

function formatDate(value?: string | null) {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '—';
  return parsed.toLocaleString();
}

function mapProfileToDraft(profile: ProjectAgentProfile | null): ProfileDraft {
  if (!profile) {
    return {
      displayName: '',
      emoji: '',
      avatarUrl: '',
      shortDescription: '',
      mission: '',
      isEnabled: true,
      fileBundle: { ...EMPTY_FILE_BUNDLE },
      knowledgeParts: [],
      modelOverrides: {},
    };
  }
  return {
    displayName: profile.displayName || '',
    emoji: profile.emoji || '',
    avatarUrl: profile.avatarUrl || '',
    shortDescription: profile.shortDescription || '',
    mission: profile.mission || '',
    isEnabled: profile.isEnabled,
    fileBundle: { ...EMPTY_FILE_BUNDLE, ...profile.fileBundle },
    knowledgeParts: profile.knowledgeParts || [],
    modelOverrides: profile.modelOverrides || {},
  };
}

function knowledgePartValue(
  parts: AgentKnowledgePart[],
  partType: (typeof AGENT_KNOWLEDGE_PART_TYPES)[number]
): string {
  return parts.find((part) => part.partType === partType)?.content || '';
}

function upsertKnowledgePart(
  parts: AgentKnowledgePart[],
  partType: (typeof AGENT_KNOWLEDGE_PART_TYPES)[number],
  content: string
): AgentKnowledgePart[] {
  const trimmed = content.trim();
  const existing = parts.find((part) => part.partType === partType);
  if (!trimmed) {
    return parts.filter((part) => part.partType !== partType);
  }
  if (existing) {
    return parts.map((part) =>
      part.partType === partType ? { ...part, content: trimmed } : part
    );
  }
  return [
    ...parts,
    {
      id: `${partType}:${parts.length}`,
      partType,
      label: partType.replace(/_/g, ' '),
      content: trimmed,
      sortOrder: parts.length,
    },
  ];
}

export default function AdminAgentsPage() {
  const { activeProjectId, setActiveProjectId } = useActiveProject();
  const [projects, setProjects] = useState<Project[]>([]);
  const [profiles, setProfiles] = useState<ProjectAgentProfile[]>([]);
  const [laneProfiles, setLaneProfiles] = useState<ProjectAgentLaneProfile[]>([]);
  const [seededRoles, setSeededRoles] = useState<AgentRole[]>([]);
  const [seededLanes, setSeededLanes] = useState<Array<{ role: AgentRole; laneKey: AgentLaneKey }>>([]);
  const [selectedRole, setSelectedRole] = useState<AgentRole>('researcher');
  const [selectedLane, setSelectedLane] = useState<AgentLaneKey>('blog');
  const [activeFile, setActiveFile] = useState<AgentFileKey>('SOUL');
  const [laneActiveFile, setLaneActiveFile] = useState<AgentFileKey>('SOUL');
  const [sharedUserContent, setSharedUserContent] = useState('');
  const [heartbeatResult, setHeartbeatResult] = useState<HeartbeatResponse | null>(null);
  const [runtimeHealth, setRuntimeHealth] = useState<RuntimePoolHealth | null>(null);
  const [runtimeBusy, setRuntimeBusy] = useState(false);
  const [heartbeatRunning, setHeartbeatRunning] = useState(false);
  const [generationRunning, setGenerationRunning] = useState(false);
  const [generationDescription, setGenerationDescription] = useState('');
  const [generationUrls, setGenerationUrls] = useState('');
  const [generationFiles, setGenerationFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingLaneProfile, setSavingLaneProfile] = useState(false);
  const [syncingLaneRuntime, setSyncingLaneRuntime] = useState(false);
  const [savingSharedUser, setSavingSharedUser] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [laneCapacity, setLaneCapacity] = useState<ProjectLaneCapacitySettings>({
    ...DEFAULT_LANE_CAPACITY_SETTINGS,
  });

  const selectedProfile = useMemo(
    () => profiles.find((profile) => profile.role === selectedRole) ?? null,
    [profiles, selectedRole]
  );
  const selectedLaneProfile = useMemo(
    () =>
      laneProfiles.find(
        (profile) => profile.role === 'writer' && profile.laneKey === selectedLane
      ) ?? null,
    [laneProfiles, selectedLane]
  );

  const [draft, setDraft] = useState<ProfileDraft>(() => mapProfileToDraft(null));
  const [modelOverridesJson, setModelOverridesJson] = useState('{}');
  const [laneDraft, setLaneDraft] = useState<ProfileDraft>(() => mapProfileToDraft(null));
  const [laneModelOverridesJson, setLaneModelOverridesJson] = useState('{}');

  useEffect(() => {
    setDraft(mapProfileToDraft(selectedProfile));
    setModelOverridesJson(JSON.stringify(selectedProfile?.modelOverrides || {}, null, 2));
  }, [selectedProfile]);

  useEffect(() => {
    setLaneDraft(mapProfileToDraft(selectedLaneProfile));
    setLaneModelOverridesJson(
      JSON.stringify(selectedLaneProfile?.modelOverrides || {}, null, 2)
    );
  }, [selectedLaneProfile]);

  const fetchProjects = useCallback(async () => {
    const res = await fetch('/api/projects');
    if (!res.ok) throw new Error('Failed to load projects');
    const data = (await res.json()) as Project[];
    setProjects(data);
    if (!activeProjectId && data.length > 0) {
      setActiveProjectId(data[0].id);
    }
  }, [activeProjectId, setActiveProjectId]);

  const fetchSharedUserProfile = useCallback(async () => {
    const res = await fetch('/api/admin/agents/shared-user');
    if (!res.ok) throw new Error('Failed to load shared USER profile');
    const data = (await res.json()) as { content?: string };
    setSharedUserContent(data.content || '');
  }, []);

  const fetchProfiles = useCallback(async (projectId: number) => {
    const res = await fetch(`/api/admin/agents?projectId=${projectId}`);
    if (!res.ok) {
      throw new Error('Failed to load agent profiles');
    }
    const data = (await res.json()) as AgentProfilesResponse;
    setProfiles(data.profiles || []);
    setSeededRoles(data.seededRoles || []);
    if (!data.profiles.some((profile) => profile.role === selectedRole) && data.profiles.length > 0) {
      setSelectedRole(data.profiles[0].role);
    }
  }, [selectedRole]);

  const fetchLaneProfiles = useCallback(async (projectId: number) => {
    const res = await fetch(`/api/admin/agents/lanes?projectId=${projectId}`);
    if (!res.ok) {
      throw new Error('Failed to load lane profiles');
    }
    const data = (await res.json()) as AgentLaneProfilesResponse;
    setLaneProfiles(data.profiles || []);
    setSeededLanes(data.seededLaneProfiles || []);
  }, []);

  const fetchProjectRuntimeSettings = useCallback(async (projectId: number) => {
    const res = await fetch(`/api/projects/${projectId}`);
    if (!res.ok) return;
    const project = (await res.json()) as {
      settings?: {
        agentRuntime?: {
          laneCapacity?: Partial<ProjectLaneCapacitySettings>;
        };
      };
    };
    const runtimeLane = project.settings?.agentRuntime?.laneCapacity;
    if (!runtimeLane) {
      setLaneCapacity({ ...DEFAULT_LANE_CAPACITY_SETTINGS });
      return;
    }
    setLaneCapacity({
      minWritersPerLane:
        Number(runtimeLane.minWritersPerLane) || DEFAULT_LANE_CAPACITY_SETTINGS.minWritersPerLane,
      maxWritersPerLane:
        Number(runtimeLane.maxWritersPerLane) || DEFAULT_LANE_CAPACITY_SETTINGS.maxWritersPerLane,
      scaleUpQueueAgeSec:
        Number(runtimeLane.scaleUpQueueAgeSec) ||
        DEFAULT_LANE_CAPACITY_SETTINGS.scaleUpQueueAgeSec,
      scaleDownIdleSec:
        Number(runtimeLane.scaleDownIdleSec) ||
        DEFAULT_LANE_CAPACITY_SETTINGS.scaleDownIdleSec,
    });
  }, []);

  const fetchRuntimeHealth = useCallback(async (projectId: number) => {
    const res = await fetch('/api/admin/agents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'runtime_health',
        projectId,
      }),
    });
    if (!res.ok) {
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(payload.error || 'Failed to load runtime health');
    }
    const payload = (await res.json()) as { health?: RuntimePoolHealth };
    setRuntimeHealth(payload.health || null);
  }, []);

  useEffect(() => {
    setLoading(true);
    Promise.all([fetchProjects(), fetchSharedUserProfile()])
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Failed to load admin agent settings');
      })
      .finally(() => setLoading(false));
  }, [fetchProjects, fetchSharedUserProfile]);

  useEffect(() => {
    if (!activeProjectId) return;
    setLoading(true);
    Promise.all([
      fetchProfiles(activeProjectId),
      fetchLaneProfiles(activeProjectId),
      fetchRuntimeHealth(activeProjectId),
      fetchProjectRuntimeSettings(activeProjectId),
    ])
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Failed to load project agent data');
      })
      .finally(() => setLoading(false));
  }, [
    activeProjectId,
    fetchProfiles,
    fetchLaneProfiles,
    fetchRuntimeHealth,
    fetchProjectRuntimeSettings,
  ]);

  const saveSharedUser = useCallback(async () => {
    setSavingSharedUser(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/agents/shared-user', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: sharedUserContent }),
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error || 'Failed to save USER profile');
      }
      setNotice('Shared USER.md updated.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save USER profile');
    } finally {
      setSavingSharedUser(false);
    }
  }, [sharedUserContent]);

  const saveProfile = useCallback(async () => {
    if (!activeProjectId) return;
    setSavingProfile(true);
    setError(null);
    setNotice(null);
    try {
      let parsedModelOverrides: ProjectAgentModelOverrides = {};
      try {
        parsedModelOverrides = JSON.parse(modelOverridesJson) as ProjectAgentModelOverrides;
      } catch {
        throw new Error('Model overrides must be valid JSON.');
      }
      if (!parsedModelOverrides || typeof parsedModelOverrides !== 'object') {
        throw new Error('Model overrides must be a JSON object.');
      }

      const res = await fetch('/api/admin/agents', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: activeProjectId,
          role: selectedRole,
          displayName: draft.displayName,
          emoji: draft.emoji,
          avatarUrl: draft.avatarUrl,
          shortDescription: draft.shortDescription,
          mission: draft.mission,
          isEnabled: draft.isEnabled,
          fileBundle: draft.fileBundle,
          knowledgeParts: draft.knowledgeParts,
          modelOverrides: parsedModelOverrides,
        }),
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error || 'Failed to save role profile');
      }

      await fetchProfiles(activeProjectId);
      setNotice(`${roleLabel(selectedRole)} profile updated.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save profile');
    } finally {
      setSavingProfile(false);
    }
  }, [activeProjectId, draft, fetchProfiles, modelOverridesJson, selectedRole]);

  const saveLaneProfile = useCallback(async () => {
    if (!activeProjectId) return;
    setSavingLaneProfile(true);
    setError(null);
    setNotice(null);
    try {
      let parsedModelOverrides: ProjectAgentModelOverrides = {};
      try {
        parsedModelOverrides = JSON.parse(laneModelOverridesJson) as ProjectAgentModelOverrides;
      } catch {
        throw new Error('Lane model overrides must be valid JSON.');
      }
      if (!parsedModelOverrides || typeof parsedModelOverrides !== 'object') {
        throw new Error('Lane model overrides must be a JSON object.');
      }

      const res = await fetch('/api/admin/agents/lanes', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: activeProjectId,
          role: 'writer',
          laneKey: selectedLane,
          displayName: laneDraft.displayName,
          emoji: laneDraft.emoji,
          avatarUrl: laneDraft.avatarUrl,
          shortDescription: laneDraft.shortDescription,
          mission: laneDraft.mission,
          isEnabled: laneDraft.isEnabled,
          fileBundle: laneDraft.fileBundle,
          knowledgeParts: laneDraft.knowledgeParts,
          modelOverrides: parsedModelOverrides,
        }),
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error || 'Failed to save lane profile');
      }

      await fetchLaneProfiles(activeProjectId);
      setNotice(`${laneLabel(selectedLane)} lane profile updated.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save lane profile');
    } finally {
      setSavingLaneProfile(false);
    }
  }, [
    activeProjectId,
    fetchLaneProfiles,
    laneDraft,
    laneModelOverridesJson,
    selectedLane,
  ]);

  const runGeneration = useCallback(async () => {
    if (!activeProjectId) return;
    setGenerationRunning(true);
    setError(null);
    setNotice(null);
    try {
      const role = selectedRole;
      const laneKey = role === 'writer' ? selectedLane : undefined;
      if (generationFiles.length > 0) {
        const formData = new FormData();
        formData.set('projectId', String(activeProjectId));
        formData.set('role', role);
        if (laneKey) formData.set('laneKey', laneKey);
        if (generationDescription.trim()) {
          formData.set('description', generationDescription.trim());
        }
        formData.set('apply', 'true');
        for (const file of generationFiles) {
          formData.append('files', file);
        }
        const response = await fetch('/api/admin/agents/generate/from-files', {
          method: 'POST',
          body: formData,
        });
        if (!response.ok) {
          const payload = (await response.json().catch(() => ({}))) as { error?: string };
          throw new Error(payload.error || 'Failed to generate agent profile from files');
        }
      } else {
        const urls = generationUrls
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean)
          .slice(0, 5);
        const response = await fetch('/api/admin/agents/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId: activeProjectId,
            role,
            laneKey,
            description: generationDescription.trim() || undefined,
            urls,
            apply: true,
          }),
        });
        if (!response.ok) {
          const payload = (await response.json().catch(() => ({}))) as { error?: string };
          throw new Error(payload.error || 'Failed to generate agent profile');
        }
      }
      await Promise.all([
        fetchProfiles(activeProjectId),
        fetchLaneProfiles(activeProjectId),
      ]);
      setNotice(
        `Generated and applied agent knowledge for ${roleLabel(selectedRole)}${
          selectedRole === 'writer' ? ` (${laneLabel(selectedLane)} lane)` : ''
        }.`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate agent profile');
    } finally {
      setGenerationRunning(false);
    }
  }, [
    activeProjectId,
    fetchLaneProfiles,
    fetchProfiles,
    generationDescription,
    generationFiles,
    generationUrls,
    selectedLane,
    selectedRole,
  ]);

  const syncLaneRuntime = useCallback(async () => {
    if (!activeProjectId) return;
    setSyncingLaneRuntime(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch('/api/admin/agents/lanes/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: activeProjectId,
          laneCapacity,
        }),
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error || 'Failed to sync lane runtime');
      }
      await Promise.all([
        fetchLaneProfiles(activeProjectId),
        fetchRuntimeHealth(activeProjectId),
      ]);
      setNotice('Lane runtime synced and writer pools refreshed.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to sync lane runtime');
    } finally {
      setSyncingLaneRuntime(false);
    }
  }, [activeProjectId, laneCapacity, fetchLaneProfiles, fetchRuntimeHealth]);

  const runHeartbeat = useCallback(async () => {
    if (!activeProjectId) return;
    setHeartbeatRunning(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch('/api/admin/agents/heartbeat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: activeProjectId }),
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error || 'Failed to run heartbeat');
      }
      const payload = (await res.json()) as HeartbeatResponse;
      setHeartbeatResult(payload);
      setNotice('Heartbeat completed and posted to Mission Control activity stream.');
      await fetchProfiles(activeProjectId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to run heartbeat');
    } finally {
      setHeartbeatRunning(false);
    }
  }, [activeProjectId, fetchProfiles]);

  const syncRuntimeTeam = useCallback(async () => {
    if (!activeProjectId) return;
    setRuntimeBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch('/api/admin/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'sync_runtime',
          projectId: activeProjectId,
        }),
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error || 'Failed to sync runtime team');
      }
      await Promise.all([
        fetchProfiles(activeProjectId),
        fetchLaneProfiles(activeProjectId),
        fetchRuntimeHealth(activeProjectId),
      ]);
      setNotice('Project runtime agent pool synced.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to sync runtime team');
    } finally {
      setRuntimeBusy(false);
    }
  }, [activeProjectId, fetchProfiles, fetchLaneProfiles, fetchRuntimeHealth]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin mr-2" />
        Loading Admin Agents...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Bot className="h-6 w-6" /> Agents
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Configure project role profiles, knowledge, file bundles, model overrides, and heartbeat.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select
            value={activeProjectId ? String(activeProjectId) : ''}
            onValueChange={(value) => setActiveProjectId(Number(value))}
          >
            <SelectTrigger className="w-[220px]">
              <SelectValue placeholder="Select project" />
            </SelectTrigger>
            <SelectContent>
              {projects.map((project) => (
                <SelectItem key={project.id} value={String(project.id)}>
                  {project.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={runHeartbeat} disabled={!activeProjectId || heartbeatRunning}>
            {heartbeatRunning ? (
              <Loader2 className="h-4 w-4 animate-spin mr-1" />
            ) : (
              <HeartPulse className="h-4 w-4 mr-1" />
            )}
            Run Heartbeat
          </Button>
          <Button
            variant="outline"
            onClick={() => activeProjectId && fetchProfiles(activeProjectId)}
            disabled={!activeProjectId}
          >
            <RefreshCcw className="h-4 w-4 mr-1" />
            Refresh
          </Button>
          <Button
            variant="outline"
            onClick={syncRuntimeTeam}
            disabled={!activeProjectId || runtimeBusy}
          >
            {runtimeBusy ? (
              <Loader2 className="h-4 w-4 animate-spin mr-1" />
            ) : (
              <ShieldCheck className="h-4 w-4 mr-1" />
            )}
            Sync Runtime Team
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}
      {notice && (
        <div className="rounded-md border border-emerald-300/40 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {notice}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
        <div className="space-y-4">
          <div className="border border-border rounded-lg bg-card p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold flex items-center gap-2 text-sm">
                <UserRound className="h-4 w-4" /> Shared USER.md
              </h2>
              <Button size="sm" variant="outline" onClick={saveSharedUser} disabled={savingSharedUser}>
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
              onChange={(e) => setSharedUserContent(e.target.value)}
              className="min-h-[180px] text-xs font-mono"
              placeholder="Shared user context for all project role prompts..."
            />
          </div>

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
                    onClick={() => setSelectedRole(role)}
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

          <div className="border border-border rounded-lg bg-card p-4 space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-sm flex items-center gap-2">
                <ShieldCheck className="h-4 w-4" />
                Runtime Pool Health
              </h2>
              <Button
                variant="outline"
                size="sm"
                onClick={() => activeProjectId && fetchRuntimeHealth(activeProjectId)}
                disabled={!activeProjectId || runtimeBusy}
              >
                <RefreshCcw className="h-3.5 w-3.5 mr-1" />
                Refresh
              </Button>
            </div>
            {runtimeHealth ? (
              <div className="space-y-1.5 text-xs text-muted-foreground">
                <p>
                  Total: {runtimeHealth.totalAgents} · Dedicated: {runtimeHealth.totalDedicated}
                </p>
                <p>
                  Available writers: {runtimeHealth.availableWriters} · Queued writing: {runtimeHealth.queuedWriting}
                </p>
                <p>Stale writer locks: {runtimeHealth.staleLocks}</p>
                {runtimeHealth.writerRows.slice(0, 4).map((writer) => (
                  <p key={writer.id} className="truncate">
                    {writer.name}
                    {writer.laneKey ? ` (${laneLabel(writer.laneKey)})` : ''}
                    {' · '}
                    {writer.status}
                    {writer.isTemporary ? ' · temporary' : ''}
                    {' · '}
                    {writer.lockHealth}
                  </p>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">No runtime health loaded.</p>
            )}
          </div>

          <div className="border border-border rounded-lg bg-card p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-sm">Writer Lanes</h2>
              <Button
                size="sm"
                variant="outline"
                onClick={() => activeProjectId && fetchLaneProfiles(activeProjectId)}
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
                    onClick={() => setSelectedLane(lane)}
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

        <div className="space-y-4">
          <div className="border border-border rounded-lg bg-card p-4">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h2 className="text-lg font-semibold">
                  {draft.emoji ? `${draft.emoji} ` : ''}
                  {draft.displayName || roleLabel(selectedRole)}
                </h2>
                <p className="text-xs text-muted-foreground">{roleLabel(selectedRole)}</p>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={draft.isEnabled ? 'default' : 'secondary'}>
                  {draft.isEnabled ? 'Enabled' : 'Disabled'}
                </Badge>
                <Button onClick={saveProfile} disabled={savingProfile || !activeProjectId}>
                  {savingProfile ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-1" />
                  ) : (
                    <Save className="h-4 w-4 mr-1" />
                  )}
                  Save Profile
                </Button>
              </div>
            </div>

            <div className="grid md:grid-cols-3 gap-3 mt-4">
              <div>
                <label className="text-xs font-medium mb-1 block">Display Name</label>
                <Input
                  value={draft.displayName}
                  onChange={(e) => setDraft((prev) => ({ ...prev, displayName: e.target.value }))}
                />
              </div>
              <div>
                <label className="text-xs font-medium mb-1 block">Emoji</label>
                <Input
                  value={draft.emoji}
                  onChange={(e) => setDraft((prev) => ({ ...prev, emoji: e.target.value }))}
                />
              </div>
              <div>
                <label className="text-xs font-medium mb-1 block">Avatar URL</label>
                <Input
                  value={draft.avatarUrl}
                  placeholder="https://..."
                  onChange={(e) =>
                    setDraft((prev) => ({ ...prev, avatarUrl: e.target.value }))
                  }
                />
              </div>
            </div>

            <div className="grid md:grid-cols-2 gap-3 mt-3">
              <div>
                <label className="text-xs font-medium mb-1 block">Short Description</label>
                <Input
                  value={draft.shortDescription}
                  placeholder="What this agent does"
                  onChange={(e) =>
                    setDraft((prev) => ({ ...prev, shortDescription: e.target.value }))
                  }
                />
              </div>
              <div className="flex items-end">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="agent-enabled"
                    checked={draft.isEnabled}
                    onCheckedChange={(checked) =>
                      setDraft((prev) => ({ ...prev, isEnabled: checked === true }))
                    }
                  />
                  <label htmlFor="agent-enabled" className="text-sm">
                    Role enabled
                  </label>
                </div>
              </div>
            </div>

            <div className="mt-3">
              <label className="text-xs font-medium mb-1 block">Mission</label>
              <Textarea
                value={draft.mission}
                onChange={(e) => setDraft((prev) => ({ ...prev, mission: e.target.value }))}
                className="min-h-[72px]"
              />
            </div>

            <div className="mt-3 space-y-2 rounded-md border border-border p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold">Auto Generate Identity + Knowledge</p>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={runGeneration}
                  disabled={!activeProjectId || generationRunning}
                >
                  {generationRunning ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                  ) : (
                    <RefreshCcw className="h-3.5 w-3.5 mr-1" />
                  )}
                  Generate
                </Button>
              </div>
              <Textarea
                value={generationDescription}
                onChange={(e) => setGenerationDescription(e.target.value)}
                className="min-h-[72px] text-xs"
                placeholder="Describe the project, audience, products/services, and writing goals..."
              />
              <Textarea
                value={generationUrls}
                onChange={(e) => setGenerationUrls(e.target.value)}
                className="min-h-[64px] text-xs"
                placeholder="Optional source URLs (one per line)"
              />
              <Input
                type="file"
                multiple
                accept=".txt,.md,.markdown,.csv"
                onChange={(e) => setGenerationFiles(Array.from(e.target.files || []))}
              />
              <p className="text-[11px] text-muted-foreground">
                Uses Super Admin AI model action `skill_generation` for compatibility.
              </p>
            </div>

            <div className="mt-3 text-xs text-muted-foreground">
              Last heartbeat: {formatDate(selectedProfile?.heartbeatMeta?.lastRunAt)}
              {' · '}
              Last memory update: {formatDate(selectedProfile?.heartbeatMeta?.lastMemoryUpdateAt)}
            </div>
          </div>

          <div className="border border-border rounded-lg bg-card p-4">
            <h3 className="font-semibold text-sm mb-2 flex items-center gap-2">
              <ShieldCheck className="h-4 w-4" /> Agent Knowledge
            </h3>
            <p className="text-xs text-muted-foreground mb-3">
              Project-scoped knowledge for this agent role. This is the active instruction layer for workflows.
            </p>
            <div className="space-y-3">
              {AGENT_KNOWLEDGE_PART_TYPES.map((partType) => (
                <div key={`role-knowledge-${partType}`}>
                  <label className="text-xs font-medium mb-1 block capitalize">
                    {partType.replace(/_/g, ' ')}
                  </label>
                  <Textarea
                    value={knowledgePartValue(draft.knowledgeParts, partType)}
                    onChange={(e) =>
                      setDraft((prev) => ({
                        ...prev,
                        knowledgeParts: upsertKnowledgePart(
                          prev.knowledgeParts,
                          partType,
                          e.target.value
                        ),
                      }))
                    }
                    className="min-h-[84px] text-xs"
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="border border-border rounded-lg bg-card p-4">
            <h3 className="font-semibold text-sm mb-2">Model Overrides (JSON)</h3>
            <p className="text-xs text-muted-foreground mb-3">
              Keys can be stage/action names such as `research`, `outline_build`, `writing`, or `workflow`.
            </p>
            <Textarea
              value={modelOverridesJson}
              onChange={(e) => setModelOverridesJson(e.target.value)}
              className="min-h-[180px] font-mono text-xs"
            />
          </div>

          <div className="border border-border rounded-lg bg-card p-4">
            <h3 className="font-semibold text-sm mb-2">Role Workspace Files</h3>
            <Tabs value={activeFile} onValueChange={(value) => setActiveFile(value as AgentFileKey)}>
              <TabsList className="grid grid-cols-4 h-auto gap-1 bg-muted/70 p-1">
                {AGENT_FILE_KEYS.map((key) => (
                  <TabsTrigger key={key} value={key} className="text-[11px] px-2 py-1.5">
                    {key}
                  </TabsTrigger>
                ))}
              </TabsList>
              {AGENT_FILE_KEYS.map((key) => (
                <TabsContent key={key} value={key} className="mt-3">
                  <p className="text-xs text-muted-foreground mb-2">{FILE_HINTS[key]}</p>
                  <Textarea
                    value={draft.fileBundle[key]}
                    onChange={(e) =>
                      setDraft((prev) => ({
                        ...prev,
                        fileBundle: {
                          ...prev.fileBundle,
                          [key]: e.target.value,
                        },
                      }))
                    }
                    className="min-h-[220px] font-mono text-xs"
                  />
                </TabsContent>
              ))}
            </Tabs>
          </div>

          <div className="border border-border rounded-lg bg-card p-4 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h3 className="font-semibold text-sm">
                  Writer Lane Profile: {laneLabel(selectedLane)}
                </h3>
                <p className="text-xs text-muted-foreground">
                  Full file profile, lane knowledge, and model overrides for the {laneLabel(selectedLane)} lane.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  onClick={syncLaneRuntime}
                  disabled={!activeProjectId || syncingLaneRuntime}
                >
                  {syncingLaneRuntime ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-1" />
                  ) : (
                    <ShieldCheck className="h-4 w-4 mr-1" />
                  )}
                  Sync Lanes
                </Button>
                <Button onClick={saveLaneProfile} disabled={savingLaneProfile || !activeProjectId}>
                  {savingLaneProfile ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-1" />
                  ) : (
                    <Save className="h-4 w-4 mr-1" />
                  )}
                  Save Lane
                </Button>
              </div>
            </div>

            <div className="grid md:grid-cols-4 gap-3">
              <div>
                <label className="text-xs font-medium mb-1 block">Min/Lane</label>
                <Input
                  type="number"
                  min={1}
                  max={5}
                  value={laneCapacity.minWritersPerLane}
                  onChange={(e) =>
                    setLaneCapacity((prev) => ({
                      ...prev,
                      minWritersPerLane: Math.max(1, Math.min(5, Number(e.target.value) || 1)),
                    }))
                  }
                />
              </div>
              <div>
                <label className="text-xs font-medium mb-1 block">Max/Lane</label>
                <Input
                  type="number"
                  min={1}
                  max={8}
                  value={laneCapacity.maxWritersPerLane}
                  onChange={(e) =>
                    setLaneCapacity((prev) => ({
                      ...prev,
                      maxWritersPerLane: Math.max(
                        prev.minWritersPerLane,
                        Math.min(8, Number(e.target.value) || prev.minWritersPerLane)
                      ),
                    }))
                  }
                />
              </div>
              <div>
                <label className="text-xs font-medium mb-1 block">Scale Up Queue Age (sec)</label>
                <Input
                  type="number"
                  min={30}
                  max={3600}
                  value={laneCapacity.scaleUpQueueAgeSec}
                  onChange={(e) =>
                    setLaneCapacity((prev) => ({
                      ...prev,
                      scaleUpQueueAgeSec: Math.max(
                        30,
                        Math.min(3600, Number(e.target.value) || prev.scaleUpQueueAgeSec)
                      ),
                    }))
                  }
                />
              </div>
              <div>
                <label className="text-xs font-medium mb-1 block">Scale Down Idle (sec)</label>
                <Input
                  type="number"
                  min={300}
                  max={86400}
                  value={laneCapacity.scaleDownIdleSec}
                  onChange={(e) =>
                    setLaneCapacity((prev) => ({
                      ...prev,
                      scaleDownIdleSec: Math.max(
                        300,
                        Math.min(86400, Number(e.target.value) || prev.scaleDownIdleSec)
                      ),
                    }))
                  }
                />
              </div>
            </div>

            <div className="grid md:grid-cols-3 gap-3">
              <div>
                <label className="text-xs font-medium mb-1 block">Display Name</label>
                <Input
                  value={laneDraft.displayName}
                  onChange={(e) =>
                    setLaneDraft((prev) => ({ ...prev, displayName: e.target.value }))
                  }
                />
              </div>
              <div>
                <label className="text-xs font-medium mb-1 block">Emoji</label>
                <Input
                  value={laneDraft.emoji}
                  onChange={(e) =>
                    setLaneDraft((prev) => ({ ...prev, emoji: e.target.value }))
                  }
                />
              </div>
              <div>
                <label className="text-xs font-medium mb-1 block">Avatar URL</label>
                <Input
                  value={laneDraft.avatarUrl}
                  placeholder="https://..."
                  onChange={(e) =>
                    setLaneDraft((prev) => ({ ...prev, avatarUrl: e.target.value }))
                  }
                />
              </div>
            </div>

            <div className="grid md:grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium mb-1 block">Short Description</label>
                <Input
                  value={laneDraft.shortDescription}
                  onChange={(e) =>
                    setLaneDraft((prev) => ({ ...prev, shortDescription: e.target.value }))
                  }
                />
              </div>
              <div className="flex items-end">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="lane-enabled"
                    checked={laneDraft.isEnabled}
                    onCheckedChange={(checked) =>
                      setLaneDraft((prev) => ({ ...prev, isEnabled: checked === true }))
                    }
                  />
                  <label htmlFor="lane-enabled" className="text-sm">
                    Lane enabled
                  </label>
                </div>
              </div>
            </div>

            <div>
              <label className="text-xs font-medium mb-1 block">Mission</label>
              <Textarea
                value={laneDraft.mission}
                onChange={(e) =>
                  setLaneDraft((prev) => ({ ...prev, mission: e.target.value }))
                }
                className="min-h-[72px]"
              />
            </div>

            <div>
              <h4 className="font-semibold text-sm mb-2">Lane Knowledge</h4>
              <div className="space-y-3">
                {AGENT_KNOWLEDGE_PART_TYPES.map((partType) => (
                  <div key={`lane-knowledge-${partType}`}>
                    <label className="text-xs font-medium mb-1 block capitalize">
                      {partType.replace(/_/g, ' ')}
                    </label>
                    <Textarea
                      value={knowledgePartValue(laneDraft.knowledgeParts, partType)}
                      onChange={(e) =>
                        setLaneDraft((prev) => ({
                          ...prev,
                          knowledgeParts: upsertKnowledgePart(
                            prev.knowledgeParts,
                            partType,
                            e.target.value
                          ),
                        }))
                      }
                      className="min-h-[84px] text-xs"
                    />
                  </div>
                ))}
              </div>
            </div>

            <div>
              <h4 className="font-semibold text-sm mb-2">Lane Model Overrides (JSON)</h4>
              <Textarea
                value={laneModelOverridesJson}
                onChange={(e) => setLaneModelOverridesJson(e.target.value)}
                className="min-h-[160px] font-mono text-xs"
              />
            </div>

            <div>
              <h4 className="font-semibold text-sm mb-2">Lane Workspace Files</h4>
              <Tabs
                value={laneActiveFile}
                onValueChange={(value) => setLaneActiveFile(value as AgentFileKey)}
              >
                <TabsList className="grid grid-cols-4 h-auto gap-1 bg-muted/70 p-1">
                  {AGENT_FILE_KEYS.map((key) => (
                    <TabsTrigger key={`lane-tab-${key}`} value={key} className="text-[11px] px-2 py-1.5">
                      {key}
                    </TabsTrigger>
                  ))}
                </TabsList>
                {AGENT_FILE_KEYS.map((key) => (
                  <TabsContent key={`lane-content-${key}`} value={key} className="mt-3">
                    <p className="text-xs text-muted-foreground mb-2">{FILE_HINTS[key]}</p>
                    <Textarea
                      value={laneDraft.fileBundle[key]}
                      onChange={(e) =>
                        setLaneDraft((prev) => ({
                          ...prev,
                          fileBundle: {
                            ...prev.fileBundle,
                            [key]: e.target.value,
                          },
                        }))
                      }
                      className="min-h-[220px] font-mono text-xs"
                    />
                  </TabsContent>
                ))}
              </Tabs>
            </div>
          </div>

          {heartbeatResult && (
            <div className="border border-border rounded-lg bg-card p-4">
              <h3 className="font-semibold text-sm mb-1">Last Heartbeat Result</h3>
              <p className="text-xs text-muted-foreground">
                {formatDate(heartbeatResult.runAt)} · {heartbeatResult.projectSummary}
              </p>
              {heartbeatResult.suggestedActions?.length > 0 && (
                <ul className="mt-2 list-disc pl-5 text-sm space-y-1">
                  {heartbeatResult.suggestedActions.map((action) => (
                    <li key={action}>{action}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
