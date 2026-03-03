'use client';

import { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Loader2, Upload } from 'lucide-react';

interface SkillImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: () => void;
  projectId?: number | null;
}

function parseFrontmatter(text: string): { name: string; description: string; content: string } {
  const frontmatterRegex = /^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/;
  const match = text.match(frontmatterRegex);

  if (!match) {
    // No frontmatter — use first line as name
    const lines = text.trim().split('\n');
    const firstLine = lines[0].replace(/^#\s*/, '').trim();
    return {
      name: firstLine || 'Imported Skill',
      description: '',
      content: text.trim(),
    };
  }

  const frontmatter = match[1];
  const body = match[2].trim();

  let name = 'Imported Skill';
  let description = '';

  for (const line of frontmatter.split('\n')) {
    const [key, ...vals] = line.split(':');
    const value = vals.join(':').trim();
    if (key.trim() === 'name') name = value;
    if (key.trim() === 'description') description = value;
  }

  return { name, description, content: body };
}

export function SkillImportDialog({ open, onOpenChange, onImported, projectId }: SkillImportDialogProps) {
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<{ name: string; description: string; content: string } | null>(null);
  const [file, setFile] = useState<File | null>(null);

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setError('');

    try {
      const text = await f.text();
      const parsed = parseFrontmatter(text);
      setPreview(parsed);
    } catch {
      setError('Failed to read file');
    }
  }, []);

  const handleImport = async () => {
    if (!preview) return;
    setImporting(true);
    try {
      const res = await fetch('/api/skills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: preview.name,
          description: preview.description || null,
          content: preview.content,
          projectId: projectId ?? null,
          isGlobal: projectId ? 0 : 1,
        }),
      });
      if (res.ok) {
        onImported();
        onOpenChange(false);
        setPreview(null);
        setFile(null);
      } else {
        setError('Failed to import skill');
      }
    } catch {
      setError('Failed to import skill');
    }
    setImporting(false);
  };

  const handleClose = (open: boolean) => {
    if (!open) {
      setPreview(null);
      setFile(null);
      setError('');
    }
    onOpenChange(open);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Import Skill</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div>
            <label
              htmlFor="skill-file"
              className="flex flex-col items-center justify-center gap-2 p-8 border-2 border-dashed border-border rounded-lg cursor-pointer hover:bg-accent/50 transition-colors"
            >
              <Upload className="h-8 w-8 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">
                {file ? file.name : 'Click to select a .md file'}
              </span>
              <input
                id="skill-file"
                type="file"
                accept=".md,.txt,.markdown"
                onChange={handleFileSelect}
                className="hidden"
              />
            </label>
          </div>

          {preview && (
            <div className="space-y-2 rounded-md border border-border p-3 bg-background">
              <div>
                <span className="text-xs font-medium text-muted-foreground">Name:</span>
                <p className="text-sm font-medium">{preview.name}</p>
              </div>
              {preview.description && (
                <div>
                  <span className="text-xs font-medium text-muted-foreground">Description:</span>
                  <p className="text-sm">{preview.description}</p>
                </div>
              )}
              <div>
                <span className="text-xs font-medium text-muted-foreground">Content preview:</span>
                <pre className="text-xs mt-1 p-2 rounded bg-muted max-h-[150px] overflow-auto whitespace-pre-wrap">
                  {preview.content.slice(0, 500)}
                  {preview.content.length > 500 ? '...' : ''}
                </pre>
              </div>
            </div>
          )}

          {error && <p className="text-xs text-red-400">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => handleClose(false)}>
            Cancel
          </Button>
          <Button onClick={handleImport} disabled={importing || !preview}>
            {importing && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Import
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
