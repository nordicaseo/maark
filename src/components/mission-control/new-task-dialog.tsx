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

interface Project {
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
  const [selectedProjectId, setSelectedProjectId] = useState<string>(projectId?.toString() || 'none');
  const [projects, setProjects] = useState<Project[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      fetch('/api/projects').then((r) => r.ok ? r.json() : []).then(setProjects).catch(() => {});
    }
  }, [open]);

  useEffect(() => {
    if (projectId) {
      setSelectedProjectId(projectId.toString());
    }
  }, [projectId]);

  const handleCreate = async () => {
    if (!title.trim()) return;
    setSaving(true);
    try {
      await createTask({
        title: title.trim(),
        description: description.trim() || undefined,
        type,
        status: 'BACKLOG',
        priority,
        projectId: selectedProjectId && selectedProjectId !== 'none' ? parseInt(selectedProjectId) : undefined,
      });
      setTitle('');
      setDescription('');
      setType('content');
      setPriority('MEDIUM');
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
            <Select value={selectedProjectId} onValueChange={setSelectedProjectId}>
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
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={saving || !title.trim()}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Create Task
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
