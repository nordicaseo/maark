'use client';

import { useState } from 'react';
import { Loader2, RefreshCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AGENT_FILE_KEYS, type AgentFileKey } from '@/types/agent-profile';
import { FILE_HINTS, type ProfileDraft } from '../_lib/agent-helpers';

interface WorkspaceFilesTabProps {
  draft: ProfileDraft;
  onDraftChange: (updater: (prev: ProfileDraft) => ProfileDraft) => void;
  generationRunning: boolean;
  onRunGeneration: () => void;
  generationDescription: string;
  onGenerationDescriptionChange: (value: string) => void;
  generationUrls: string;
  onGenerationUrlsChange: (value: string) => void;
  onGenerationFilesChange: (files: File[]) => void;
  activeProjectId: number | null;
}

export function WorkspaceFilesTab({
  draft,
  onDraftChange,
  generationRunning,
  onRunGeneration,
  generationDescription,
  onGenerationDescriptionChange,
  generationUrls,
  onGenerationUrlsChange,
  onGenerationFilesChange,
  activeProjectId,
}: WorkspaceFilesTabProps) {
  const [activeFile, setActiveFile] = useState<AgentFileKey>('SOUL');

  return (
    <div className="space-y-4">
      {/* Workspace Files */}
      <div className="border border-border rounded-lg bg-card p-4">
        <h3 className="font-semibold text-sm mb-2">Role Workspace Files</h3>
        <Tabs value={activeFile} onValueChange={(value) => setActiveFile(value as AgentFileKey)}>
          <TabsList className="grid grid-cols-4 h-auto gap-1 bg-muted/70 p-1">
            {AGENT_FILE_KEYS.map((key) => (
              <TabsTrigger key={key} value={key} className="text-[11px] px-2 py-1.5">
                {key}
              </TabsTrigger>
            ))}
          </TabsList>
          {AGENT_FILE_KEYS.map((key) => (
            <TabsContent key={key} value={key} className="mt-3">
              <p className="text-xs text-muted-foreground mb-2">{FILE_HINTS[key]}</p>
              <Textarea
                value={draft.fileBundle[key]}
                onChange={(e) =>
                  onDraftChange((prev) => ({
                    ...prev,
                    fileBundle: {
                      ...prev.fileBundle,
                      [key]: e.target.value,
                    },
                  }))
                }
                className="min-h-[280px] font-mono text-xs"
              />
            </TabsContent>
          ))}
        </Tabs>
      </div>

      {/* Auto Generate */}
      <div className="border border-border rounded-lg bg-card p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h3 className="font-semibold text-sm">Auto Generate Identity + Knowledge</h3>
            <p className="text-xs text-muted-foreground">
              Generate workspace files and knowledge from a description, URLs, or uploaded files.
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={onRunGeneration}
            disabled={!activeProjectId || generationRunning}
          >
            {generationRunning ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
            ) : (
              <RefreshCcw className="h-3.5 w-3.5 mr-1" />
            )}
            Generate
          </Button>
        </div>
        <Textarea
          value={generationDescription}
          onChange={(e) => onGenerationDescriptionChange(e.target.value)}
          className="min-h-[72px] text-xs"
          placeholder="Describe the project, audience, products/services, and writing goals..."
        />
        <Textarea
          value={generationUrls}
          onChange={(e) => onGenerationUrlsChange(e.target.value)}
          className="min-h-[64px] text-xs"
          placeholder="Optional source URLs (one per line)"
        />
        <Input
          type="file"
          multiple
          accept=".txt,.md,.markdown,.csv"
          onChange={(e) => onGenerationFilesChange(Array.from(e.target.files || []))}
        />
        <p className="text-[11px] text-muted-foreground">
          Uses Super Admin AI model action `skill_generation` for compatibility.
        </p>
      </div>
    </div>
  );
}
