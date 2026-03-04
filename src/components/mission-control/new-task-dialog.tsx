'use client';

import { useState, useEffect } from 'react';
import { useMutation } from 'convex/react';
import { api } from '../../../convex/_generated/api';
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
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2 } from 'lucide-react';

interface Skill {
  id: number;
  name: string;
}

interface NewTaskDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId?: number | null;
}

export function NewTaskDialog({ open, onOpenChange, projectId }: NewTaskDialogProps) {
  const createTask = useMutation(api.tasks.create);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState('content');
  const [priority, setPriority] = useState('MEDIUM');
  const [skillsList, setSkillsList] = useState<Skill[]>([]);
  const [selectedSkillId, setSelectedSkillId] = useState<string>('auto');
  const [saving, setSaving] = useState(false);

  // Fetch skills when project changes or dialog opens
  useEffect(() => {
    if (!open) return;
    const pid = projectId ? String(projectId) : undefined;
    const url = pid ? `/api/skills?projectId=${pid}` : '/api/skills';
    fetch(url)
      .then((r) => (r.ok ? r.json() : []))
      .then(setSkillsList)
      .catch(() => setSkillsList([]));
    setSelectedSkillId('auto');
  }, [open, projectId]);

  const handleCreate = async () => {
    if (!title.trim() || !projectId) return;
    setSaving(true);
    try {
      const parsedProjectId = projectId;

      // For content/edit tasks, auto-create a linked document in the editor
      let documentId: number | undefined;
      if (type === 'edit') {
        try {
          const docRes = await fetch('/api/documents?skipTaskCreation=true', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              title: title.trim(),
              contentType: 'blog_post',
              projectId: parsedProjectId,
            }),
          });
          if (docRes.ok) {
            const newDoc = await docRes.json();
            documentId = newDoc.id;
          }
        } catch {
          // Document creation failed — continue creating task without link
          console.warn('Failed to auto-create linked document');
        }
      }

      const parsedSkillId =
        selectedSkillId && selectedSkillId !== 'auto'
          ? parseInt(selectedSkillId)
          : undefined;

      if (type === 'content') {
        const workflowRes = await fetch('/api/topic-workflow/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId: parsedProjectId,
            topic: title.trim(),
            entryPoint: 'mission_control',
            skillId: parsedSkillId,
            options: {
              outlineReviewOptional: true,
              seoReviewRequired: true,
            },
          }),
        });

        if (!workflowRes.ok) {
          const err = await workflowRes.json().catch(() => ({}));
          throw new Error(err.error || 'Failed to create topic workflow task');
        }
      } else {
        await createTask({
          title: title.trim(),
          description: description.trim() || undefined,
          type,
          status: 'BACKLOG',
          priority,
          projectId: parsedProjectId,
          skillId: parsedSkillId,
          documentId,
        });
      }

      setTitle('');
      setDescription('');
      setType('content');
      setPriority('MEDIUM');
      setSelectedSkillId('auto');
      onOpenChange(false);
    } catch (err) {
      console.error('Failed to create task:', err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New Task</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div>
            <label className="text-sm font-medium mb-1.5 block">Title</label>
            <Input
              placeholder="Task title..."
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
            />
          </div>
          <div>
            <label className="text-sm font-medium mb-1.5 block">Description</label>
            <Textarea
              placeholder="Task description..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="resize-none"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium mb-1.5 block">Type</label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="content">Content</SelectItem>
                  <SelectItem value="review">Review</SelectItem>
                  <SelectItem value="research">Research</SelectItem>
                  <SelectItem value="edit">Edit</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">Priority</label>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="LOW">Low</SelectItem>
                  <SelectItem value="MEDIUM">Medium</SelectItem>
                  <SelectItem value="HIGH">High</SelectItem>
                  <SelectItem value="URGENT">Urgent</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <label className="text-sm font-medium mb-1.5 block">Project</label>
            <div className="rounded-md border px-3 py-2 text-xs text-muted-foreground">
              {projectId
                ? `Using active project #${projectId}`
                : 'Select a project in the Mission Control header before creating tasks'}
            </div>
          </div>
          <div>
            <label className="text-sm font-medium mb-1.5 block">Skill</label>
            <Select value={selectedSkillId} onValueChange={setSelectedSkillId}>
              <SelectTrigger>
                <SelectValue placeholder="Select skill..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Auto-detect</SelectItem>
                {skillsList.map((s) => (
                  <SelectItem key={s.id} value={s.id.toString()}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={saving || !title.trim() || !projectId}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Create Task
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
