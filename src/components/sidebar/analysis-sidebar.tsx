'use client';

import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { AiDetectionPanel } from './ai-detection-panel';
import { AiReportDialog } from './ai-report-dialog';
import { SemanticPanel } from './semantic-panel';
import { QualityPanel } from './quality-panel';
import { AiWritingPanel } from '@/components/ai/ai-writing-panel';
import { AiRewriterPanel } from '@/components/ai/ai-rewriter-panel';
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

  if (!document) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm p-4">
        Select a document to see analysis
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <Tabs defaultValue="write" className="flex flex-col h-full">
        <TabsList className="mx-3 mt-3 grid grid-cols-5">
          <TabsTrigger value="write" className="text-xs">Write</TabsTrigger>
          <TabsTrigger value="ai" className="text-xs">AI Score</TabsTrigger>
          <TabsTrigger value="rewrite" className="text-xs">Rewrite</TabsTrigger>
          <TabsTrigger value="seo" className="text-xs">SEO</TabsTrigger>
          <TabsTrigger value="quality" className="text-xs">Quality</TabsTrigger>
        </TabsList>

        <ScrollArea className="flex-1">
          <TabsContent value="write" className="p-3 mt-0">
            <AiWritingPanel
              contentType={document.contentType}
              targetKeyword={document.targetKeyword}
              existingContent={plainText}
              onInsert={onInsertAiText}
            />
          </TabsContent>

          <TabsContent value="ai" className="p-3 mt-0">
            <AiDetectionPanel
              result={aiResult}
              analyzing={analyzing}
              onOpenReport={() => setReportOpen(true)}
            />
          </TabsContent>

          <TabsContent value="rewrite" className="p-3 mt-0">
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

          <TabsContent value="seo" className="p-3 mt-0">
            <SemanticPanel
              result={semanticResult}
              serpData={serpData}
              keyword={document.targetKeyword}
              analyzing={analyzing}
            />
          </TabsContent>

          <TabsContent value="quality" className="p-3 mt-0">
            <QualityPanel result={qualityResult} analyzing={analyzing} />
          </TabsContent>
        </ScrollArea>
      </Tabs>

      {/* Full Report Dialog (rendered outside scroll area) */}
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
