'use client';

import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
} from '@/components/ui/dialog';
import { AiDetectionPanel } from './ai-detection-panel';
import { AiReportDialog } from './ai-report-dialog';
import { SemanticPanel } from './semantic-panel';
import { QualityPanel } from './quality-panel';
import { AiWritingPanel } from '@/components/ai/ai-writing-panel';
import { AiRewriterPanel } from '@/components/ai/ai-rewriter-panel';
import { Maximize2, Minimize2 } from 'lucide-react';
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
}: SidebarContentProps) {
  return (
    <Tabs defaultValue="write" className="flex flex-col h-full">
      <TabsList className={`mx-3 mt-3 grid grid-cols-5 shrink-0 ${expanded ? 'mx-4 mt-4' : ''}`}>
        <TabsTrigger value="write" className="text-xs">Write</TabsTrigger>
        <TabsTrigger value="ai" className="text-xs">AI Score</TabsTrigger>
        <TabsTrigger value="rewrite" className="text-xs">Rewrite</TabsTrigger>
        <TabsTrigger value="seo" className="text-xs">SEO</TabsTrigger>
        <TabsTrigger value="quality" className="text-xs">Quality</TabsTrigger>
      </TabsList>

      <div className="flex-1 overflow-y-auto min-h-0">
        <TabsContent value="write" className={`p-3 mt-0 ${expanded ? 'p-4 max-w-2xl mx-auto' : ''}`}>
          <AiWritingPanel
            contentType={document.contentType}
            targetKeyword={document.targetKeyword}
            existingContent={plainText}
            onInsert={onInsertAiText}
          />
        </TabsContent>

        <TabsContent value="ai" className={`p-3 mt-0 ${expanded ? 'p-4 max-w-2xl mx-auto' : ''}`}>
          <AiDetectionPanel
            result={aiResult}
            analyzing={analyzing}
            onOpenReport={onOpenReport}
          />
        </TabsContent>

        <TabsContent value="rewrite" className={`p-3 mt-0 ${expanded ? 'p-4 max-w-2xl mx-auto' : ''}`}>
          {aiResult ? (
            <AiRewriterPanel
              aiResult={aiResult}
              plainText={plainText}
              contentType={document.contentType}
              targetKeyword={document.targetKeyword}
              onReplace={onReplaceContent}
            />
          ) : (
            <div className="text-center py-12 text-muted-foreground">
              <p className="text-sm">Run AI detection first</p>
              <p className="text-xs mt-1">
                The rewriter uses signal analysis to fix AI patterns
              </p>
            </div>
          )}
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
      />

      {/* Expanded Dialog */}
      <Dialog open={expanded} onOpenChange={setExpanded}>
        <DialogContent className="max-w-4xl w-[90vw] h-[90vh] flex flex-col p-0 gap-0 overflow-hidden">
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
