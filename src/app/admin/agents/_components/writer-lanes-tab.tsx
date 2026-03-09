'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight, Loader2, Save, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  AGENT_FILE_KEYS,
  AGENT_KNOWLEDGE_PART_TYPES,
  type AgentFileKey,
  type AgentRole,
} from '@/types/agent-profile';
import type { AgentLaneKey, ProjectLaneCapacitySettings } from '@/types/agent-runtime';
import {
  FILE_HINTS,
  laneLabel,
  knowledgePartValue,
  upsertKnowledgePart,
  type ProfileDraft,
} from '../_lib/agent-helpers';

interface WriterLanesTabProps {
  selectedRole: AgentRole;
  selectedLane: AgentLaneKey;
  laneDraft: ProfileDraft;
  onLaneDraftChange: (updater: (prev: ProfileDraft) => ProfileDraft) => void;
  laneModelOverridesJson: string;
  onLaneModelOverridesJsonChange: (value: string) => void;
  laneCapacity: ProjectLaneCapacitySettings;
  onLaneCapacityChange: (updater: (prev: ProjectLaneCapacitySettings) => ProjectLaneCapacitySettings) => void;
  savingLaneProfile: boolean;
  syncingLaneRuntime: boolean;
  onSaveLaneProfile: () => void;
  onSyncLaneRuntime: () => void;
  activeProjectId: number | null;
}

