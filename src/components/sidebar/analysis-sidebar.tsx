'use client';

import { useEffect, useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog';
import { VisuallyHidden } from 'radix-ui';
import { AiDetectionPanel } from './ai-detection-panel';
import { AiReportDialog } from './ai-report-dialog';
import { SemanticPanel } from './semantic-panel';
import { QualityPanel } from './quality-panel';
import { AiWritingPanel } from '@/components/ai/ai-writing-panel';
import { CommentsPanel } from '@/components/editor/comments-panel';
import { Maximize2, Minimize2 } from 'lucide-react';
import type { Editor } from '@tiptap/react';
import type { Document } from '@/types/document';
import type { AiDetectionResult, ContentQualityResult, SemanticResult } from '@/types/analysis';
import type { SerpData } from '@/types/serp';

interface AnalysisSidebarProps {
  document: Document | null;
  aiResult: AiDetectionResult | null;
  qualityResult: ContentQualityResult | null;
  semanticResult: SemanticResult | null;
  serpData: SerpData | null;
  analyzing: boolean;
  plainText: string;
  onInsertAiText: (text: string) => void;
  onReplaceContent: (text: string) => void;
  isAiWriting?: boolean;
  onLiveGenerate: (instruction: string, tone: string, skillContent?: string) => void;
  onCancelGeneration: () => void;
  onUpdateDocument?: (updates: Partial<Document>) => void | Promise<void>;
  activeProjectId?: number | null;
  editor?: Editor | null;
  commentsRefreshKey?: number;
}

interface SidebarContentProps {
  document: Document;
  aiResult: AiDetectionResult | null;
  qualityResult: ContentQualityResult | null;
  semanticResult: SemanticResult | null;
  serpData: SerpData | null;
  analyzing: boolean;
  plainText: string;
  onInsertAiText: (text: string) => void;
  onReplaceContent: (text: string) => void;
  onOpenReport: () => void;
  expanded?: boolean;
  isAiWriting?: boolean;
  onLiveGenerate: (instruction: string, tone: string, skillContent?: string) => void;
  onCancelGeneration: () => void;
  onUpdateDocument?: (updates: Partial<Document>) => void | Promise<void>;
  activeProjectId?: number | null;
  editor?: Editor | null;
  commentsRefreshKey?: number;
}

function SidebarContent({
  document,
  aiResult,
  qualityResult,
  semanticResult,
  serpData,
  analyzing,
  plainText,
  onInsertAiText,
  onReplaceContent,
  onOpenReport,
  expanded,
  isAiWriting,
  onLiveGenerate,
  onCancelGeneration,
  onUpdateDocument,
  activeProjectId,
  editor,
  commentsRefreshKey,
}: SidebarContentProps) {
  void onInsertAiText;
  void onReplaceContent;

  const [researchSummary, setResearchSummary] = useState('');
  const [researchFacts, setResearchFacts] = useState('');
  const [researchStats, setResearchStats] = useState('');
  const [researchSources, setResearchSources] = useState('');
  const [outlineMarkdown, setOutlineMarkdown] = useState('');
  const [workflowSaving, setWorkflowSaving] = useState(false);
  const [rerunBusy, setRerunBusy] = useState<'research' | 'outline_build' | null>(null);
  const [workflowMessage, setWorkflowMessage] = useState<string | null>(null);

  useEffect(() => {
    setResearchSummary(document.researchSnapshot?.summary || '');
    setResearchFacts((document.researchSnapshot?.facts || []).join('\n'));
    setResearchStats(
      (document.researchSnapshot?.statistics || [])
        .map((stat) => `${stat.stat}${stat.source ? ` | ${stat.source}` : ''}`)
        .join('\n')
    );
    setResearchSources(
      (document.researchSnapshot?.sources || [])
        .map((source) => `${source.url}${source.title ? ` | ${source.title}` : ''}`)
        .join('\n')
    );
    setOutlineMarkdown(document.outlineSnapshot?.markdown || '');
  }, [
    document.id,
    document.researchSnapshot,
    document.outlineSnapshot,
  ]);

  const handleSaveWorkflowContext = async () => {
    if (!onUpdateDocument) return;
    setWorkflowSaving(true);
    setWorkflowMessage(null);
    try {
      const facts = researchFacts
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(0, 20);
      const statistics = researchStats
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(0, 20)
        .map((line) => {
          const [stat, source] = line.split('|').map((part) => part.trim());
          return source ? { stat, source } : { stat };
        })
        .filter((item) => item.stat);
      const sources = researchSources
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(0, 20)
        .map((line) => {
          const [url, title] = line.split('|').map((part) => part.trim());
          return title ? { url, title } : { url };
        })
        .filter((item) => item.url);
      const headings = outlineMarkdown
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.startsWith('## '))
        .map((line) => line.replace(/^##\s+/, '').trim())
        .filter(Boolean);

      await onUpdateDocument({
        researchSnapshot: {
          summary: researchSummary.trim(),
          facts,
          statistics,
          sources,
          analyzedAt: Date.now(),
        },
        outlineSnapshot: {
          markdown: outlineMarkdown,
          headingCount: headings.length,
          headings,
          generatedAt: Date.now(),
        },
      });
      setWorkflowMessage('Workflow context saved.');
    } catch {
      setWorkflowMessage('Failed to save workflow context.');
    } finally {
      setWorkflowSaving(false);
    }
  };

  const handleRerunFrom = async (fromStage: 'research' | 'outline_build') => {
    setRerunBusy(fromStage);
    setWorkflowMessage(null);
    try {
      const res = await fetch('/api/topic-workflow/rerun', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          documentId: document.id,
          fromStage,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Rerun failed');
      }
      setWorkflowMessage(
        fromStage === 'research'
          ? 'Workflow rerun started from Research and will pause before Writing.'
          : 'Workflow rerun started from Outline and will pause before Writing.'
      );
    } catch (error) {
      setWorkflowMessage((error as Error).message);
    } finally {
      setRerunBusy(null);
    }
  };

  return (
    <Tabs defaultValue="write" className="flex flex-col h-full">
      <TabsList className={`mx-3 mt-3 w-full grid grid-cols-3 sm:grid-cols-6 gap-1 h-auto shrink-0 ${expanded ? 'mx-4 mt-4' : ''}`}>
        <TabsTrigger value="write" className="text-[11px] min-h-8 px-2">Write</TabsTrigger>
        <TabsTrigger value="comments" className="text-[11px] min-h-8 px-2">Comments</TabsTrigger>
        <TabsTrigger value="workflow" className="text-[11px] min-h-8 px-2">Workflow</TabsTrigger>
        <TabsTrigger value="ai" className="text-[11px] min-h-8 px-2">AI</TabsTrigger>
        <TabsTrigger value="seo" className="text-[11px] min-h-8 px-2">SEO</TabsTrigger>
        <TabsTrigger value="quality" className="text-[11px] min-h-8 px-2">Quality</TabsTrigger>
      </TabsList>

      <div className="flex-1 overflow-y-auto min-h-0">
        <TabsContent value="write" className={`p-3 mt-0 ${expanded ? 'p-4 max-w-2xl mx-auto' : ''}`}>
          <AiWritingPanel
            contentType={document.contentType}
            targetKeyword={document.targetKeyword}
            existingContent={plainText}
            projectId={activeProjectId}
            isWriting={isAiWriting}
            onLiveGenerate={onLiveGenerate}
            onCancel={onCancelGeneration}
          />
        </TabsContent>

        <TabsContent value="comments" className="mt-0 h-full">
          <CommentsPanel
            documentId={document.id}
            editor={editor || null}
            refreshKey={commentsRefreshKey}
          />
        </TabsContent>

        <TabsContent value="workflow" className={`p-3 mt-0 space-y-3 ${expanded ? 'p-4 max-w-2xl mx-auto' : ''}`}>
          <div className="rounded-md border p-3 space-y-2">
            <p className="text-xs font-semibold">Editable Research Snapshot</p>
            <textarea
              className="w-full min-h-16 rounded-md border px-2 py-1 text-xs"
              placeholder="Research summary"
              value={researchSummary}
              onChange={(e) => setResearchSummary(e.target.value)}
            />
            <textarea
              className="w-full min-h-20 rounded-md border px-2 py-1 text-xs"
              placeholder="Facts (one per line)"
              value={researchFacts}
              onChange={(e) => setResearchFacts(e.target.value)}
            />
            <textarea
              className="w-full min-h-20 rounded-md border px-2 py-1 text-xs"
              placeholder="Statistics (format: stat | source)"
              value={researchStats}
              onChange={(e) => setResearchStats(e.target.value)}
            />
            <textarea
              className="w-full min-h-20 rounded-md border px-2 py-1 text-xs"
              placeholder="Sources (format: url | title)"
              value={researchSources}
              onChange={(e) => setResearchSources(e.target.value)}
            />
          </div>

          <div className="rounded-md border p-3 space-y-2">
            <p className="text-xs font-semibold">Editable Outline Snapshot</p>
            <textarea
              className="w-full min-h-40 rounded-md border px-2 py-1 text-xs font-mono"
              placeholder="Outline markdown"
              value={outlineMarkdown}
              onChange={(e) => setOutlineMarkdown(e.target.value)}
            />
          </div>

          <div className="rounded-md border p-3 space-y-2">
            <p className="text-xs font-semibold">Workflow Controls</p>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                className="text-xs"
                onClick={handleSaveWorkflowContext}
                disabled={workflowSaving || !onUpdateDocument}
              >
                {workflowSaving ? 'Saving...' : 'Save Research + Outline'}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                className="text-xs"
                onClick={() => handleRerunFrom('outline_build')}
                disabled={rerunBusy !== null}
              >
                {rerunBusy === 'outline_build'
                  ? 'Rerunning...'
                  : 'Regenerate from Outline'}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                className="text-xs"
                onClick={() => handleRerunFrom('research')}
                disabled={rerunBusy !== null}
              >
                {rerunBusy === 'research'
                  ? 'Rerunning...'
                  : 'Regenerate from Research'}
              </Button>
            </div>
            {workflowMessage && (
              <p className="text-xs text-muted-foreground">{workflowMessage}</p>
            )}
            <p className="text-[11px] text-muted-foreground">
              Reruns pause before writing so a human can approve prewrite context.
            </p>
          </div>

          <div className="rounded-md border p-3 space-y-2">
            <p className="text-xs font-semibold">Current Prewrite Checklist</p>
            {document.prewriteChecklist ? (
              <div className="text-xs text-muted-foreground space-y-0.5">
                <p>Brand context: {document.prewriteChecklist.brandContextReady ? 'ready' : 'pending'}</p>
                <p>Internal links: {document.prewriteChecklist.internalLinksReady ? 'ready' : 'pending'}</p>
                <p>Unresolved questions: {document.prewriteChecklist.unresolvedQuestions}</p>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">No prewrite checklist yet.</p>
            )}
          </div>

          <div className="rounded-md border p-3 space-y-2">
            <p className="text-xs font-semibold">Agent Questions</p>
            {document.agentQuestions && document.agentQuestions.length > 0 ? (
              <div className="space-y-1.5">
                {document.agentQuestions.slice(0, 8).map((q) => (
                  <div key={q.id} className="text-xs text-muted-foreground">
                    <p>{q.question}</p>
                    <p className="text-[11px]">Status: {q.status}</p>
                    {q.answer && <p className="text-[11px]">Answer: {q.answer}</p>}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">No agent questions yet.</p>
            )}
          </div>
        </TabsContent>

        <TabsContent value="ai" className={`p-3 mt-0 ${expanded ? 'p-4 max-w-2xl mx-auto' : ''}`}>
          <AiDetectionPanel
            result={aiResult}
            analyzing={analyzing}
            onOpenReport={onOpenReport}
          />
        </TabsContent>

        <TabsContent value="seo" className={`p-3 mt-0 ${expanded ? 'p-4 max-w-2xl mx-auto' : ''}`}>
          <SemanticPanel
            result={semanticResult}
            serpData={serpData}
            keyword={document.targetKeyword}
            analyzing={analyzing}
          />
        </TabsContent>

        <TabsContent value="quality" className={`p-3 mt-0 ${expanded ? 'p-4 max-w-2xl mx-auto' : ''}`}>
          <QualityPanel result={qualityResult} analyzing={analyzing} />
        </TabsContent>
      </div>
    </Tabs>
  );
}

export function AnalysisSidebar({
  document,
  aiResult,
  qualityResult,
  semanticResult,
  serpData,
  analyzing,
  plainText,
  onInsertAiText,
  onReplaceContent,
  isAiWriting,
  onLiveGenerate,
  onCancelGeneration,
  onUpdateDocument,
  activeProjectId,
  editor,
  commentsRefreshKey,
}: AnalysisSidebarProps) {
  const [reportOpen, setReportOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);

  if (!document) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm p-4">
        Select a document to see analysis
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Expand button */}
      <div className="flex items-center justify-end px-2 pt-2 shrink-0">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => setExpanded(true)}
          title="Expand sidebar"
        >
          <Maximize2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Inline sidebar content */}
      <SidebarContent
        document={document}
        aiResult={aiResult}
        qualityResult={qualityResult}
        semanticResult={semanticResult}
        serpData={serpData}
        analyzing={analyzing}
        plainText={plainText}
        onInsertAiText={onInsertAiText}
        onReplaceContent={onReplaceContent}
        onOpenReport={() => setReportOpen(true)}
        isAiWriting={isAiWriting}
        onLiveGenerate={onLiveGenerate}
        onCancelGeneration={onCancelGeneration}
        onUpdateDocument={onUpdateDocument}
        activeProjectId={activeProjectId}
        editor={editor}
        commentsRefreshKey={commentsRefreshKey}
      />

      {/* Expanded Dialog */}
      <Dialog open={expanded} onOpenChange={setExpanded}>
        <DialogContent className="max-w-4xl w-[90vw] h-[90vh] flex flex-col p-0 gap-0 overflow-hidden">
          <VisuallyHidden.Root>
            <DialogTitle>Analysis Panel</DialogTitle>
          </VisuallyHidden.Root>
          <div className="flex items-center justify-between px-5 pt-4 pb-2 shrink-0 border-b border-border">
            <span className="text-sm font-semibold">Analysis Panel</span>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => setExpanded(false)}
              title="Collapse"
            >
              <Minimize2 className="h-3.5 w-3.5" />
            </Button>
          </div>
          <div className="flex-1 min-h-0">
            <SidebarContent
              document={document}
              aiResult={aiResult}
              qualityResult={qualityResult}
              semanticResult={semanticResult}
              serpData={serpData}
              analyzing={analyzing}
              plainText={plainText}
              onInsertAiText={onInsertAiText}
              onReplaceContent={onReplaceContent}
              onOpenReport={() => setReportOpen(true)}
              expanded
              isAiWriting={isAiWriting}
              onLiveGenerate={onLiveGenerate}
              onCancelGeneration={onCancelGeneration}
              onUpdateDocument={onUpdateDocument}
              activeProjectId={activeProjectId}
              editor={editor}
              commentsRefreshKey={commentsRefreshKey}
            />
          </div>
        </DialogContent>
      </Dialog>

      {/* Full Report Dialog */}
      {aiResult && (
        <AiReportDialog
          result={aiResult}
          open={reportOpen}
          onOpenChange={setReportOpen}
        />
      )}
    </div>
  );
}
