'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight, Loader2, Save, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  AGENT_KNOWLEDGE_PART_TYPES,
  type AgentRole,
  type ProjectAgentProfile,
} from '@/types/agent-profile';
import {
  roleLabel,
  formatDate,
  knowledgePartValue,
  upsertKnowledgePart,
  type ProfileDraft,
} from '../_lib/agent-helpers';

interface ProfileTabProps {
  selectedRole: AgentRole;
  selectedProfile: ProjectAgentProfile | null;
  draft: ProfileDraft;
  onDraftChange: (updater: (prev: ProfileDraft) => ProfileDraft) => void;
  modelOverridesJson: string;
  onModelOverridesJsonChange: (value: string) => void;
  savingProfile: boolean;
  onSaveProfile: () => void;
  activeProjectId: number | null;
}

export function ProfileTab({
  selectedRole,
  selectedProfile,
  draft,
  onDraftChange,
  modelOverridesJson,
  onModelOverridesJsonChange,
  savingProfile,
  onSaveProfile,
  activeProjectId,
}: ProfileTabProps) {
  return (
    <div className="space-y-4">
      {/* Identity */}
      <div className="border border-border rounded-lg bg-card p-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold">
              {draft.emoji ? `${draft.emoji} ` : ''}
              {draft.displayName || roleLabel(selectedRole)}
            </h2>
            <p className="text-xs text-muted-foreground">{roleLabel(selectedRole)}</p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={draft.isEnabled ? 'default' : 'secondary'}>
              {draft.isEnabled ? 'Enabled' : 'Disabled'}
            </Badge>
            <Button onClick={onSaveProfile} disabled={savingProfile || !activeProjectId}>
              {savingProfile ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1" />
              ) : (
                <Save className="h-4 w-4 mr-1" />
              )}
              Save Profile
            </Button>
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-3 mt-4">
          <div>
            <label className="text-xs font-medium mb-1 block">Display Name</label>
            <Input
              value={draft.displayName}
              onChange={(e) => onDraftChange((prev) => ({ ...prev, displayName: e.target.value }))}
            />
          </div>
          <div>
            <label className="text-xs font-medium mb-1 block">Emoji</label>
            <Input
              value={draft.emoji}
              onChange={(e) => onDraftChange((prev) => ({ ...prev, emoji: e.target.value }))}
            />
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-3 mt-3">
          <div>
            <label className="text-xs font-medium mb-1 block">Short Description</label>
            <Input
              value={draft.shortDescription}
              placeholder="What this agent does"
              onChange={(e) =>
                onDraftChange((prev) => ({ ...prev, shortDescription: e.target.value }))
              }
            />
          </div>
          <div className="flex items-end">
            <div className="flex items-center gap-2">
              <Checkbox
                id="agent-enabled"
                checked={draft.isEnabled}
                onCheckedChange={(checked) =>
                  onDraftChange((prev) => ({ ...prev, isEnabled: checked === true }))
                }
              />
              <label htmlFor="agent-enabled" className="text-sm">
                Role enabled
              </label>
            </div>
          </div>
        </div>

        <div className="mt-3">
          <label className="text-xs font-medium mb-1 block">Mission</label>
          <Textarea
            value={draft.mission}
            onChange={(e) => onDraftChange((prev) => ({ ...prev, mission: e.target.value }))}
            className="min-h-[72px]"
          />
        </div>

        <div className="mt-3 text-xs text-muted-foreground">
          Last heartbeat: {formatDate(selectedProfile?.heartbeatMeta?.lastRunAt)}
          {' · '}
          Last memory update: {formatDate(selectedProfile?.heartbeatMeta?.lastMemoryUpdateAt)}
        </div>
      </div>

      {/* Knowledge - Collapsible */}
      <div className="border border-border rounded-lg bg-card p-4">
        <h3 className="font-semibold text-sm mb-2 flex items-center gap-2">
          <ShieldCheck className="h-4 w-4" /> Agent Knowledge
        </h3>
        <p className="text-xs text-muted-foreground mb-3">
          Project-scoped knowledge for this agent role. This is the active instruction layer for workflows.
        </p>
        <CollapsibleKnowledge
          knowledgeParts={draft.knowledgeParts}
          onUpdate={(partType, content) =>
            onDraftChange((prev) => ({
              ...prev,
              knowledgeParts: upsertKnowledgePart(prev.knowledgeParts, partType, content),
            }))
          }
        />
      </div>

      {/* Model Overrides */}
      <div className="border border-border rounded-lg bg-card p-4">
        <h3 className="font-semibold text-sm mb-2">Model Overrides (JSON)</h3>
        <p className="text-xs text-muted-foreground mb-3">
          Keys can be stage/action names such as `research`, `outline_build`, `writing`, or `workflow`.
        </p>
        <Textarea
          value={modelOverridesJson}
          onChange={(e) => onModelOverridesJsonChange(e.target.value)}
          className="min-h-[120px] font-mono text-xs"
        />
      </div>
    </div>
  );
}

function CollapsibleKnowledge({
  knowledgeParts,
  onUpdate,
}: {
  knowledgeParts: ProfileDraft['knowledgeParts'];
  onUpdate: (
    partType: (typeof AGENT_KNOWLEDGE_PART_TYPES)[number],
    content: string
  ) => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const initial = new Set<string>();
    for (const pt of AGENT_KNOWLEDGE_PART_TYPES) {
      if (knowledgePartValue(knowledgeParts, pt)) {
        initial.add(pt);
      }
    }
    return initial;
  });

  const toggle = (pt: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(pt)) {
        next.delete(pt);
      } else {
        next.add(pt);
      }
      return next;
    });
  };

  return (
    <div className="space-y-1">
      {AGENT_KNOWLEDGE_PART_TYPES.map((partType) => {
        const value = knowledgePartValue(knowledgeParts, partType);
        const isOpen = expanded.has(partType);
        const charCount = value.length;
        return (
          <div key={partType} className="border border-border/50 rounded-md">
            <button
              type="button"
              onClick={() => toggle(partType)}
              className="w-full flex items-center justify-between gap-2 px-3 py-2 hover:bg-accent/30 transition-colors rounded-md"
            >
              <span className="text-xs font-medium capitalize">
                {partType.replace(/_/g, ' ')}
              </span>
              <div className="flex items-center gap-2">
                {charCount > 0 && (
                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                    {charCount} chars
                  </Badge>
                )}
                {isOpen ? (
                  <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                )}
              </div>
            </button>
            {isOpen && (
              <div className="px-3 pb-3">
                <Textarea
                  value={value}
                  onChange={(e) => onUpdate(partType, e.target.value)}
                  className="min-h-[84px] text-xs"
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
