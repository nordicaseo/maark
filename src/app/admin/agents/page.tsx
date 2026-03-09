'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bot, Loader2, RefreshCcw } from 'lucide-react';
import { useActiveProject } from '@/hooks/use-active-project';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type {
  AgentRole,
  ProjectAgentLaneProfile,
  ProjectAgentModelOverrides,
  ProjectAgentProfile,
} from '@/types/agent-profile';
import {
  DEFAULT_LANE_CAPACITY_SETTINGS,
  type AgentLaneKey,
  type ProjectLaneCapacitySettings,
} from '@/types/agent-runtime';
import { mapProfileToDraft, roleLabel, laneLabel } from './_lib/agent-helpers';
import { AgentSidebar } from './_components/agent-sidebar';
import { ProfileTab } from './_components/profile-tab';
import { WorkspaceFilesTab } from './_components/workspace-files-tab';
import { WriterLanesTab } from './_components/writer-lanes-tab';
import { RuntimeTab } from './_components/runtime-tab';

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

export default function AdminAgentsPage() {
  const { activeProjectId, setActiveProjectId } = useActiveProject();
  const [projects, setProjects] = useState<Project[]>([]);
  const [profiles, setProfiles] = useState<ProjectAgentProfile[]>([]);
  const [laneProfiles, setLaneProfiles] = useState<ProjectAgentLaneProfile[]>([]);
  const [seededRoles, setSeededRoles] = useState<AgentRole[]>([]);
  const [seededLanes, setSeededLanes] = useState<Array<{ role: AgentRole; laneKey: AgentLaneKey }>>([]);
  const [selectedRole, setSelectedRole] = useState<AgentRole>('researcher');
  const [selectedLane, setSelectedLane] = useState<AgentLaneKey>('blog');
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

  const [draft, setDraft] = useState(() => mapProfileToDraft(null));
  const [modelOverridesJson, setModelOverridesJson] = useState('{}');
  const [laneDraft, setLaneDraft] = useState(() => mapProfileToDraft(null));
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

  // ── Data fetching ──────────────────────────────────────────────

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

  // ── Actions ────────────────────────────────────────────────────

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

  // ── Render ─────────────────────────────────────────────────────

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
      {/* Page Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Bot className="h-6 w-6" /> Agents
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Configure project role profiles, knowledge, file bundles, model overrides, and runtime.
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
          <Button
            variant="outline"
            onClick={() => activeProjectId && fetchProfiles(activeProjectId)}
            disabled={!activeProjectId}
          >
            <RefreshCcw className="h-4 w-4 mr-1" />
            Refresh
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

      {/* Sidebar + Tabs Layout */}
      <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
        {/* Sidebar */}
        <AgentSidebar
          profiles={profiles}
          laneProfiles={laneProfiles}
          seededRoles={seededRoles}
          seededLanes={seededLanes}
          selectedRole={selectedRole}
          selectedLane={selectedLane}
          sharedUserContent={sharedUserContent}
          savingSharedUser={savingSharedUser}
          runtimeHealth={runtimeHealth}
          activeProjectId={activeProjectId}
          onSelectRole={setSelectedRole}
          onSelectLane={setSelectedLane}
          onSharedUserChange={setSharedUserContent}
          onSaveSharedUser={saveSharedUser}
          onRefreshLanes={() => activeProjectId && fetchLaneProfiles(activeProjectId)}
        />

        {/* Main Content Tabs */}
        <Tabs defaultValue="profile" className="space-y-4">
          <TabsList className="h-auto gap-1 bg-muted/70 p-1">
            <TabsTrigger value="profile" className="text-xs px-3 py-1.5">
              Profile
            </TabsTrigger>
            <TabsTrigger value="files" className="text-xs px-3 py-1.5">
              Files & Generation
            </TabsTrigger>
            <TabsTrigger value="lanes" className="text-xs px-3 py-1.5">
              Writer Lanes
            </TabsTrigger>
            <TabsTrigger value="runtime" className="text-xs px-3 py-1.5">
              Runtime
            </TabsTrigger>
          </TabsList>

          <TabsContent value="profile">
            <ProfileTab
              selectedRole={selectedRole}
              selectedProfile={selectedProfile}
              draft={draft}
              onDraftChange={setDraft}
              modelOverridesJson={modelOverridesJson}
              onModelOverridesJsonChange={setModelOverridesJson}
              savingProfile={savingProfile}
              onSaveProfile={saveProfile}
              activeProjectId={activeProjectId}
            />
          </TabsContent>

          <TabsContent value="files">
            <WorkspaceFilesTab
              draft={draft}
              onDraftChange={setDraft}
              generationRunning={generationRunning}
              onRunGeneration={runGeneration}
              generationDescription={generationDescription}
              onGenerationDescriptionChange={setGenerationDescription}
              generationUrls={generationUrls}
              onGenerationUrlsChange={setGenerationUrls}
              onGenerationFilesChange={setGenerationFiles}
              activeProjectId={activeProjectId}
            />
          </TabsContent>

          <TabsContent value="lanes">
            <WriterLanesTab
              selectedRole={selectedRole}
              selectedLane={selectedLane}
              laneDraft={laneDraft}
              onLaneDraftChange={setLaneDraft}
              laneModelOverridesJson={laneModelOverridesJson}
              onLaneModelOverridesJsonChange={setLaneModelOverridesJson}
              laneCapacity={laneCapacity}
              onLaneCapacityChange={setLaneCapacity}
              savingLaneProfile={savingLaneProfile}
              syncingLaneRuntime={syncingLaneRuntime}
              onSaveLaneProfile={saveLaneProfile}
              onSyncLaneRuntime={syncLaneRuntime}
              activeProjectId={activeProjectId}
            />
          </TabsContent>

          <TabsContent value="runtime">
            <RuntimeTab
              runtimeHealth={runtimeHealth}
              heartbeatResult={heartbeatResult}
              heartbeatRunning={heartbeatRunning}
              runtimeBusy={runtimeBusy}
              activeProjectId={activeProjectId}
              onRunHeartbeat={runHeartbeat}
              onSyncRuntime={syncRuntimeTeam}
              onRefreshHealth={() => activeProjectId && fetchRuntimeHealth(activeProjectId)}
            />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
