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

interface Project {
  id: number;
  name: string;
}

const CONTENT_FORMAT_OPTIONS = Object.entries(CONTENT_FORMAT_LABELS) as Array<
  [ContentFormat, string]
>;

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
      const [projectsRes, templatesRes, assignmentsRes] = await Promise.all([
        fetch('/api/projects'),
        fetch('/api/super-admin/templates'),
        fetch(
          selectedProjectId
            ? `/api/super-admin/templates/assignments?projectId=${selectedProjectId}`
            : '/api/super-admin/templates/assignments'
        ),
      ]);

      if (!projectsRes.ok || !templatesRes.ok || !assignmentsRes.ok) {
        throw new Error('Failed to load templates data');
      }

      const projectsData = (await projectsRes.json()) as Project[];
      const templatesData = (await templatesRes.json()) as {
        templates: ContentTemplateConfig[];
      };
      const assignmentData = (await assignmentsRes.json()) as TemplateAssignment[];

      setProjects(projectsData);
      setTemplates(templatesData.templates || []);
      setAssignments(assignmentData || []);

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
        </div>
      </div>
    </div>
  );
}

