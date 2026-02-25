'use client';

import { useState, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2, Sparkles, Copy, Check, X, ArrowDownToLine } from 'lucide-react';
import type { ContentType } from '@/types/document';

interface AiWritingPanelProps {
  contentType: ContentType;
  targetKeyword: string | null;
  existingContent: string;
  onInsert: (text: string) => void;
}

const TONES = [
  { value: 'professional', label: 'Professional' },
  { value: 'casual', label: 'Casual' },
  { value: 'authoritative', label: 'Authoritative' },
  { value: 'friendly', label: 'Friendly' },
  { value: 'technical', label: 'Technical' },
  { value: 'conversational', label: 'Conversational' },
];

export function AiWritingPanel({
  contentType,
  targetKeyword,
  existingContent,
  onInsert,
}: AiWritingPanelProps) {
  const [instruction, setInstruction] = useState('');
  const [tone, setTone] = useState('professional');
  const [generating, setGenerating] = useState(false);
  const [output, setOutput] = useState('');
  const [copied, setCopied] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const handleGenerate = useCallback(async () => {
    if (!instruction.trim()) return;

    setGenerating(true);
    setOutput('');

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch('/api/ai/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instruction,
          contentType,
          targetKeyword,
          existingContent: existingContent.slice(0, 2000),
          tone,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Generation failed' }));
        setOutput(`Error: ${err.error || 'Generation failed'}`);
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
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        setOutput(`Error: ${err.message || 'Generation failed'}`);
      }
    }

    setGenerating(false);
  }, [instruction, contentType, targetKeyword, existingContent, tone]);

  const handleCancel = useCallback(() => {
    abortRef.current?.abort();
    setGenerating(false);
  }, []);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(output);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [output]);

  const handleInsert = useCallback(() => {
    onInsert(output);
    setOutput('');
    setInstruction('');
  }, [output, onInsert]);

  const handleDiscard = useCallback(() => {
    setOutput('');
  }, []);

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Instruction
        </label>
        <Textarea
          placeholder="Write an introduction about... / Expand on this point... / Rewrite the following..."
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          rows={3}
          className="resize-none text-sm"
          disabled={generating}
        />
      </div>

      <div className="flex gap-2">
        <div className="flex-1">
          <Select value={tone} onValueChange={setTone} disabled={generating}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="Tone" />
            </SelectTrigger>
            <SelectContent>
              {TONES.map((t) => (
                <SelectItem key={t.value} value={t.value} className="text-xs">
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {generating ? (
          <Button size="sm" variant="destructive" onClick={handleCancel} className="h-8">
            <X className="h-3.5 w-3.5 mr-1" />
            Stop
          </Button>
        ) : (
          <Button
            size="sm"
            onClick={handleGenerate}
            disabled={!instruction.trim()}
            className="h-8"
          >
            <Sparkles className="h-3.5 w-3.5 mr-1" />
            Generate
          </Button>
        )}
      </div>

      {targetKeyword && (
        <p className="text-xs text-muted-foreground">
          Target keyword: <span className="font-medium text-foreground">{targetKeyword}</span>
        </p>
      )}

      {(output || generating) && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Output
            </label>
            {generating && (
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                Writing...
              </div>
            )}
          </div>

          <ScrollArea className="max-h-[300px]">
            <div className="rounded-md border border-border bg-background p-3 text-sm whitespace-pre-wrap leading-relaxed">
              {output || (
                <span className="text-muted-foreground italic">Generating...</span>
              )}
            </div>
          </ScrollArea>

          {output && !generating && (
            <div className="flex gap-1.5">
              <Button size="sm" variant="default" onClick={handleInsert} className="h-7 text-xs flex-1">
                <ArrowDownToLine className="h-3 w-3 mr-1" />
                Insert
              </Button>
              <Button size="sm" variant="outline" onClick={handleCopy} className="h-7 text-xs">
                {copied ? (
                  <Check className="h-3 w-3" />
                ) : (
                  <Copy className="h-3 w-3" />
                )}
              </Button>
              <Button size="sm" variant="ghost" onClick={handleDiscard} className="h-7 text-xs">
                <X className="h-3 w-3" />
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
