'use client';

import { useState } from 'react';
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
  activeProjectId,
  editor,
  commentsRefreshKey,
}: SidebarContentProps) {
  void onInsertAiText;
  void onReplaceContent;

  return (
    <Tabs defaultValue="write" className="flex flex-col h-full">
      <TabsList className={`mx-3 mt-3 grid grid-cols-6 shrink-0 ${expanded ? 'mx-4 mt-4' : ''}`}>
        <TabsTrigger value="write" className="text-xs">Write</TabsTrigger>
        <TabsTrigger value="comments" className="text-xs">Comments</TabsTrigger>
        <TabsTrigger value="workflow" className="text-xs">Workflow</TabsTrigger>
        <TabsTrigger value="ai" className="text-xs">AI</TabsTrigger>
        <TabsTrigger value="seo" className="text-xs">SEO</TabsTrigger>
        <TabsTrigger value="quality" className="text-xs">Quality</TabsTrigger>
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
            <p className="text-xs font-semibold">Research Snapshot</p>
            {document.researchSnapshot?.summary ? (
              <>
                <p className="text-xs text-muted-foreground">{document.researchSnapshot.summary}</p>
                {document.researchSnapshot.facts && document.researchSnapshot.facts.length > 0 && (
                  <ul className="text-xs text-muted-foreground list-disc pl-4 space-y-0.5">
                    {document.researchSnapshot.facts.slice(0, 5).map((fact, idx) => (
                      <li key={`${fact}-${idx}`}>{fact}</li>
                    ))}
                  </ul>
                )}
              </>
            ) : (
              <p className="text-xs text-muted-foreground">No research snapshot yet.</p>
            )}
          </div>

          <div className="rounded-md border p-3 space-y-2">
            <p className="text-xs font-semibold">Prewrite Checklist</p>
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