export function WriterLanesTab({
  selectedRole,
  selectedLane,
  laneDraft,
  onLaneDraftChange,
  laneModelOverridesJson,
  onLaneModelOverridesJsonChange,
  laneCapacity,
  onLaneCapacityChange,
  savingLaneProfile,
  syncingLaneRuntime,
  onSaveLaneProfile,
  onSyncLaneRuntime,
  activeProjectId,
}: WriterLanesTabProps) {
  const [laneActiveFile, setLaneActiveFile] = useState<AgentFileKey>('SOUL');

  if (selectedRole !== 'writer') {
    return (
      <div className="border border-border rounded-lg bg-card p-8 text-center">
        <p className="text-muted-foreground text-sm">
          Writer Lanes are only available for the <strong>Writer</strong> role.
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          Select the Writer role from the sidebar to configure lane profiles.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header + Actions */}
      <div className="border border-border rounded-lg bg-card p-4 space-y-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h3 className="font-semibold text-sm">
              Writer Lane Profile: {laneLabel(selectedLane)}
            </h3>
            <p className="text-xs text-muted-foreground">
              Full file profile, lane knowledge, and model overrides for the {laneLabel(selectedLane)} lane.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={onSyncLaneRuntime}
              disabled={!activeProjectId || syncingLaneRuntime}
            >
              {syncingLaneRuntime ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1" />
              ) : (
                <ShieldCheck className="h-4 w-4 mr-1" />
              )}
              Sync Lanes
            </Button>
            <Button onClick={onSaveLaneProfile} disabled={savingLaneProfile || !activeProjectId}>
              {savingLaneProfile ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1" />
              ) : (
                <Save className="h-4 w-4 mr-1" />
              )}
              Save Lane
            </Button>
          </div>
        </div>

        {/* Capacity Settings */}
        <div className="grid md:grid-cols-4 gap-3">
          <div>
            <label className="text-xs font-medium mb-1 block">Min/Lane</label>
            <Input
              type="number"
              min={1}
              max={5}
              value={laneCapacity.minWritersPerLane}
              onChange={(e) =>
                onLaneCapacityChange((prev) => ({
                  ...prev,
                  minWritersPerLane: Math.max(1, Math.min(5, Number(e.target.value) || 1)),
                }))
              }
            />
          </div>
          <div>
            <label className="text-xs font-medium mb-1 block">Max/Lane</label>
            <Input
              type="number"
              min={1}
              max={8}
              value={laneCapacity.maxWritersPerLane}
              onChange={(e) =>
                onLaneCapacityChange((prev) => ({
                  ...prev,
                  maxWritersPerLane: Math.max(
                    prev.minWritersPerLane,
                    Math.min(8, Number(e.target.value) || prev.minWritersPerLane)
                  ),
                }))
              }
            />
          </div>
          <div>
            <label className="text-xs font-medium mb-1 block">Scale Up Queue Age (sec)</label>
            <Input
              type="number"
              min={30}
              max={3600}
              value={laneCapacity.scaleUpQueueAgeSec}
              onChange={(e) =>
                onLaneCapacityChange((prev) => ({
                  ...prev,
                  scaleUpQueueAgeSec: Math.max(30, Math.min(3600, Number(e.target.value) || prev.scaleUpQueueAgeSec)),
                }))
              }
            />
          </div>
          <div>
            <label className="text-xs font-medium mb-1 block">Scale Down Idle (sec)</label>
            <Input
              type="number"
              min={300}
              max={86400}
              value={laneCapacity.scaleDownIdleSec}
              onChange={(e) =>
                onLaneCapacityChange((prev) => ({
                  ...prev,
                  scaleDownIdleSec: Math.max(300, Math.min(86400, Number(e.target.value) || prev.scaleDownIdleSec)),
                }))
              }
            />
          </div>
        </div>

        {/* Lane Identity */}
        <div className="grid md:grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium mb-1 block">Display Name</label>
            <Input
              value={laneDraft.displayName}
              onChange={(e) =>
                onLaneDraftChange((prev) => ({ ...prev, displayName: e.target.value }))
              }
            />
          </div>
          <div>
            <label className="text-xs font-medium mb-1 block">Emoji</label>
            <Input
              value={laneDraft.emoji}
              onChange={(e) =>
                onLaneDraftChange((prev) => ({ ...prev, emoji: e.target.value }))
              }
            />
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium mb-1 block">Short Description</label>
            <Input
              value={laneDraft.shortDescription}
              onChange={(e) =>
                onLaneDraftChange((prev) => ({ ...prev, shortDescription: e.target.value }))
              }
            />
          </div>
          <div className="flex items-end">
            <div className="flex items-center gap-2">
              <Checkbox
                id="lane-enabled"
                checked={laneDraft.isEnabled}
                onCheckedChange={(checked) =>
                  onLaneDraftChange((prev) => ({ ...prev, isEnabled: checked === true }))
                }
              />
              <label htmlFor="lane-enabled" className="text-sm">
                Lane enabled
              </label>
            </div>
          </div>
        </div>

        <div>
          <label className="text-xs font-medium mb-1 block">Mission</label>
          <Textarea
            value={laneDraft.mission}
            onChange={(e) =>
              onLaneDraftChange((prev) => ({ ...prev, mission: e.target.value }))
            }
            className="min-h-[72px]"
          />
        </div>
      </div>

      {/* Lane Knowledge - Collapsible */}
      <div className="border border-border rounded-lg bg-card p-4">
        <h4 className="font-semibold text-sm mb-2">Lane Knowledge</h4>
        <LaneCollapsibleKnowledge
          knowledgeParts={laneDraft.knowledgeParts}
          onUpdate={(partType, content) =>
            onLaneDraftChange((prev) => ({
              ...prev,
              knowledgeParts: upsertKnowledgePart(prev.knowledgeParts, partType, content),
            }))
          }
        />
      </div>

      {/* Lane Model Overrides */}
      <div className="border border-border rounded-lg bg-card p-4">
        <h4 className="font-semibold text-sm mb-2">Lane Model Overrides (JSON)</h4>
        <Textarea
          value={laneModelOverridesJson}
          onChange={(e) => onLaneModelOverridesJsonChange(e.target.value)}
          className="min-h-[120px] font-mono text-xs"
        />
      </div>

      {/* Lane Workspace Files */}
      <div className="border border-border rounded-lg bg-card p-4">
        <h4 className="font-semibold text-sm mb-2">Lane Workspace Files</h4>
        <Tabs
          value={laneActiveFile}
          onValueChange={(value) => setLaneActiveFile(value as AgentFileKey)}
        >
          <TabsList className="grid grid-cols-4 h-auto gap-1 bg-muted/70 p-1">
            {AGENT_FILE_KEYS.map((key) => (
              <TabsTrigger key={`lane-tab-${key}`} value={key} className="text-[11px] px-2 py-1.5">
                {key}
              </TabsTrigger>
            ))}
          </TabsList>
          {AGENT_FILE_KEYS.map((key) => (
            <TabsContent key={`lane-content-${key}`} value={key} className="mt-3">
              <p className="text-xs text-muted-foreground mb-2">{FILE_HINTS[key]}</p>
              <Textarea
                value={laneDraft.fileBundle[key]}
                onChange={(e) =>
                  onLaneDraftChange((prev) => ({
                    ...prev,
                    fileBundle: {
                      ...prev.fileBundle,
                      [key]: e.target.value,
                    },
                  }))
                }
                className="min-h-[220px] font-mono text-xs"
              />
            </TabsContent>
          ))}
        </Tabs>
      </div>
    </div>
  );
}

function LaneCollapsibleKnowledge({
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
      if (next.has(pt)) next.delete(pt);
      else next.add(pt);
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
