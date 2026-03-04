'use client';

import { useState, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Loader2, Sparkles, X } from 'lucide-react';

interface SkillGenerateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onGenerated: () => void;
  projectId?: number | null;
}

export function SkillGenerateDialog({ open, onOpenChange, onGenerated, projectId }: SkillGenerateDialogProps) {
  const [description, setDescription] = useState('');
  const [skillName, setSkillName] = useState('');
  const [generating, setGenerating] = useState(false);
  const [output, setOutput] = useState('');
  const [saving, setSaving] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const handleGenerate = useCallback(async () => {
    if (!description.trim()) return;
    setGenerating(true);
    setOutput('');

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch('/api/skills/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description,
          projectId: projectId ?? undefined,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        setOutput('Error: Generation failed');
        setGenerating(false);
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        setOutput('Error: No response stream');
        setGenerating(false);
        return;
      }

      const decoder = new TextDecoder();
      let text = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
        setOutput(text);
      }
    } catch (err: unknown) {
      if ((err as { name?: string })?.name !== 'AbortError') {
        setOutput(`Error: ${(err as { message?: string })?.message || 'Generation failed'}`);
      }
    }
    setGenerating(false);
  }, [description, projectId]);

  const handleCancel = useCallback(() => {
    abortRef.current?.abort();
    setGenerating(false);
  }, []);

  const handleSave = async () => {
    if (!output || !skillName.trim()) return;
    setSaving(true);
    try {
      const res = await fetch('/api/skills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: skillName.trim(),
          description: description.trim() || null,
          content: output,
          projectId: projectId ?? null,
          isGlobal: projectId ? 0 : 1,
        }),
      });
      if (res.ok) {
        onGenerated();
        onOpenChange(false);
        setDescription('');
        setSkillName('');
        setOutput('');
      }
    } catch {}
    setSaving(false);
  };

  const handleClose = (open: boolean) => {
    if (!open) {
      handleCancel();
      setOutput('');
      setDescription('');
      setSkillName('');
    }
    onOpenChange(open);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Generate Skill with AI</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div>
            <label className="text-sm font-medium mb-1.5 block">Describe the skill you want</label>
            <Textarea
              placeholder="e.g., A skill for writing product category pages for an organic food e-commerce store. Should include brand voice guidelines, content structure with above-grid and below-grid sections, FAQ format, and SEO optimization rules..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              className="resize-none text-sm"
              disabled={generating}
            />
          </div>

          <div className="flex gap-2">
            {generating ? (
              <Button size="sm" variant="destructive" onClick={handleCancel} className="h-8">
                <X className="h-3.5 w-3.5 mr-1" />
                Stop
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={handleGenerate}
                disabled={!description.trim()}
                className="h-8"
              >
                <Sparkles className="h-3.5 w-3.5 mr-1" />
                Generate Skill
              </Button>
            )}
          </div>

          {(output || generating) && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Generated Skill
                </label>
                {generating && (
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Generating...
                  </div>
                )}
              </div>

              <ScrollArea className="max-h-[300px]">
                <pre className="rounded-md border border-border bg-background p-3 text-xs whitespace-pre-wrap leading-relaxed font-mono">
                  {output || 'Generating...'}
                </pre>
              </ScrollArea>

              {output && !generating && (
                <div>
                  <label className="text-sm font-medium mb-1.5 block">Skill Name</label>
                  <Input
                    placeholder="Name for this skill..."
                    value={skillName}
                    onChange={(e) => setSkillName(e.target.value)}
                  />
                </div>
              )}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => handleClose(false)}>
            Cancel
          </Button>
          {output && !generating && (
            <Button onClick={handleSave} disabled={saving || !skillName.trim()}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Save Skill
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
