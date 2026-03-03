'use client';

import { useEffect, useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Plus, Pencil, Trash2, Sparkles } from 'lucide-react';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface Skill {
  id: number;
  projectId: number | null;
  name: string;
  description: string | null;
  content: string;
  isGlobal: number;
  createdAt: string;
  updatedAt: string;
  projectName?: string;
}

interface Project {
  id: number;
  name: string;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function AdminSkillsPage() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Skill | null>(null);
  const [form, setForm] = useState({
    name: '',
    description: '',
    content: '',
    projectId: '' as string,
    isGlobal: false,
  });

  /* ── Fetching ───────────────────────────────────────────────────── */

  const fetchSkills = useCallback(async () => {
    try {
      const res = await fetch('/api/skills');
      if (res.ok) setSkills(await res.json());
    } catch (err) {
      console.error('Failed to fetch skills', err);
    }
  }, []);

  const fetchProjects = useCallback(async () => {
    try {
      const res = await fetch('/api/projects');
      if (res.ok) setProjects(await res.json());
    } catch (err) {
      console.error('Failed to fetch projects', err);
    }
  }, []);

  useEffect(() => {
    Promise.all([fetchSkills(), fetchProjects()]).finally(() =>
      setLoading(false)
    );
  }, [fetchSkills, fetchProjects]);

  /* ── Helpers ────────────────────────────────────────────────────── */

  function getProjectName(projectId: number | null): string {
    if (!projectId) return 'Global';
    const p = projects.find((proj) => proj.id === projectId);
    return p?.name ?? 'Unknown';
  }

  /* ── CRUD ───────────────────────────────────────────────────────── */

  function openNew() {
    setEditing(null);
    setForm({ name: '', description: '', content: '', projectId: '', isGlobal: false });
    setDialogOpen(true);
  }

  function openEdit(s: Skill) {
    setEditing(s);
    setForm({
      name: s.name,
      description: s.description || '',
      content: s.content,
      projectId: s.projectId ? String(s.projectId) : '',
      isGlobal: !!s.isGlobal,
    });
    setDialogOpen(true);
  }

  async function save() {
    if (!form.name.trim() || !form.content.trim()) return;

    const body = {
      name: form.name,
      description: form.description || null,
      content: form.content,
      projectId: form.isGlobal ? null : (form.projectId ? Number(form.projectId) : null),
      isGlobal: form.isGlobal ? 1 : 0,
    };

    if (editing) {
      await fetch(`/api/skills/${editing.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } else {
      await fetch('/api/skills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    }
    setDialogOpen(false);
    fetchSkills();
  }

  async function deleteSkill(id: number) {
    if (!confirm('Delete this skill?')) return;
    await fetch(`/api/skills/${id}`, { method: 'DELETE' });
    fetchSkills();
  }

  /* ── Render ─────────────────────────────────────────────────────── */

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        Loading skills...
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Sparkles className="h-6 w-6" /> Skills
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage writing skills and instructions for AI generation.
          </p>
        </div>
        <Button onClick={openNew}>
          <Plus className="h-4 w-4 mr-1" /> New Skill
        </Button>
      </div>

      {skills.length === 0 ? (
        <div className="border border-dashed border-border rounded-lg p-12 text-center text-muted-foreground">
          <Sparkles className="h-10 w-10 mx-auto mb-3 opacity-50" />
          <p className="font-medium">No skills yet</p>
          <p className="text-sm mt-1">Create skills to guide AI writing behaviour.</p>
        </div>
      ) : (
        <div className="border border-border rounded-lg divide-y divide-border">
          {skills.map((s) => (
            <div
              key={s.id}
              className="flex items-center justify-between px-4 py-3"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="font-medium truncate">{s.name}</span>
                  <Badge
                    variant={s.isGlobal ? 'default' : 'outline'}
                    className="text-xs"
                  >
                    {s.isGlobal ? 'Global' : getProjectName(s.projectId)}
                  </Badge>
                </div>
                {s.description && (
                  <p className="text-sm text-muted-foreground truncate">
                    {s.description}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-1 ml-4">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => openEdit(s)}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => deleteSkill(s.id)}
                >
                  <Trash2 className="h-3.5 w-3.5 text-destructive" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Dialog ─────────────────────────────────────────────────── */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editing ? 'Edit Skill' : 'New Skill'}
            </DialogTitle>
            <DialogDescription>
              {editing
                ? 'Update the skill details below.'
                : 'Create a new writing skill for AI generation.'}
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
                placeholder="Skill name"
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

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="skill-global"
                checked={form.isGlobal}
                onChange={(e) =>
                  setForm((f) => ({ ...f, isGlobal: e.target.checked }))
                }
                className="rounded border-border"
              />
              <label htmlFor="skill-global" className="text-sm">
                Global skill (available to all projects)
              </label>
            </div>

            {!form.isGlobal && (
              <div>
                <label className="text-sm font-medium mb-1 block">
                  Project
                </label>
                <Select
                  value={form.projectId}
                  onValueChange={(v) =>
                    setForm((f) => ({ ...f, projectId: v }))
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select project (optional)" />
                  </SelectTrigger>
                  <SelectContent>
                    {projects.map((p) => (
                      <SelectItem key={p.id} value={String(p.id)}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div>
              <label className="text-sm font-medium mb-1 block">
                Content / Instructions
              </label>
              <Textarea
                value={form.content}
                onChange={(e) =>
                  setForm((f) => ({ ...f, content: e.target.value }))
                }
                placeholder="Write the skill instructions here..."
                rows={6}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={save}
              disabled={!form.name.trim() || !form.content.trim()}
            >
              {editing ? 'Update' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
