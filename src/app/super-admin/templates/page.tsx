'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Save, Settings2, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type {
  ContentTemplateConfig,
  TemplateAssignment,
} from '@/types/content-template-config';
import { CONTENT_FORMAT_LABELS, type ContentFormat } from '@/types/document';
import { resolveLaneFromContentType } from '@/lib/content-workflow-taxonomy';
import {
  ROUTABLE_WORKFLOW_STAGES,
  type RoutableWorkflowStage,
} from '@/types/workflow-routing';
import type { AgentLaneKey } from '@/types/agent-runtime';

interface Project {
  id: number;
  name: string;
}

interface WorkflowRouteConfig {
  id: number;
  projectId: number;
  contentFormat: ContentFormat;
  laneKey: AgentLaneKey;
  stageSlots: Record<RoutableWorkflowStage, string>;
  stageEnabled: Record<RoutableWorkflowStage, boolean>;
}

interface RoutingRuntimeAgent {
  id: string;
  name: string;
  role: string;
  status: string;
  slotKey: string;
  laneKey: string;
  currentTaskId: string | null;
}

const CONTENT_FORMAT_OPTIONS = Object.entries(CONTENT_FORMAT_LABELS) as Array<
  [ContentFormat, string]
>;

const STAGE_LABELS: Record<RoutableWorkflowStage, string> = {
  research: 'Research',
  seo_intel_review: 'SERP',
  outline_build: 'Outline',
  writing: 'Writing',
  editing: 'Editing',
  final_review: 'SEO Review',
};

const STAGE_REQUIRED_ROLE: Record<RoutableWorkflowStage, string> = {
  research: 'researcher',
  seo_intel_review: 'seo',
  outline_build: 'outliner',
  writing: 'writer',
  editing: 'editor',
  final_review: 'seo-reviewer',
};

