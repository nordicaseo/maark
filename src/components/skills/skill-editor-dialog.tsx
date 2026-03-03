'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2 } from 'lucide-react';
import type { Skill } from '@/types/skill';
import type { Project } from '@/types/project';

interface SkillEditorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
  skill?: Skill | null;
  projectId?: number | null;
}

export function SkillEditorDialog({ open, onOpenChange, onSaved, skill, projectId }: SkillEditorDialogProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [content, setContent] = useState('');
  const [isGlobal, setIsGlobal] = useState(false);
  const [skillProjectId, setSkillProjectId] = useState<string>('none');
  const [projects, setProjects] = useState<Project[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      fetch('/api/projects').then(r => r.ok ? r.json() : []).then(setProjects).catch(() => {});
    }
  }, [open]);

  useEffect(() => {
    if (skill) {
      setName(skill.name);
      setDescription(skill.description || '');
      setContent(skill.content);
      setIsGlobal(skill.isGlobal === 1);
      setSkillProjectId(skill.projectId?.toString() || 'none');
    } else {
      setName('');
      setDescription('');
      setContent('');
      setIsGlobal(false);
      setSkillProjectId(projectId?.toString() || 'none');
    }
  }, [skill, open, projectId]);

  const handleSave = async () => {
    if (!name.trim() || !content.trim()) return;
    setSaving(true);
    try {
      const url = skill ? `/api/skills/${skill.id}` : '/api/skills';
      const method = skill ? 'PATCH' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || null,
          content: content.trim(),
          isGlobal: isGlobal ? 1 : 0,
          projectId: isGlobal ? null : (skillProjectId !== 'none' ? parseInt(skillProjectId) : null),
        }),
      });
      if (res.ok) {
        onSaved();
        onOpenChange(false);
      }
    } catch {}
    setSaving(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{skill ? 'Edit Skill' : 'New Skill'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div>
            <label className="text-sm font-medium mb-1.5 block">Name</label>
            <Input
              placeholder="Skill name..."
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div>
            <label className="text-sm font-medium mb-1.5 block">Description</label>
            <Input
              placeholder="Brief description of what this skill does..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="isGlobal"
              checked={isGlobal}
              onCheckedChange={(checked) => setIsGlobal(checked === true)}
            />
            <label htmlFor="isGlobal" className="text-sm">
              Global skill (available in all projects)
            </label>
          </div>
          {!isGlobal && (
            <div>
              <label className="text-sm font-medium mb-1.5 block">Project</label>
              <Select value={skillProjectId} onValueChange={setSkillProjectId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select project..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No project</SelectItem>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id.toString()}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div>
            <label className="text-sm font-medium mb-1.5 block">Skill Content</label>
            <Textarea
              placeholder="Enter the skill instructions in markdown format...

Example:
# Product Category Content Skill

## What This Skill Does
Generates SEO-optimized product category pages...

## Brand Voice
Professional yet approachable...

## Content Structure
- Introduction paragraph
- Category overview
- Product highlights
- FAQ section"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={12}
              className="resize-y text-sm font-mono"
            />
            <p className="text-xs text-muted-foreground mt-1">
              This content is passed to the AI as instructions when writing with this skill
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving || !name.trim() || !content.trim()}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {skill ? 'Save' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
