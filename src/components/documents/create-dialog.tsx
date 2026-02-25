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
import { CONTENT_TYPE_LABELS, type ContentType } from '@/types/document';

interface CreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}

export function CreateDialog({ open, onOpenChange, onCreated }: CreateDialogProps) {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [contentType, setContentType] = useState<ContentType>('blog_post');
  const [keyword, setKeyword] = useState('');
  const [creating, setCreating] = useState(false);

  const handleCreate = async () => {
    setCreating(true);
    try {
      const res = await fetch('/api/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim() || 'Untitled',
          contentType,
          targetKeyword: keyword.trim() || null,
        }),
      });
      if (res.ok) {
        const doc = await res.json();
        onCreated();
        onOpenChange(false);
        setTitle('');
        setKeyword('');
        router.push(`/documents/${doc.id}`);
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
            <label className="text-sm font-medium mb-1.5 block">Content Type</label>
            <Select value={contentType} onValueChange={(val) => setContentType(val as ContentType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(CONTENT_TYPE_LABELS).map(([key, label]) => (
                  <SelectItem key={key} value={key}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={creating}>
            {creating && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