function emptyTemplate(): ContentTemplateConfig {
  return {
    id: 0,
    key: '',
    name: '',
    description: '',
    contentFormats: ['blog_post'],
    structure: { sections: [] },
    wordRange: { min: 1200, max: 2500 },
    outlineConstraints: { maxH2: 8, maxH3PerH2: 3 },
    styleGuard: {
      emDash: 'forbid',
      colon: 'structural_only',
      maxNarrativeColons: 0,
    },
    isSystem: false,
    isActive: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export default function SuperAdminTemplatesPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  const [templates, setTemplates] = useState<ContentTemplateConfig[]>([]);
  const [assignments, setAssignments] = useState<TemplateAssignment[]>([]);
  const [routingRoutes, setRoutingRoutes] = useState<WorkflowRouteConfig[]>([]);
  const [routingAgents, setRoutingAgents] = useState<RoutingRuntimeAgent[]>([]);
  const [routingSavingFormat, setRoutingSavingFormat] = useState<ContentFormat | null>(null);
  const [selectedTemplateKey, setSelectedTemplateKey] = useState<string>('');
  const [draft, setDraft] = useState<ContentTemplateConfig>(() => emptyTemplate());

  const selectedTemplate = useMemo(
    () => templates.find((template) => template.key === selectedTemplateKey) ?? null,
    [templates, selectedTemplateKey]
  );

  useEffect(() => {
    if (!selectedTemplate) {
      setDraft(emptyTemplate());
      return;
    }
    setDraft(selectedTemplate);
  }, [selectedTemplate]);

  const refreshData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const requests: Promise<Response>[] = [
        fetch('/api/projects'),
        fetch('/api/super-admin/templates'),
        fetch(
          selectedProjectId
            ? `/api/super-admin/templates/assignments?projectId=${selectedProjectId}`
            : '/api/super-admin/templates/assignments'
        ),
      ];
      if (selectedProjectId) {
        requests.push(fetch(`/api/admin/agents/routing?projectId=${selectedProjectId}`));
      }
      const [projectsRes, templatesRes, assignmentsRes, routingRes] = await Promise.all(requests);

      if (
        !projectsRes.ok ||
        !templatesRes.ok ||
        !assignmentsRes.ok ||
        (selectedProjectId && (!routingRes || !routingRes.ok))
      ) {
        throw new Error('Failed to load templates data');
      }

      const projectsData = (await projectsRes.json()) as Project[];
      const templatesData = (await templatesRes.json()) as {
        templates: ContentTemplateConfig[];
      };
      const assignmentData = (await assignmentsRes.json()) as TemplateAssignment[];
      const routingData = routingRes
        ? ((await routingRes.json()) as {
            routes?: WorkflowRouteConfig[];
            runtimeAgents?: RoutingRuntimeAgent[];
          })
        : null;

      setProjects(projectsData);
      setTemplates(templatesData.templates || []);
      setAssignments(assignmentData || []);
      setRoutingRoutes(routingData?.routes || []);
      setRoutingAgents(routingData?.runtimeAgents || []);

      if (!selectedTemplateKey && templatesData.templates?.length) {
        setSelectedTemplateKey(templatesData.templates[0].key);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load templates');
    } finally {
      setLoading(false);
    }
  }, [selectedProjectId, selectedTemplateKey]);

  useEffect(() => {
    void refreshData();
  }, [refreshData]);

  const saveTemplate = useCallback(async () => {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch('/api/super-admin/templates', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error || 'Failed to save template');
      }

      const saved = (await response.json()) as ContentTemplateConfig;
      setSelectedTemplateKey(saved.key);
      setNotice(`Template "${saved.name}" saved.`);
      await refreshData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save template');
    } finally {
      setSaving(false);
    }
  }, [draft, refreshData]);

  const upsertAssignment = useCallback(
    async (contentFormat: ContentFormat, templateKey: string, scope: 'global' | 'project') => {
      setSaving(true);
      setError(null);
      setNotice(null);
      try {
        const response = await fetch('/api/super-admin/templates/assignments', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contentFormat,
            templateKey,
            projectId: scope === 'project' ? selectedProjectId : null,
          }),
        });
        if (!response.ok) {
          const payload = (await response.json().catch(() => ({}))) as { error?: string };
          throw new Error(payload.error || 'Failed to save assignment');
        }
        setNotice(
          `Assignment saved: ${CONTENT_FORMAT_LABELS[contentFormat]} -> ${templateKey} (${scope}).`
        );
        await refreshData();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to save assignment');
      } finally {
        setSaving(false);
      }
    },
    [refreshData, selectedProjectId]
  );

  const assignmentMap = useMemo(() => {
    const map = new Map<string, TemplateAssignment>();
    for (const assignment of assignments) {
      const key = `${assignment.scope}:${assignment.projectId ?? 'global'}:${assignment.contentFormat}`;
      map.set(key, assignment);
    }
    return map;
  }, [assignments]);

  const routeByFormat = useMemo(() => {
    const map = new Map<ContentFormat, WorkflowRouteConfig>();
    for (const route of routingRoutes) {
      map.set(route.contentFormat, route);
    }
    return map;
  }, [routingRoutes]);

  const saveRouteForFormat = useCallback(
    async (
      contentFormat: ContentFormat,
      next: {
        laneKey: AgentLaneKey;
        stageSlots: Partial<Record<RoutableWorkflowStage, string>>;
        stageEnabled: Partial<Record<RoutableWorkflowStage, boolean>>;
      }
    ) => {
      if (!selectedProjectId) return;
      setRoutingSavingFormat(contentFormat);
      setError(null);
      setNotice(null);
      try {
        const response = await fetch('/api/admin/agents/routing', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId: selectedProjectId,
            contentFormat,
            laneKey: next.laneKey,
            stageSlots: next.stageSlots,
            stageEnabled: next.stageEnabled,
          }),
        });
        if (!response.ok) {
          const payload = (await response.json().catch(() => ({}))) as { error?: string };
          throw new Error(payload.error || 'Failed to update workflow route');
        }
        const updated = (await response.json()) as WorkflowRouteConfig;
        setRoutingRoutes((prev) => {
          const without = prev.filter((route) => route.contentFormat !== contentFormat);
          return [...without, updated];
        });
        setNotice(`Workflow route updated for ${CONTENT_FORMAT_LABELS[contentFormat]}.`);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to update workflow route');
      } finally {
        setRoutingSavingFormat(null);
      }
    },
    [selectedProjectId]
  );

  const saveRouteStageSlot = useCallback(
    async (
      contentFormat: ContentFormat,
      stage: RoutableWorkflowStage,
      slotKey: string,
      laneKey: AgentLaneKey
    ) => {
      const route = routeByFormat.get(contentFormat);
      const stageSlots = {
        ...(route?.stageSlots || ({} as Record<RoutableWorkflowStage, string>)),
        [stage]: slotKey,
      };
      const stageEnabled = {
        ...(route?.stageEnabled || ({} as Record<RoutableWorkflowStage, boolean>)),
      };
      await saveRouteForFormat(contentFormat, { laneKey, stageSlots, stageEnabled });
    },
    [routeByFormat, saveRouteForFormat]
  );

  const saveRouteStageEnabled = useCallback(
    async (
      contentFormat: ContentFormat,
      stage: RoutableWorkflowStage,
      enabled: boolean,
      laneKey: AgentLaneKey
    ) => {
      const route = routeByFormat.get(contentFormat);
      const stageSlots = {
        ...(route?.stageSlots || ({} as Record<RoutableWorkflowStage, string>)),
      };
      const stageEnabled = {
        ...(route?.stageEnabled || ({} as Record<RoutableWorkflowStage, boolean>)),
        [stage]: enabled,
      };
      await saveRouteForFormat(contentFormat, { laneKey, stageSlots, stageEnabled });
    },
    [routeByFormat, saveRouteForFormat]
  );

  const optionsForStage = useCallback(
    (stage: RoutableWorkflowStage, laneKey: AgentLaneKey) => {
      const requiredRole = STAGE_REQUIRED_ROLE[stage];
      return routingAgents
        .filter((agent) => {
          if (agent.role.toLowerCase() !== requiredRole) return false;
          if (stage === 'writing' && laneKey && agent.laneKey !== laneKey) return false;
          return agent.slotKey.trim().length > 0;
        })
        .sort((a, b) => a.name.localeCompare(b.name));
    },
    [routingAgents]
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin mr-2" />
        Loading templates...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Sparkles className="h-6 w-6" />
            Content Templates
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Configure template structure, length policy, style guardrails, and content-format mapping.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select
            value={selectedProjectId ? String(selectedProjectId) : 'none'}
            onValueChange={(value) => setSelectedProjectId(value === 'none' ? null : Number(value))}
          >
            <SelectTrigger className="w-[240px]">
              <SelectValue placeholder="Project override scope" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No project override</SelectItem>
              {projects.map((project) => (
                <SelectItem key={project.id} value={String(project.id)}>
                  {project.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            onClick={() => {
              setSelectedTemplateKey('');
              setDraft(emptyTemplate());
            }}
          >
            New Template
          </Button>
          <Button onClick={saveTemplate} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}
            Save Template
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

      <div className="grid gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
        <div className="border border-border rounded-lg bg-card p-4 space-y-2">
          <h2 className="font-semibold text-sm">Template Library</h2>
          {templates.map((template) => (
            <button
              key={template.key}
              onClick={() => setSelectedTemplateKey(template.key)}
              className={`w-full rounded-md border px-3 py-2 text-left transition-colors ${
                template.key === selectedTemplateKey
                  ? 'border-primary bg-primary/5'
                  : 'border-border hover:bg-accent/30'
              }`}
            >
              <p className="font-medium text-sm truncate">{template.name}</p>
              <p className="text-[11px] text-muted-foreground truncate">{template.key}</p>
            </button>
          ))}
        </div>

        <div className="space-y-4">
          <div className="border border-border rounded-lg bg-card p-4 space-y-3">
            <h2 className="font-semibold text-sm flex items-center gap-2">
              <Settings2 className="h-4 w-4" /> Template Settings
            </h2>
            <div className="grid md:grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium mb-1 block">Template Key</label>
                <Input
                  value={draft.key}
                  onChange={(e) => setDraft((prev) => ({ ...prev, key: e.target.value.trim().toLowerCase() }))}
                  placeholder="blog_standard"
                />
              </div>
              <div>
                <label className="text-xs font-medium mb-1 block">Template Name</label>
                <Input
                  value={draft.name}
                  onChange={(e) => setDraft((prev) => ({ ...prev, name: e.target.value }))}
                />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium mb-1 block">Description</label>
              <Textarea
                value={draft.description || ''}
                onChange={(e) => setDraft((prev) => ({ ...prev, description: e.target.value }))}
                className="min-h-[72px]"
              />
            </div>

            <div>
              <label className="text-xs font-medium mb-1 block">Content Formats</label>
              <div className="grid md:grid-cols-3 gap-2">
                {CONTENT_FORMAT_OPTIONS.map(([value, label]) => {
                  const checked = draft.contentFormats.includes(value);
                  return (
                    <label key={value} className="flex items-center gap-2 text-sm border border-border rounded-md px-2 py-2">
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(next) => {
                          setDraft((prev) => {
                            const set = new Set(prev.contentFormats);
                            if (next === true) set.add(value);
                            else if (set.size > 1) set.delete(value);
                            return { ...prev, contentFormats: Array.from(set) as ContentFormat[] };
                          });
                        }}
                      />
                      <span>{label}</span>
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="grid md:grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium mb-1 block">Word Min</label>
                <Input
                  type="number"
                  value={draft.wordRange.min}
                  onChange={(e) =>
                    setDraft((prev) => ({
                      ...prev,
                      wordRange: { ...prev.wordRange, min: Number(e.target.value || 0) },
                    }))
                  }
                />
              </div>
              <div>
                <label className="text-xs font-medium mb-1 block">Word Max</label>
                <Input
                  type="number"
                  value={draft.wordRange.max}
                  onChange={(e) =>
                    setDraft((prev) => ({
                      ...prev,
                      wordRange: { ...prev.wordRange, max: Number(e.target.value || 0) },
                    }))
                  }
                />
              </div>
              <div>
                <label className="text-xs font-medium mb-1 block">Max H2 Sections</label>
                <Input
                  type="number"
                  value={draft.outlineConstraints.maxH2}
                  onChange={(e) =>
                    setDraft((prev) => ({
                      ...prev,
                      outlineConstraints: {
                        ...prev.outlineConstraints,
                        maxH2: Number(e.target.value || 0),
                      },
                    }))
                  }
                />
              </div>
              <div>
                <label className="text-xs font-medium mb-1 block">Max H3 Per H2</label>
                <Input
                  type="number"
                  value={draft.outlineConstraints.maxH3PerH2}
                  onChange={(e) =>
                    setDraft((prev) => ({
                      ...prev,
                      outlineConstraints: {
                        ...prev.outlineConstraints,
                        maxH3PerH2: Number(e.target.value || 0),
                      },
                    }))
                  }
                />
              </div>
            </div>

            <div className="grid md:grid-cols-3 gap-3">
              <div>
                <label className="text-xs font-medium mb-1 block">Em Dash Policy</label>
                <Select
                  value={draft.styleGuard.emDash}
                  onValueChange={(value) =>
                    setDraft((prev) => ({
                      ...prev,
                      styleGuard: { ...prev.styleGuard, emDash: value as 'allow' | 'forbid' },
                    }))
                  }
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="forbid">Forbid</SelectItem>
                    <SelectItem value="allow">Allow</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs font-medium mb-1 block">Colon Policy</label>
                <Select
                  value={draft.styleGuard.colon}
                  onValueChange={(value) =>
                    setDraft((prev) => ({
                      ...prev,
                      styleGuard: {
                        ...prev.styleGuard,
                        colon: value as 'allow' | 'forbid' | 'structural_only',
                      },
                    }))
                  }
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="structural_only">Structural Only</SelectItem>
                    <SelectItem value="forbid">Forbid</SelectItem>
                    <SelectItem value="allow">Allow</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs font-medium mb-1 block">Max Narrative Colons</label>
                <Input
                  type="number"
                  value={draft.styleGuard.maxNarrativeColons}
                  onChange={(e) =>
                    setDraft((prev) => ({
                      ...prev,
                      styleGuard: {
                        ...prev.styleGuard,
                        maxNarrativeColons: Number(e.target.value || 0),
                      },
                    }))
                  }
                />
              </div>
            </div>
          </div>

          <div className="border border-border rounded-lg bg-card p-4 space-y-3">
            <h2 className="font-semibold text-sm">Template Assignments</h2>
            <p className="text-xs text-muted-foreground">
              Global defaults always apply. Select a project above to add project-level overrides.
            </p>
            <div className="space-y-2">
              {CONTENT_FORMAT_OPTIONS.map(([contentFormat, label]) => {
                const globalAssignment = assignmentMap.get(`global:global:${contentFormat}`);
                const projectAssignment = selectedProjectId
                  ? assignmentMap.get(`project:${selectedProjectId}:${contentFormat}`)
                  : null;
                return (
                  <div key={contentFormat} className="grid md:grid-cols-[200px_minmax(0,1fr)_minmax(0,1fr)] gap-2 items-center text-sm border border-border rounded-md p-2">
                    <p className="font-medium">{label}</p>
                    <Select
                      value={globalAssignment?.templateKey || ''}
                      onValueChange={(value) => void upsertAssignment(contentFormat, value, 'global')}
                    >
                      <SelectTrigger className="h-8">
                        <SelectValue placeholder="Global template" />
                      </SelectTrigger>
                      <SelectContent>
                        {templates.map((template) => (
                          <SelectItem key={`${contentFormat}-g-${template.key}`} value={template.key}>
                            {template.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select
                      value={projectAssignment?.templateKey || ''}
                      onValueChange={(value) => void upsertAssignment(contentFormat, value, 'project')}
                      disabled={!selectedProjectId}
                    >
                      <SelectTrigger className="h-8">
                        <SelectValue placeholder={selectedProjectId ? 'Project override' : 'Select project for override'} />
                      </SelectTrigger>
                      <SelectContent>
                        {templates.map((template) => (
                          <SelectItem key={`${contentFormat}-p-${template.key}`} value={template.key}>
                            {template.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="border border-border rounded-lg bg-card p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-semibold text-sm">Workflow Sequencing & Stage Owners</h2>
              <Button
                variant="outline"
                size="sm"
                disabled={!selectedProjectId || saving}
                onClick={async () => {
                  if (!selectedProjectId) return;
                  setSaving(true);
                  setError(null);
                  setNotice(null);
                  try {
                    const response = await fetch('/api/admin/agents/routing', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        projectId: selectedProjectId,
                        backfillActiveTasks: true,
                      }),
                    });
                    if (!response.ok) {
                      const payload = (await response.json().catch(() => ({}))) as { error?: string };
                      throw new Error(payload.error || 'Failed to sync routing');
                    }
                    await refreshData();
                    setNotice('Workflow routing synced and active tasks backfilled.');
                  } catch (err) {
                    setError(err instanceof Error ? err.message : 'Failed to sync workflow routing');
                  } finally {
                    setSaving(false);
                  }
                }}
              >
                {saving ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : null}
                Sync & Backfill
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Configure stage sequence and strict owner per content format. Disabled stages are skipped automatically.
            </p>
            {!selectedProjectId ? (
              <div className="rounded-md border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">
                Select a project to configure stage sequencing and assigned stage owners.
              </div>
            ) : (
              <div className="space-y-3">
                {draft.contentFormats.map((contentFormat) => {
                  const route = routeByFormat.get(contentFormat);
                  const laneKey = (route?.laneKey ||
                    resolveLaneFromContentType(contentFormat)) as AgentLaneKey;
                  return (
                    <div key={`route-${contentFormat}`} className="rounded-md border border-border p-3 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-medium">{CONTENT_FORMAT_LABELS[contentFormat]}</p>
                        {routingSavingFormat === contentFormat ? (
                          <span className="text-[11px] text-muted-foreground inline-flex items-center gap-1">
                            <Loader2 className="h-3 w-3 animate-spin" /> Saving
                          </span>
                        ) : (
                          <span className="text-[11px] text-muted-foreground">Lane: {laneKey}</span>
                        )}
                      </div>
                      <div className="space-y-2">
                        {ROUTABLE_WORKFLOW_STAGES.map((stage) => {
                          const stageEnabled = route?.stageEnabled?.[stage] !== false;
                          const slotValue = route?.stageSlots?.[stage] || '__none';
                          const options = optionsForStage(stage, laneKey);
                          return (
                            <div
                              key={`${contentFormat}-${stage}`}
                              className="grid grid-cols-[120px_90px_minmax(0,1fr)] items-center gap-2"
                            >
                              <p className="text-xs font-medium">{STAGE_LABELS[stage]}</p>
                              <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                                <Checkbox
                                  checked={stageEnabled}
                                  onCheckedChange={(checked) =>
                                    void saveRouteStageEnabled(
                                      contentFormat,
                                      stage,
                                      checked === true,
                                      laneKey
                                    )
                                  }
                                />
                                Enabled
                              </label>
                              <Select
                                value={slotValue}
                                onValueChange={(value) =>
                                  void saveRouteStageSlot(
                                    contentFormat,
                                    stage,
                                    value === '__none' ? '' : value,
                                    laneKey
                                  )
                                }
                              >
                                <SelectTrigger className="h-8 text-xs">
                                  <SelectValue placeholder="Select stage owner" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="__none">Unconfigured</SelectItem>
                                  {options.map((agent) => (
                                    <SelectItem key={`${stage}-${agent.id}`} value={agent.slotKey}>
                                      {agent.name} · {agent.status}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
