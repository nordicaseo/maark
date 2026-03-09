'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Plus,
  Pencil,
  Trash2,
  FolderOpen,
  Users,
  FileText,
  UserPlus,
  Loader2,
  CheckCircle2,
  AlertCircle,
  CircleDashed,
} from 'lucide-react';
import { PROJECT_ASSIGNABLE_ROLES } from '@/lib/permissions';
import type { AgentStaffingTemplate, ProjectBootstrapStageState } from '@/types/agent-runtime';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface Project {
  id: number;
  name: string;
  description: string | null;
  defaultContentFormat: string;
  brandVoice: string | null;
  createdById: string | null;
  createdAt: string;
  updatedAt: string;
  memberCount?: number;
  documentCount?: number;
  settings?: {
    agentRuntime?: {
      staffingTemplate?: AgentStaffingTemplate;
    };
  } | null;
}

interface ProjectMember {
  id: number;
  projectId: number;
  userId: string;
  role: string;
  userName: string | null;
  userEmail: string;
}

interface UserOption {
  id: string;
  name: string | null;
  email: string;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function AdminProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [userOptions, setUserOptions] = useState<UserOption[]>([]);
  const [membersByProject, setMembersByProject] = useState<Record<number, ProjectMember[]>>({});
  const [membersOpen, setMembersOpen] = useState<Record<number, boolean>>({});
  const [newMemberUserByProject, setNewMemberUserByProject] = useState<Record<number, string>>({});
  const [newMemberRoleByProject, setNewMemberRoleByProject] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(true);

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Project | null>(null);
  const [form, setForm] = useState({
    name: '',
    description: '',
    domain: '',
    sitemapUrl: '',
    gscProperty: '',
    staffingTemplate: 'small' as AgentStaffingTemplate,
  });
  const [bootstrapModalOpen, setBootstrapModalOpen] = useState(false);
  const [bootstrapProjectId, setBootstrapProjectId] = useState<number | null>(null);
  const [bootstrapProjectName, setBootstrapProjectName] = useState('');
  const [bootstrapStages, setBootstrapStages] = useState<ProjectBootstrapStageState[]>([]);
  const [bootstrapReady, setBootstrapReady] = useState(false);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const bootstrapPollRef = useRef<number | null>(null);

  /* ── Fetching ───────────────────────────────────────────────────── */

