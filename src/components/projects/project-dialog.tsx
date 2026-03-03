'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
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
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2 } from 'lucide-react';
import { CONTENT_FORMAT_GROUPS, CONTENT_FORMAT_LABELS, type ContentFormat } from '@/types/document';
import type { Project } from '@/types/project';

interface ProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
  project?: Project | null;
}

export function ProjectDialog({ open, onOpenChange, onSaved, project }: ProjectDialogProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [defaultFormat, setDefaultFormat] = useState<ContentFormat>('blog_post');
  const [brandVoice, setBrandVoice] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (project) {
      setName(project.name);
      setDescription(project.description || '');
      setDefaultFormat(project.defaultContentFormat || 'blog_post');
      setBrandVoice(project.brandVoice || '');
    } else {
      setName('');
      setDescription('');
      setDefaultFormat('blog_post');
      setBrandVoice('');
    }
  }, [project, open]);

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const url = project ? `/api/projects/${project.id}` : '/api/projects';
      const method = project ? 'PATCH' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || null,
          defaultContentFormat: defaultFormat,
          brandVoice: brandVoice.trim() || null,
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
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{project ? 'Edit Project' : 'New Project'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div>
            <label className="text-sm font-medium mb-1.5 block">Name</label>
            <Input
              placeholder="Project name..."
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSave()}
            />
          </div>
          <div>
            <label className="text-sm font-medium mb-1.5 block">Description</label>
            <Textarea
              placeholder="Brief description..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="resize-none"
            />
          </div>
          <div>
            <label className="text-sm font-medium mb-1.5 block">Default Content Format</label>
            <Select value={defaultFormat} onValueChange={(v) => setDefaultFormat(v as ContentFormat)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(CONTENT_FORMAT_GROUPS).map(([key, group]) => (
                  <SelectGroup key={key}>
                    <SelectLabel>{group.label}</SelectLabel>
                    {group.formats.map((f) => (
                      <SelectItem key={f} value={f}>
                        {CONTENT_FORMAT_LABELS[f]}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-sm font-medium mb-1.5 block">Brand Voice</label>
            <Textarea
              placeholder="Brand voice guidelines for AI writing..."
              value={brandVoice}
              onChange={(e) => setBrandVoice(e.target.value)}
              rows={4}
              className="resize-none text-sm"
            />
            <p className="text-xs text-muted-foreground mt-1">
              These guidelines are passed to the AI when writing content for this project
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving || !name.trim()}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {project ? 'Save' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
