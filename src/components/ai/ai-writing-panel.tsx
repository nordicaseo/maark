'use client';

import { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2, Bot, ArrowUp, X } from 'lucide-react';
import type { ContentType } from '@/types/document';

interface AiWritingPanelProps {
  contentType: ContentType;
  targetKeyword: string | null;
  existingContent: string;
  projectId?: number | null;
  isWriting?: boolean;
  onLiveGenerate: (instruction: string, tone: string) => void;
  onCancel: () => void;
  hasSelection?: boolean;
}

const TONES = [
  { value: 'professional', label: 'Professional' },
  { value: 'casual', label: 'Casual' },
  { value: 'authoritative', label: 'Authoritative' },
  { value: 'friendly', label: 'Friendly' },
  { value: 'technical', label: 'Technical' },
  { value: 'conversational', label: 'Conversational' },
];

function QuickAction({
  label,
  onClick,
  disabled,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="text-[11px] px-2.5 py-1 rounded-full border border-border hover:bg-accent transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
    >
      {label}
    </button>
  );
}

export function AiWritingPanel({
  targetKeyword,
  isWriting,
  onLiveGenerate,
  onCancel,
  hasSelection,
}: AiWritingPanelProps) {
  const [instruction, setInstruction] = useState('');
  const [tone, setTone] = useState('professional');

  const handleWrite = useCallback(() => {
    if (!instruction.trim()) return;
    onLiveGenerate(instruction, tone);
  }, [instruction, tone, onLiveGenerate]);

  const handleQuickAction = useCallback((text: string) => {
    setInstruction(text);
    onLiveGenerate(text, tone);
  }, [tone, onLiveGenerate]);

  const placeholder = hasSelection
    ? 'Edit this selection…'
    : 'Ask Atlas to write…';

  return (
    <div className="space-y-3">
      {/* Agent header */}
      <div className="flex items-center gap-2.5">
        <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
          <Bot className="h-4 w-4 text-primary" />
        </div>
        <div>
          <p className="text-xs font-medium leading-none">Atlas</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">Ready to assist</p>
        </div>
      </div>

      {/* Chat-style input */}
      <div className="rounded-xl border border-border bg-background p-2 space-y-2">
        {/* Tone pill + keyword pill */}
        <div className="flex items-center gap-1.5 px-1">
          <Select value={tone} onValueChange={setTone} disabled={isWriting}>
            <SelectTrigger className="h-6 w-auto text-[10px] rounded-full border-0 bg-muted px-2.5 gap-1 shadow-none">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TONES.map((t) => (
                <SelectItem key={t.value} value={t.value} className="text-xs">
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {targetKeyword && (
            <span className="text-[10px] text-muted-foreground bg-muted rounded-full px-2.5 py-0.5 truncate max-w-[120px]">
              {targetKeyword}
            </span>
          )}
        </div>

        {/* Input + send button */}
        <div className="flex items-end gap-2">
          <Textarea
            placeholder={placeholder}
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            rows={2}
            className="resize-none text-sm border-0 shadow-none focus-visible:ring-0 p-1 min-h-[40px]"
            disabled={isWriting}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleWrite();
              }
            }}
          />
          {isWriting ? (
            <Button
              size="icon"
              variant="destructive"
              className="h-8 w-8 shrink-0 rounded-full"
              onClick={onCancel}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          ) : (
            <Button
              size="icon"
              className="h-8 w-8 shrink-0 rounded-full"
              onClick={handleWrite}
              disabled={!instruction.trim()}
            >
              <ArrowUp className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>

      {/* Quick actions */}
      <div className="flex gap-1.5 flex-wrap">
        <QuickAction
          label="Make punchier"
          onClick={() => handleQuickAction('Make the content punchier and more engaging')}
          disabled={isWriting}
        />
        <QuickAction
          label="Expand section"
          onClick={() => handleQuickAction('Expand this section with more detail and examples')}
          disabled={isWriting}
        />
        {targetKeyword && (
          <QuickAction
            label={`Optimize for "${targetKeyword}"`}
            onClick={() => handleQuickAction(`Optimize the content for the keyword "${targetKeyword}"`)}
            disabled={isWriting}
          />
        )}
      </div>

      {/* Writing status */}
      {isWriting && (
        <div className="flex items-center gap-2 p-3 rounded-lg border border-primary/20 bg-primary/5">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          <span className="text-xs text-primary">Writing directly into your editor…</span>
        </div>
      )}
    </div>
  );
}
