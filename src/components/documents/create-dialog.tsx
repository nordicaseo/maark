'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2 } from 'lucide-react';
import { withProjectScope } from '@/lib/project-context';
import {
  PAGE_TYPE_OPTIONS,
  BLOG_SUBTYPE_OPTIONS,
  COLLECTION_SUBTYPE_OPTIONS,
  DEFAULT_PAGE_TYPE,
  DEFAULT_BLOG_SUBTYPE,
  DEFAULT_COLLECTION_SUBTYPE,
  resolveDefaultContentType,
  type BlogSubtype,
  type CollectionSubtype,
  type PageType,
} from '@/lib/content-workflow-taxonomy';
import { triggerTopicWorkflowRun } from '@/lib/topic-workflow-client';

interface CreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
  projectId?: number | null;
}

export function CreateDialog({ open, onOpenChange, onCreated, projectId }: CreateDialogProps) {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [pageType, setPageType] = useState<PageType>(DEFAULT_PAGE_TYPE);
  const [blogSubtype, setBlogSubtype] = useState<BlogSubtype>(DEFAULT_BLOG_SUBTYPE);
  const [collectionSubtype, setCollectionSubtype] = useState<CollectionSubtype>(DEFAULT_COLLECTION_SUBTYPE);
  const [keyword, setKeyword] = useState('');
  const [creating, setCreating] = useState(false);
  const selectedSubtype =
    pageType === 'blog' ? blogSubtype : pageType === 'collection' ? collectionSubtype : 'standard';
  const contentType = resolveDefaultContentType(pageType, selectedSubtype);
  const subtypeControlLabel =
    pageType === 'blog'
      ? 'Blog Type'
      : pageType === 'collection'
        ? 'Collection Placement'
        : 'Content Type';

  const handleCreate = async () => {
    if (!projectId) return;
    setCreating(true);
    try {
      const res = await fetch('/api/topic-workflow/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          topic: title.trim() || 'Untitled',
          entryPoint: 'content_engine',
          contentType,
          targetKeyword: keyword.trim() || null,
          options: {
            outlineReviewOptional: true,
            seoReviewRequired: true,
          },
        }),
      });
      if (res.ok) {
        const created = await res.json();
        const documentId = created.contentDocumentId;
        if (created?.taskId) {
          triggerTopicWorkflowRun(created.taskId, {
            autoContinue: true,
            maxStages: 10,
            logLabel: 'topic workflow',
          });
        }
        onCreated();
        onOpenChange(false);
        setTitle('');
        setKeyword('');
        setPageType(DEFAULT_PAGE_TYPE);
        setBlogSubtype(DEFAULT_BLOG_SUBTYPE);
        setCollectionSubtype(DEFAULT_COLLECTION_SUBTYPE);
        if (documentId) {
          router.push(withProjectScope(`/documents/${documentId}`, projectId));
        } else {
          router.push(withProjectScope('/mission-control', projectId));
        }
      }
    } catch {}
    setCreating(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New Document</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div>
            <label className="text-sm font-medium mb-1.5 block">Title</label>
            <Input
              placeholder="Article title..."
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            />
          </div>
          <div>
            <label className="text-sm font-medium mb-1.5 block">Page Type</label>
            <Select value={pageType} onValueChange={(val) => setPageType(val as PageType)}>
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
              <Select value={blogSubtype} onValueChange={(val) => setBlogSubtype(val as BlogSubtype)}>
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
                onValueChange={(val) => setCollectionSubtype(val as CollectionSubtype)}
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
            <p className="text-xs text-muted-foreground mt-1">
              Mapped content format: {contentType}
            </p>
          </div>
          <div>
            <label className="text-sm font-medium mb-1.5 block">Target Keyword</label>
            <Input
              placeholder="e.g., best running shoes 2024"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
            />
            <p className="text-xs text-muted-foreground mt-1">
              Used for SERP entity analysis and semantic scoring
            </p>
          </div>
          {!projectId && (
            <p className="text-xs text-muted-foreground">
              Select a project first to create a topic workflow document.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={creating || !projectId}>
            {creating && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
