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
import {
  PAGE_TYPE_OPTIONS,
  BLOG_SUBTYPE_OPTIONS,
  COLLECTION_SUBTYPE_OPTIONS,
  DEFAULT_PAGE_TYPE,
  DEFAULT_BLOG_SUBTYPE,
  DEFAULT_COLLECTION_SUBTYPE,
  hasPageSubtype,
  getPageSelectionTags,
  pageSubtypeLabel,
  pageTypeLabel,
  resolveDefaultContentType,
  resolveLaneFromPageSelection,
  type BlogSubtype,
  type CollectionSubtype,
  type PageType,
  type PageSubtype,
} from '@/lib/content-workflow-taxonomy';
import { triggerTopicWorkflowRun } from '@/lib/topic-workflow-client';

interface Skill {
  id: number;
  name: string;
  description?: string | null;
  content?: string;
  projectId?: number | null;
  isGlobal?: number;
}

interface NewTaskDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId?: number | null;
}

function normalizeText(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function resolveAutoSkill(
  skills: Skill[],
  pageType: PageType,
  subtype: PageSubtype
): Skill | null {
  if (skills.length === 0) return null;
  const requireSubtypeMatch = hasPageSubtype(pageType);
  const pageText = normalizeText(pageTypeLabel(pageType));
  const subtypeText = requireSubtypeMatch
    ? normalizeText(pageSubtypeLabel(pageType, subtype))
    : '';

  let bestSkill: Skill | null = null;
  let bestScore = 0;

  for (const skill of skills) {
    const haystack = normalizeText(
      `${skill.name} ${skill.description || ''} ${skill.content || ''}`
    );
    let score = 0;
    if (pageText && haystack.includes(pageText)) score += 3;
    if (subtypeText && haystack.includes(subtypeText)) score += 4;
    if (pageType === 'blog' && haystack.includes('blog')) score += 1;
    if (pageType === 'collection' && haystack.includes('collection')) score += 1;
    if (score > bestScore) {
      bestScore = score;
      bestSkill = skill;
    }
  }

  return bestScore >= (requireSubtypeMatch ? 4 : 3) ? bestSkill : null;
}

export function NewTaskDialog({ open, onOpenChange, projectId }: NewTaskDialogProps) {
  const createTask = useMutation(api.tasks.create);
  const updateTask = useMutation(api.tasks.update);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState('content');
  const [priority, setPriority] = useState('MEDIUM');
  const [skillsList, setSkillsList] = useState<Skill[]>([]);
  const [selectedSkillId, setSelectedSkillId] = useState<string>('auto');
  const [pageType, setPageType] = useState<PageType>(DEFAULT_PAGE_TYPE);
  const [blogSubtype, setBlogSubtype] = useState<BlogSubtype>(DEFAULT_BLOG_SUBTYPE);
  const [collectionSubtype, setCollectionSubtype] = useState<CollectionSubtype>(DEFAULT_COLLECTION_SUBTYPE);
  const [saving, setSaving] = useState(false);
  const hasSubtype = hasPageSubtype(pageType);
  const selectedSubtype: PageSubtype =
    pageType === 'blog' ? blogSubtype : pageType === 'collection' ? collectionSubtype : 'standard';
  const selectedSubtypeLabel = pageSubtypeLabel(pageType, selectedSubtype);
  const selectedPageLabel = pageTypeLabel(pageType);
  const subtypeControlLabel =
    pageType === 'blog'
      ? 'Blog Type'
      : pageType === 'collection'
        ? 'Collection Placement'
        : 'Content Type';
  const autoMatchedSkill =
    selectedSkillId === 'auto'
      ? resolveAutoSkill(skillsList, pageType, selectedSubtype)
      : null;
  const explicitSkill =
    selectedSkillId !== 'auto'
      ? skillsList.find((skill) => skill.id.toString() === selectedSkillId) ?? null
      : null;
  const effectiveSelectedSkill = explicitSkill ?? autoMatchedSkill;
  const willQueueSkillTask = type === 'content' && !effectiveSelectedSkill;

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
    setPageType(DEFAULT_PAGE_TYPE);
    setBlogSubtype(DEFAULT_BLOG_SUBTYPE);
    setCollectionSubtype(DEFAULT_COLLECTION_SUBTYPE);
  }, [open, projectId]);

  const handleCreate = async () => {
    if (!title.trim() || !projectId) return;
    setSaving(true);
    try {
      const parsedProjectId = projectId;
      const resolvedContentType = resolveDefaultContentType(pageType, selectedSubtype);
      const resolvedLaneKey = resolveLaneFromPageSelection(pageType, selectedSubtype);
      const typeTags = getPageSelectionTags(pageType, selectedSubtype);

      // For content/edit tasks, auto-create a linked document in the editor
      let documentId: number | undefined;
      if (type === 'edit') {
        try {
          const docRes = await fetch('/api/documents?skipTaskCreation=true', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              title: title.trim(),
              contentType: resolvedContentType,
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
      const autoSkill =
        selectedSkillId === 'auto'
          ? resolveAutoSkill(skillsList, pageType, selectedSubtype)
          : null;
      const effectiveSkillId = parsedSkillId ?? autoSkill?.id;
      const missingSkill = type === 'content' && !effectiveSkillId;

      if (type === 'content') {
        const workflowRes = await fetch('/api/topic-workflow/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId: parsedProjectId,
            topic: title.trim(),
            entryPoint: 'mission_control',
            skillId: effectiveSkillId,
            contentType: resolvedContentType,
            laneKey: resolvedLaneKey,
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

        const created = await workflowRes.json();
        if (created?.taskId) {
          if (!created.reused) {
            await updateTask({
              id: created.taskId,
              expectedProjectId: parsedProjectId,
              tags: [
                'topic',
                'workflow',
                'mission_control',
                ...typeTags,
                ...(missingSkill ? ['needs_skill'] : []),
              ],
              workflowLastEventText: missingSkill
                ? hasSubtype
                  ? `Waiting for skill: ${selectedPageLabel} / ${selectedSubtypeLabel}`
                  : `Waiting for skill: ${selectedPageLabel}`
                : undefined,
            });
          }
          if (!missingSkill) {
            triggerTopicWorkflowRun(created.taskId, {
              autoContinue: true,
              maxStages: 10,
              logLabel: 'topic workflow',
            });
          }
        }

        if (missingSkill) {
          const skillTarget = hasSubtype
            ? `${selectedPageLabel} / ${selectedSubtypeLabel}`
            : selectedPageLabel;
          await createTask({
            title: `Create Skill: ${skillTarget}`,
            description: `Missing skill for task "${title.trim()}". Create a reusable skill for ${skillTarget} before starting this topic.`,
            type: 'research',
            status: 'BACKLOG',
            priority: 'HIGH',
            projectId: parsedProjectId,
            tags: ['skill_setup', 'needs_skill', ...typeTags],
          });
        }
      } else {
        await createTask({
          title: title.trim(),
          description: description.trim() || undefined,
          type,
          status: 'BACKLOG',
          priority,
          projectId: parsedProjectId,
          skillId: effectiveSkillId,
          documentId,
          tags: typeTags,
        });
      }

      setTitle('');
      setDescription('');
      setType('content');
      setPriority('MEDIUM');
      setSelectedSkillId('auto');
      setPageType(DEFAULT_PAGE_TYPE);
      setBlogSubtype(DEFAULT_BLOG_SUBTYPE);
      setCollectionSubtype(DEFAULT_COLLECTION_SUBTYPE);
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
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium mb-1.5 block">Page Type</label>
              <Select
                value={pageType}
                onValueChange={(value) => setPageType(value as PageType)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAGE_TYPE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">{subtypeControlLabel}</label>
              {pageType === 'blog' ? (
                <Select
                  value={blogSubtype}
                  onValueChange={(value) => setBlogSubtype(value as BlogSubtype)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {BLOG_SUBTYPE_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : pageType === 'collection' ? (
                <Select
                  value={collectionSubtype}
                  onValueChange={(value) => setCollectionSubtype(value as CollectionSubtype)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {COLLECTION_SUBTYPE_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <div className="rounded-md border px-3 py-2 text-xs text-muted-foreground">
                  Standard
                </div>
              )}
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
            <p className="mt-1.5 text-xs text-muted-foreground">
              {effectiveSelectedSkill
                ? `Using skill: ${effectiveSelectedSkill.name}`
                : willQueueSkillTask
                  ? hasSubtype
                    ? `No matching skill for ${selectedPageLabel} / ${selectedSubtypeLabel}. A high-priority "Create Skill" task will be queued.`
                    : `No matching skill for ${selectedPageLabel}. A high-priority "Create Skill" task will be queued.`
                  : 'Select Auto-detect to match by page type and content type.'}
            </p>
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
