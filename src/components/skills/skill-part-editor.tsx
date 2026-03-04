'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Trash2, ChevronUp, ChevronDown } from 'lucide-react';
import { SKILL_PART_TYPES } from '@/types/skill-part';
import type { SkillPart, SkillPartType } from '@/types/skill-part';

interface SkillPartEditorProps {
  part: SkillPart;
  onChange: (updated: Partial<SkillPart>) => void;
  onDelete: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  isFirst?: boolean;
  isLast?: boolean;
}

export function SkillPartEditor({
  part,
  onChange,
  onDelete,
  onMoveUp,
  onMoveDown,
  isFirst,
  isLast,
}: SkillPartEditorProps) {
  const typeInfo = SKILL_PART_TYPES.find((t) => t.value === part.partType);

  return (
    <div className="border border-border rounded-lg p-4 space-y-3 bg-card">
      <div className="flex items-center gap-2">
        <div className="flex flex-col gap-0.5 shrink-0">
          <button
            onClick={onMoveUp}
            disabled={isFirst}
            className="h-4 w-4 flex items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-30"
          >
            <ChevronUp className="h-3 w-3" />
          </button>
          <button
            onClick={onMoveDown}
            disabled={isLast}
            className="h-4 w-4 flex items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-30"
          >
            <ChevronDown className="h-3 w-3" />
          </button>
        </div>

        <Select
          value={part.partType}
          onValueChange={(v) => onChange({ partType: v as SkillPartType })}
        >
          <SelectTrigger className="w-[180px] h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SKILL_PART_TYPES.map((t) => (
              <SelectItem key={t.value} value={t.value}>
                {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Input
          value={part.label}
          onChange={(e) => onChange({ label: e.target.value })}
          placeholder="Section label..."
          className="h-8 text-sm flex-1"
        />

        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-8 shrink-0 hover:text-red-400"
          onClick={onDelete}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      {typeInfo && (
        <p className="text-[11px] text-muted-foreground pl-7">
          {typeInfo.description}
        </p>
      )}

      <Textarea
        value={part.content}
        onChange={(e) => onChange({ content: e.target.value })}
        placeholder={`Enter ${typeInfo?.label || 'content'} details in markdown...`}
        rows={8}
        className="resize-y text-sm font-mono min-h-[120px]"
      />
    </div>
  );
}
