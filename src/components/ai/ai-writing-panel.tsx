'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2, Sparkles, X, BookOpen } from 'lucide-react';
import type { ContentType } from '@/types/document';
import type { Skill } from '@/types/skill';

interface AiWritingPanelProps {
  contentType: ContentType;
  targetKeyword: string | null;
  existingContent: string;
  projectId?: number | null;
  isWriting?: boolean;
  onLiveGenerate: (instruction: string, tone: string, skillContent?: string) => void;
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
  contentType,
  targetKeyword,
  existingContent,
  projectId,
  isWriting,
  onLiveGenerate,
  onCancel,
}: AiWritingPanelProps) {
  const [instruction, setInstruction] = useState('');
  const [tone, setTone] = useState('professional');
  const [selectedSkillId, setSelectedSkillId] = useState<string>('none');
  const [skills, setSkills] = useState<Skill[]>([]);

  useEffect(() => {
    const fetchSkills = async () => {
      try {
        const url = projectId ? `/api/skills?projectId=${projectId}` : '/api/skills';
        const res = await fetch(url);
        if (res.ok) setSkills(await res.json());
      } catch {}
    };
    fetchSkills();
  }, [projectId]);

  const handleWrite = useCallback(() => {
    if (!instruction.trim()) return;
    const skill = skills.find((s) => s.id.toString() === selectedSkillId);
    onLiveGenerate(instruction, tone, skill?.content);
  }, [instruction, tone, selectedSkillId, skills, onLiveGenerate]);

  const globalSkills = skills.filter((s) => s.isGlobal === 1);
  const projectSkills = skills.filter((s) => s.isGlobal !== 1 && s.projectId === projectId);

  return (
    <div className="space-y-3">
      {/* Skill selector */}
      {skills.length > 0 && (
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1">
            <BookOpen className="h-3 w-3" />
            Skill
          </label>
          <Select value={selectedSkillId} onValueChange={setSelectedSkillId} disabled={isWriting}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="No skill" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No skill</SelectItem>
              {projectSkills.length > 0 && (
                <SelectGroup>
                  <SelectLabel>Project Skills</SelectLabel>
                  {projectSkills.map((s) => (
                    <SelectItem key={s.id} value={s.id.toString()} className="text-xs">
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              )}
              {globalSkills.length > 0 && (
                <SelectGroup>
                  <SelectLabel>Global Skills</SelectLabel>
                  {globalSkills.map((s) => (
                    <SelectItem key={s.id} value={s.id.toString()} className="text-xs">
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              )}
            </SelectContent>
          </Select>
        </div>
      )}

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
