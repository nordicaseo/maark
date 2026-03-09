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
import { Loader2, Sparkles, X } from 'lucide-react';
import type { ContentType } from '@/types/document';

interface AiWritingPanelProps {
  contentType: ContentType;
  targetKeyword: string | null;
  existingContent: string;
  projectId?: number | null;
  isWriting?: boolean;
  onLiveGenerate: (instruction: string, tone: string) => void;
  onCancel: () => void;
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
  targetKeyword,
  isWriting,
  onLiveGenerate,
  onCancel,
}: AiWritingPanelProps) {
  const [instruction, setInstruction] = useState('');
  const [tone, setTone] = useState('professional');

  const handleWrite = useCallback(() => {
    if (!instruction.trim()) return;
    onLiveGenerate(instruction, tone);
  }, [instruction, tone, onLiveGenerate]);

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Instruction
        </label>
        <Textarea
          placeholder="Write an introduction about... / Expand on this point... / Create a full article..."
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          rows={3}
          className="resize-none text-sm"
          disabled={isWriting}
        />
      </div>

      <div className="flex gap-2">
        <div className="flex-1">
          <Select value={tone} onValueChange={setTone} disabled={isWriting}>
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
        {isWriting ? (
          <Button size="sm" variant="destructive" onClick={onCancel} className="h-8">
            <X className="h-3.5 w-3.5 mr-1" />
            Stop
          </Button>
        ) : (
          <Button
            size="sm"
            onClick={handleWrite}
            disabled={!instruction.trim()}
            className="h-8"
          >
            <Sparkles className="h-3.5 w-3.5 mr-1" />
            Write
          </Button>
        )}
      </div>

      {targetKeyword && (
        <p className="text-xs text-muted-foreground">
          Target keyword: <span className="font-medium text-foreground">{targetKeyword}</span>
        </p>
      )}

      {isWriting && (
        <div className="flex items-center gap-2 p-3 rounded-md border border-primary/20 bg-primary/5">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          <span className="text-xs text-primary">Writing directly into your editor...</span>
        </div>
      )}
    </div>
  );
}