  const fetchProjects = useCallback(async () => {
    try {
      const res = await fetch('/api/projects');
      if (res.ok) {
        const data = await res.json();
        setProjects(data);
      }
    } catch (err) {
      console.error('Failed to fetch projects', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchUsers = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/users');
      if (!res.ok) return;
      const rows = await res.json();
      if (!Array.isArray(rows)) return;
      setUserOptions(
        rows.map((row) => ({
          id: String(row.id),
          name: row.name ?? null,
          email: String(row.email ?? ''),
        }))
      );
    } catch (err) {
      console.error('Failed to fetch users', err);
    }
  }, []);

  const fetchProjectMembers = useCallback(async (projectId: number) => {
    try {
      const res = await fetch(`/api/projects/${projectId}/members`);
      if (!res.ok) return;
      const rows = await res.json();
      setMembersByProject((prev) => ({
        ...prev,
        [projectId]: Array.isArray(rows) ? rows : [],
      }));
    } catch (err) {
      console.error('Failed to fetch project members', err);
    }
  }, []);

  useEffect(() => {
    fetchProjects();
    fetchUsers();
  }, [fetchProjects, fetchUsers]);

  /* ── CRUD ───────────────────────────────────────────────────────── */

  function openNew() {
    setEditing(null);
    setForm({
      name: '',
      description: '',
      domain: '',
      sitemapUrl: '',
      gscProperty: '',
      staffingTemplate: 'small',
    });
    setDialogOpen(true);
  }

  function openEdit(p: Project) {
    setEditing(p);
    setForm({
      name: p.name,
      description: p.description || '',
      domain: '',
      sitemapUrl: '',
      gscProperty: '',
      staffingTemplate: p.settings?.agentRuntime?.staffingTemplate || 'small',
    });
    setDialogOpen(true);
  }

  const loadBootstrapStatus = useCallback(async (projectId: number) => {
    const res = await fetch(`/api/projects/${projectId}/bootstrap-status`);
    if (!res.ok) {
      const payload = await res.json().catch(() => null);
      throw new Error(payload?.error || 'Failed to load setup status');
    }
    const payload = (await res.json()) as {
      ready: boolean;
      hasRunning: boolean;
      stages: ProjectBootstrapStageState[];
    };
    setBootstrapStages(Array.isArray(payload.stages) ? payload.stages : []);
    setBootstrapReady(Boolean(payload.ready));
    if (payload.ready || !payload.hasRunning) {
      if (bootstrapPollRef.current) {
        window.clearInterval(bootstrapPollRef.current);
        bootstrapPollRef.current = null;
      }
    }
  }, []);

  async function save() {
    if (!form.name.trim()) return;

    if (editing) {
      const res = await fetch(`/api/projects/${editing.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          description: form.description,
          agentStaffingTemplate: form.staffingTemplate,
        }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        alert(payload?.error || 'Failed to update project');
        return;
      }
    } else {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          description: form.description,
          domain: form.domain,
          sitemapUrl: form.sitemapUrl || undefined,
          gscProperty: form.gscProperty || undefined,
          agentStaffingTemplate: form.staffingTemplate,
        }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        alert(payload?.error || 'Failed to create project');
        return;
      }
      const payload = (await res.json()) as {
        id: number;
        name: string;
        bootstrapStages?: ProjectBootstrapStageState[];
      };
      if (payload?.id) {
        setBootstrapProjectId(payload.id);
        setBootstrapProjectName(payload.name || form.name);
        setBootstrapStages(payload.bootstrapStages || []);
        setBootstrapReady(false);
        setBootstrapError(null);
        setBootstrapModalOpen(true);
        try {
          await loadBootstrapStatus(payload.id);
        } catch (err) {
          setBootstrapError(err instanceof Error ? err.message : 'Failed to load setup status');
        }
        if (bootstrapPollRef.current) {
          window.clearInterval(bootstrapPollRef.current);
          bootstrapPollRef.current = null;
        }
        bootstrapPollRef.current = window.setInterval(() => {
          void loadBootstrapStatus(payload.id).catch((err) => {
            setBootstrapError(err instanceof Error ? err.message : 'Failed to load setup status');
          });
        }, 3500);
      }
    }
    setDialogOpen(false);
    fetchProjects();
  }

  async function deleteProject(id: number) {
    if (!confirm('Delete this project? All associated documents and agent knowledge data will be affected.')) return;
    await fetch(`/api/projects/${id}`, { method: 'DELETE' });
    fetchProjects();
  }

  useEffect(() => {
    return () => {
      if (bootstrapPollRef.current) {
        window.clearInterval(bootstrapPollRef.current);
      }
    };
  }, []);

  async function toggleMembers(projectId: number) {
    const next = !membersOpen[projectId];
    setMembersOpen((prev) => ({ ...prev, [projectId]: next }));
    if (next) {
      await fetchProjectMembers(projectId);
    }
  }

  async function updateMemberRole(projectId: number, userId: string, role: string) {
    await fetch(`/api/projects/${projectId}/members`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, role }),
    });
    await fetchProjectMembers(projectId);
  }

  async function removeMember(projectId: number, userId: string) {
    await fetch(`/api/projects/${projectId}/members`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    });
    await fetchProjectMembers(projectId);
  }

  async function addMember(projectId: number) {
    const userId = newMemberUserByProject[projectId];
    const role = newMemberRoleByProject[projectId] || 'writer';
    if (!userId) return;
    await fetch(`/api/projects/${projectId}/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, role }),
    });
    setNewMemberUserByProject((prev) => ({ ...prev, [projectId]: '' }));
    setNewMemberRoleByProject((prev) => ({ ...prev, [projectId]: 'writer' }));
    await fetchProjectMembers(projectId);
  }

  /* ── Render ─────────────────────────────────────────────────────── */

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        Loading projects...
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <FolderOpen className="h-6 w-6" /> Projects
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage content projects and their members.
          </p>
        </div>
        <Button onClick={openNew}>
          <Plus className="h-4 w-4 mr-1" /> New Project
        </Button>
      </div>

      {projects.length === 0 ? (
        <div className="border border-dashed border-border rounded-lg p-12 text-center text-muted-foreground">
          <FolderOpen className="h-10 w-10 mx-auto mb-3 opacity-50" />
          <p className="font-medium">No projects yet</p>
          <p className="text-sm mt-1">Create your first project to get started.</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {projects.map((p) => (
            <div
              key={p.id}
              className="border border-border rounded-lg p-4 bg-card hover:bg-accent/20 transition-colors"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-semibold text-lg truncate">{p.name}</h3>
                    <Badge variant="outline" className="text-xs">
                      {p.defaultContentFormat?.replace('_', ' ') || 'blog post'}
                    </Badge>
                    <Badge variant="outline" className="text-xs">
                      {(p.settings?.agentRuntime?.staffingTemplate || 'small') + ' team'}
                    </Badge>
                  </div>
                  {p.description && (
                    <p className="text-sm text-muted-foreground line-clamp-2 mb-2">
                      {p.description}
                    </p>
                  )}
                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Users className="h-3.5 w-3.5" />
                      {p.memberCount ?? 0} members
                    </span>
                    <span className="flex items-center gap-1">
                      <FileText className="h-3.5 w-3.5" />
                      {p.documentCount ?? 0} documents
                    </span>
                    <span>
                      Created{' '}
                      {new Date(p.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-1 ml-4">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void toggleMembers(p.id)}
                  >
                    <Users className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => openEdit(p)}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => deleteProject(p.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  </Button>
                </div>
              </div>
              {membersOpen[p.id] && (
                <div className="mt-4 border-t border-border pt-3 space-y-3">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Project Members
                  </p>
                  {(membersByProject[p.id] || []).length === 0 ? (
                    <p className="text-xs text-muted-foreground">No members assigned.</p>
                  ) : (
                    <div className="space-y-2">
                      {(membersByProject[p.id] || []).map((member) => (
                        <div
                          key={`${member.projectId}-${member.userId}`}
                          className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2"
                        >
                          <div className="min-w-0">
                            <p className="text-sm font-medium truncate">
                              {member.userName || member.userEmail}
                            </p>
                            <p className="text-xs text-muted-foreground truncate">{member.userEmail}</p>
                          </div>
                          <div className="flex items-center gap-2">
                            <Select
                              value={member.role}
                              onValueChange={(role) => void updateMemberRole(p.id, member.userId, role)}
                            >
                              <SelectTrigger className="w-28 h-8 text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {PROJECT_ASSIGNABLE_ROLES.map((role) => (
                                  <SelectItem key={role} value={role}>
                                    {role}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => void removeMember(p.id, member.userId)}
                            >
                              <Trash2 className="h-3.5 w-3.5 text-destructive" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="rounded-md border border-dashed border-border p-3 space-y-2">
                    <p className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                      <UserPlus className="h-3.5 w-3.5" />
                      Add Member
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-[1fr_140px_auto] gap-2">
                      <Select
                        value={newMemberUserByProject[p.id] || ''}
                        onValueChange={(value) =>
                          setNewMemberUserByProject((prev) => ({ ...prev, [p.id]: value }))
                        }
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue placeholder="Select user" />
                        </SelectTrigger>
                        <SelectContent>
                          {userOptions.map((userOption) => (
                            <SelectItem key={userOption.id} value={userOption.id}>
                              {userOption.name || userOption.email}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Select
                        value={newMemberRoleByProject[p.id] || 'writer'}
                        onValueChange={(value) =>
                          setNewMemberRoleByProject((prev) => ({ ...prev, [p.id]: value }))
                        }
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {PROJECT_ASSIGNABLE_ROLES.map((role) => (
                            <SelectItem key={role} value={role}>
                              {role}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        size="sm"
                        onClick={() => void addMember(p.id)}
                        disabled={!newMemberUserByProject[p.id]}
                      >
                        Add
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── Dialog ─────────────────────────────────────────────────── */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editing ? 'Edit Project' : 'New Project'}
            </DialogTitle>
            <DialogDescription>
              {editing
                ? 'Update the project details below.'
                : 'Create a new content project.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div>
              <label className="text-sm font-medium mb-1 block">Name</label>
              <Input
                value={form.name}
                onChange={(e) =>
                  setForm((f) => ({ ...f, name: e.target.value }))
                }
                placeholder="Project name"
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">
                Description
              </label>
              <Input
                value={form.description}
                onChange={(e) =>
                  setForm((f) => ({ ...f, description: e.target.value }))
                }
                placeholder="Brief description (optional)"
              />
            </div>
            {!editing && (
              <>
                <div>
                  <label className="text-sm font-medium mb-1 block">Domain</label>
                  <Input
                    value={form.domain}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, domain: e.target.value }))
                    }
                    placeholder="example.com"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Required. Project discovery + crawl bootstrap starts automatically after create.
                  </p>
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">Sitemap URL (optional)</label>
                  <Input
                    value={form.sitemapUrl}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, sitemapUrl: e.target.value }))
                    }
                    placeholder="https://example.com/sitemap.xml"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">GSC Property (optional)</label>
                  <Input
                    value={form.gscProperty}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, gscProperty: e.target.value }))
                    }
                    placeholder="sc-domain:example.com"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">Agent Staffing Template</label>
                  <Select
                    value={form.staffingTemplate}
                    onValueChange={(value) =>
                      setForm((f) => ({
                        ...f,
                        staffingTemplate: (value as AgentStaffingTemplate) || 'small',
                      }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="small">Small (1 core role each)</SelectItem>
                      <SelectItem value="standard">Standard (+extra writer/outliner/SEO reviewer)</SelectItem>
                      <SelectItem value="premium">Premium (+extra PM/research/SEO capacity)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={save} disabled={!form.name.trim() || (!editing && !form.domain.trim())}>
              {editing ? 'Update' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={bootstrapModalOpen}
        onOpenChange={(open) => {
          setBootstrapModalOpen(open);
          if (!open && bootstrapPollRef.current) {
            window.clearInterval(bootstrapPollRef.current);
            bootstrapPollRef.current = null;
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Setting Up {bootstrapProjectName || 'Project'}</DialogTitle>
            <DialogDescription>
              We are provisioning dedicated agents, Mission Control, and initial page discovery.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-1">
            {bootstrapStages.map((stage) => {
              const Icon =
                stage.status === 'done'
                  ? CheckCircle2
                  : stage.status === 'failed'
                    ? AlertCircle
                    : stage.status === 'running'
                      ? Loader2
                      : CircleDashed;
              const colorClass =
                stage.status === 'done'
                  ? 'text-emerald-600'
                  : stage.status === 'failed'
                    ? 'text-red-600'
                    : stage.status === 'running'
                      ? 'text-amber-600'
                      : 'text-muted-foreground';
              return (
                <div
                  key={stage.stage}
                  className="rounded-md border border-border px-3 py-2 bg-card"
                >
                  <div className="flex items-center gap-2">
                    <Icon className={`h-4 w-4 ${colorClass} ${stage.status === 'running' ? 'animate-spin' : ''}`} />
                    <p className="text-sm font-medium">{stage.label}</p>
                    <Badge variant="outline" className="ml-auto text-[10px] uppercase">
                      {stage.status}
                    </Badge>
                  </div>
                  {stage.message && (
                    <p className="text-xs text-muted-foreground mt-1">{stage.message}</p>
                  )}
                </div>
              );
            })}
            {bootstrapError && (
              <p className="text-xs text-red-600">{bootstrapError}</p>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                if (bootstrapProjectId) {
                  void loadBootstrapStatus(bootstrapProjectId).catch((err) =>
                    setBootstrapError(
                      err instanceof Error ? err.message : 'Failed to refresh setup status'
                    )
                  );
                }
              }}
            >
              Refresh Status
            </Button>
            <Button
              onClick={() => setBootstrapModalOpen(false)}
              disabled={!bootstrapReady && bootstrapStages.some((stage) => stage.status === 'running')}
            >
              {bootstrapReady ? 'Done' : 'Close'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
