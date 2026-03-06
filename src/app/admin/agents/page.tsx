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
  FIXED_AGENT_ROLES,
  type AgentFileKey,
  type AgentRole,
  type ProjectAgentFileBundle,
  type ProjectAgentModelOverrides,
  type ProjectAgentProfile,
} from '@/types/agent-profile';

interface Project {
  id: number;
  name: string;
}

interface Skill {
  id: number;
  projectId: number | null;
  name: string;
  isGlobal: number;
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

interface ProfileDraft {
  displayName: string;
  emoji: string;
  avatarUrl: string;
  shortDescription: string;
  mission: string;
  isEnabled: boolean;
  fileBundle: ProjectAgentFileBundle;
  skillIds: number[];
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
      skillIds: [],
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
    skillIds: profile.skillIds || [],
    modelOverrides: profile.modelOverrides || {},
  };
}

export default function AdminAgentsPage() {
  const { activeProjectId, setActiveProjectId } = useActiveProject();
  const [projects, setProjects] = useState<Project[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [profiles, setProfiles] = useState<ProjectAgentProfile[]>([]);
  const [seededRoles, setSeededRoles] = useState<AgentRole[]>([]);
  const [selectedRole, setSelectedRole] = useState<AgentRole>('researcher');
  const [activeFile, setActiveFile] = useState<AgentFileKey>('SOUL');
  const [sharedUserContent, setSharedUserContent] = useState('');
  const [heartbeatResult, setHeartbeatResult] = useState<HeartbeatResponse | null>(null);
  const [heartbeatRunning, setHeartbeatRunning] = useState(false);
  const [loading, setLoading] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingSharedUser, setSavingSharedUser] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedProfile = useMemo(
    () => profiles.find((profile) => profile.role === selectedRole) ?? null,
    [profiles, selectedRole]
  );

  const [draft, setDraft] = useState<ProfileDraft>(() => mapProfileToDraft(null));
  const [modelOverridesJson, setModelOverridesJson] = useState('{}');

  useEffect(() => {
    setDraft(mapProfileToDraft(selectedProfile));
    setModelOverridesJson(JSON.stringify(selectedProfile?.modelOverrides || {}, null, 2));
  }, [selectedProfile]);

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

  const fetchSkills = useCallback(async (projectId: number) => {
    const res = await fetch(`/api/skills?projectId=${projectId}`);
    if (!res.ok) throw new Error('Failed to load skills');
    const data = (await res.json()) as Skill[];
    setSkills(data);
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
    Promise.all([fetchProfiles(activeProjectId), fetchSkills(activeProjectId)])
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Failed to load project agent data');
      })
      .finally(() => setLoading(false));
  }, [activeProjectId, fetchProfiles, fetchSkills]);

  const toggleSkill = useCallback((skillId: number, checked: boolean) => {
    setDraft((prev) => {
      const set = new Set(prev.skillIds);
      if (checked) set.add(skillId);
      else set.delete(skillId);
      return { ...prev, skillIds: Array.from(set) };
    });
  }, []);

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
          skillIds: draft.skillIds,
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
            Configure project role profiles, file bundles, skills, model overrides, and heartbeat.
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

            <div className="mt-3 text-xs text-muted-foreground">
              Last heartbeat: {formatDate(selectedProfile?.heartbeatMeta?.lastRunAt)}
              {' · '}
              Last memory update: {formatDate(selectedProfile?.heartbeatMeta?.lastMemoryUpdateAt)}
            </div>
          </div>

          <div className="border border-border rounded-lg bg-card p-4">
            <h3 className="font-semibold text-sm mb-2 flex items-center gap-2">
              <ShieldCheck className="h-4 w-4" /> Role Skill Mapping
            </h3>
            <p className="text-xs text-muted-foreground mb-3">
              Role-mapped skills are injected first for this role before task/project/global skill fallback.
            </p>
            <div className="grid md:grid-cols-2 gap-2">
              {skills.map((skill) => {
                const checked = draft.skillIds.includes(skill.id);
                return (
                  <label
                    key={skill.id}
                    className="flex items-center gap-2 border border-border rounded-md px-2 py-2 text-sm"
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(value) => toggleSkill(skill.id, value === true)}
                    />
                    <span className="truncate">{skill.name}</span>
                    {skill.isGlobal === 1 && (
                      <Badge variant="outline" className="ml-auto text-[10px]">
                        Global
                      </Badge>
                    )}
                  </label>
                );
              })}
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
