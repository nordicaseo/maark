'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { marked } from 'marked';
import type { JSONContent } from '@tiptap/core';
import { DocumentList } from '@/components/documents/document-list';
import { TiptapEditor } from '@/components/editor/tiptap-editor';
import { AnalysisSidebar } from '@/components/sidebar/analysis-sidebar';
import { TopBar } from '@/components/layout/top-bar';
import type { Editor } from '@tiptap/react';
import type { Document } from '@/types/document';
import type { ContentItemCard } from '@/types/content-item';
import type { AiDetectionResult, ContentQualityResult, SemanticResult } from '@/types/analysis';
import type { SerpData } from '@/types/serp';
import { InlineCommentForm } from '@/components/editor/inline-comment-form';
import { cleanHtmlForExport } from '@/lib/utils/html-export';
import { useActiveProject } from '@/hooks/use-active-project';
import { useProjectScopeSync } from '@/hooks/use-project-scope-sync';

interface AppShellProps {
  documentId?: number;
}

export function AppShell({ documentId }: AppShellProps) {
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [document, setDocument] = useState<Document | null>(null);
  const [documents, setDocuments] = useState<ContentItemCard[]>([]);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [analyzing, setAnalyzing] = useState(false);
  const [aiResult, setAiResult] = useState<AiDetectionResult | null>(null);
  const [qualityResult, setQualityResult] = useState<ContentQualityResult | null>(null);
  const [semanticResult, setSemanticResult] = useState<SemanticResult | null>(null);
  const [serpData, setSerpData] = useState<SerpData | null>(null);
  const [plainText, setPlainText] = useState('');
  const [editorInstance, setEditorInstance] = useState<Editor | null>(null);
  const editorRef = useRef<Editor | null>(null);

  // Project state
  const { activeProjectId, setActiveProjectId } = useActiveProject();
  useProjectScopeSync(activeProjectId, setActiveProjectId);

  // Copy as HTML feedback state
  const [htmlCopied, setHtmlCopied] = useState(false);

  // Live AI writing state
  const [isAiWriting, setIsAiWriting] = useState(false);
  const aiAbortRef = useRef<AbortController | null>(null);

  // Inline comment state
  const [pendingComment, setPendingComment] = useState<{
    quotedText: string;
    selectionFrom: number;
    selectionTo: number;
  } | null>(null);
  const [commentsRefreshKey, setCommentsRefreshKey] = useState(0);

  const handleProjectChange = useCallback((projectId: number | null) => {
    setActiveProjectId(projectId);
  }, [setActiveProjectId]);

  const handleInsertAiText = useCallback((text: string) => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.chain().focus().insertContent(text).run();
  }, []);

  const fetchDocuments = useCallback(async () => {
    try {
      const url = activeProjectId
        ? `/api/content-items?projectId=${activeProjectId}`
        : '/api/content-items';
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        setDocuments(data);
      }
    } catch {}
  }, [activeProjectId]);

  const handleReplaceContent = useCallback((text: string) => {
    const editor = editorRef.current;
    if (!editor) return;
    const html = marked.parse(text, { async: false }) as string;
    editor.chain().focus().clearContent().insertContent(html).run();
    const content = editor.getJSON();
    const newText = editor.getText();
    const words = newText.split(/\s+/).filter(Boolean).length;
    if (document) {
      setPlainText(newText);
      setSaveStatus('saving');
      fetch(`/api/documents/${document.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, plainText: newText, wordCount: words }),
      }).then(async (res) => {
        if (res.ok) {
          const updated = await res.json();
          setDocument(updated);
          setSaveStatus('saved');
          fetchDocuments();
        }
      }).catch(() => setSaveStatus('idle'));
    }
  }, [document, fetchDocuments]);

  // Live AI generation: streams tokens directly into the editor
  const handleLiveGenerate = useCallback(
    async (instruction: string, tone: string) => {
      const editor = editorRef.current;
      if (!editor || !document) return;

      setIsAiWriting(true);
      const controller = new AbortController();
      aiAbortRef.current = controller;

      // Record insert position
      const docSizeBefore = editor.state.doc.content.size;
      let accumulated = '';

      try {
        const res = await fetch('/api/ai/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            instruction,
            contentType: document.contentType,
            targetKeyword: document.targetKeyword,
            existingContent: plainText.slice(0, 2000),
            tone,
            documentId: document.id,
            projectId: document.projectId,
          }),
          signal: controller.signal,
        });

        if (!res.ok) {
          setIsAiWriting(false);
          return;
        }

        const reader = res.body?.getReader();
        if (!reader) {
          setIsAiWriting(false);
          return;
        }

        const decoder = new TextDecoder();
        accumulated = '';
        let lastUpdate = 0;
        const THROTTLE_MS = 300;

        // Insert position: end of current content
        const insertFrom = docSizeBefore - 1; // before closing doc node

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          accumulated += decoder.decode(value, { stream: true });

          const now = Date.now();
          if (now - lastUpdate >= THROTTLE_MS) {
            lastUpdate = now;
            // Parse markdown to HTML and replace the AI-written range
            const html = marked.parse(accumulated, { async: false }) as string;
            const currentSize = editor.state.doc.content.size;

            // Delete previously inserted AI content and re-insert
            if (currentSize > docSizeBefore) {
              editor
                .chain()
                .deleteRange({ from: insertFrom, to: currentSize - 1 })
                .insertContentAt(insertFrom, html)
                .run();
            } else {
              editor.chain().insertContentAt(insertFrom, html).run();
            }
          }
        }

        // Final update with complete content
        const finalHtml = marked.parse(accumulated, { async: false }) as string;
        const currentSize = editor.state.doc.content.size;
        if (currentSize > docSizeBefore) {
          editor
            .chain()
            .deleteRange({ from: insertFrom, to: currentSize - 1 })
            .insertContentAt(insertFrom, finalHtml)
            .run();
        } else {
          editor.chain().insertContentAt(insertFrom, finalHtml).run();
        }

        // Save after generation completes
        const content = editor.getJSON();
        const newText = editor.getText();
        const words = newText.split(/\s+/).filter(Boolean).length;
        setPlainText(newText);
        setSaveStatus('saving');
        const saveRes = await fetch(`/api/documents/${document.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content, plainText: newText, wordCount: words }),
        });
        if (saveRes.ok) {
          const updated = await saveRes.json();
          setDocument(updated);
          setSaveStatus('saved');
          fetchDocuments();
        }
      } catch (err: unknown) {
        if ((err as { name?: string })?.name === 'AbortError') {
          // User cancelled — keep what's in the editor, do a final parse + save
          const finalHtml = marked.parse(accumulated || '', { async: false }) as string;
          if (finalHtml && editor) {
            const content = editor.getJSON();
            const newText = editor.getText();
            const words = newText.split(/\s+/).filter(Boolean).length;
            setPlainText(newText);
            setSaveStatus('saving');
            fetch(`/api/documents/${document.id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ content, plainText: newText, wordCount: words }),
            }).then(async (res) => {
              if (res.ok) {
                const updated = await res.json();
                setDocument(updated);
                setSaveStatus('saved');
              }
            }).catch(() => setSaveStatus('idle'));
          }
        }
      }

      setIsAiWriting(false);
    },
    [document, plainText, fetchDocuments]
  );

  const handleCancelGeneration = useCallback(() => {
    aiAbortRef.current?.abort();
    setIsAiWriting(false);
  }, []);

  const handleExport = useCallback((format: 'html' | 'markdown' | 'text') => {
    const editor = editorRef.current;
    if (!editor || !document) return;

    let content: string;
    let filename: string;
    let mimeType: string;

    switch (format) {
      case 'html': {
        const editorHtml = editor.getHTML();
        content = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${document.title}</title>
<style>
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 800px; margin: 2rem auto; padding: 0 1rem; line-height: 1.7; color: #1a1a1a; }
h1 { font-size: 2rem; margin-top: 2rem; }
h2 { font-size: 1.5rem; margin-top: 1.75rem; }
h3 { font-size: 1.25rem; margin-top: 1.5rem; }
table { border-collapse: collapse; width: 100%; margin: 1rem 0; }
th, td { border: 1px solid #ddd; padding: 0.5rem 0.75rem; text-align: left; }
th { background: #f5f5f5; font-weight: 600; }
blockquote { border-left: 3px solid #ccc; padding-left: 1rem; color: #666; font-style: italic; }
code { background: #f0f0f0; padding: 0.15rem 0.4rem; border-radius: 0.25rem; font-size: 0.9em; }
pre { background: #f5f5f5; padding: 1rem; border-radius: 0.5rem; overflow-x: auto; }
</style>
</head>
<body>
<h1>${document.title}</h1>
${editorHtml}
</body>
</html>`;
        filename = `${document.title.replace(/[^a-z0-9]/gi, '-').toLowerCase()}.html`;
        mimeType = 'text/html';
        break;
      }
      case 'markdown': {
        content = plainText;
        filename = `${document.title.replace(/[^a-z0-9]/gi, '-').toLowerCase()}.md`;
        mimeType = 'text/markdown';
        break;
      }
      case 'text': {
        content = editor.getText();
        filename = `${document.title.replace(/[^a-z0-9]/gi, '-').toLowerCase()}.txt`;
        mimeType = 'text/plain';
        break;
      }
    }

    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = window.document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }, [document, plainText]);

  const handleCopyHtml = useCallback(async () => {
    const editor = editorRef.current;
    if (!editor) return;
    const rawHtml = editor.getHTML();
    const cleaned = cleanHtmlForExport(rawHtml);
    try {
      await navigator.clipboard.writeText(cleaned);
      setHtmlCopied(true);
      setTimeout(() => setHtmlCopied(false), 2000);
    } catch {
      // Fallback: ignore clipboard errors silently
    }
  }, []);

  const fetchDocument = useCallback(async (id: number) => {
    try {
      const res = await fetch(`/api/documents/${id}`);
      if (res.ok) {
        const data = await res.json();
        setDocument(data);
        if (data.plainText) setPlainText(data.plainText);
      }
    } catch {}
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void fetchDocuments();
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [fetchDocuments]);

  useEffect(() => {
    if (!documentId) return;
    const timeout = window.setTimeout(() => {
      void fetchDocument(documentId);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [documentId, fetchDocument]);

  const handleSave = useCallback(
    async (content: JSONContent, text: string, wordCount: number) => {
      if (!document || isAiWriting) return; // Don't auto-save during AI writing
      setSaveStatus('saving');
      setPlainText(text);
      try {
        const res = await fetch(`/api/documents/${document.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content, plainText: text, wordCount }),
        });
        if (res.ok) {
          const updated = await res.json();
          setDocument(updated);
          setSaveStatus('saved');
          fetchDocuments();
        }
      } catch {
        setSaveStatus('idle');
      }
    },
    [document, fetchDocuments, isAiWriting]
  );

  const handleAnalyze = useCallback(async () => {
    if (!document || !plainText) return;
    setAnalyzing(true);

    const promises = [
      fetch('/api/analyze/ai-detection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentId: document.id, text: plainText }),
      }).then((r) => r.ok ? r.json() : null),

      fetch('/api/analyze/content-quality', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          documentId: document.id,
          text: plainText,
          contentType: document.contentType,
        }),
      }).then((r) => r.ok ? r.json() : null),
    ];

    if (document.targetKeyword) {
      promises.push(
        fetch('/api/analyze/semantic', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            documentId: document.id,
            text: plainText,
            keyword: document.targetKeyword,
          }),
        }).then((r) => r.ok ? r.json() : null)
      );
    }

    try {
      const results = await Promise.allSettled(promises);
      const aiRes = results[0].status === 'fulfilled' ? results[0].value : null;
      const qualRes = results[1].status === 'fulfilled' ? results[1].value : null;
      const semRes = results[2]?.status === 'fulfilled' ? results[2]?.value : null;

      if (aiRes) setAiResult(aiRes);
      if (qualRes) setQualityResult(qualRes);
      if (semRes) {
        setSemanticResult(semRes.semantic);
        setSerpData(semRes.serpData);
      }
      fetchDocument(document.id);
    } catch {}
    setAnalyzing(false);
  }, [document, plainText, fetchDocument]);

  const handleUpdateDocument = useCallback(
    async (updates: Partial<Document>) => {
      if (!document) return;
      try {
        const res = await fetch(`/api/documents/${document.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updates),
        });
        if (res.ok) {
          const updated = await res.json();
          setDocument(updated);
          fetchDocuments();
        }
      } catch {}
    },
    [document, fetchDocuments]
  );

  return (
    <div className="flex h-full overflow-hidden bg-[linear-gradient(180deg,#f7f4ee_0%,#f2ece2_100%)]">
      {/* Left Sidebar */}
      <div
        className={`border-r border-border bg-card/95 backdrop-blur-sm transition-all duration-200 flex flex-col shrink-0 ${
          leftOpen ? 'w-[22rem] lg:w-[24rem] 2xl:w-[26rem]' : 'w-0'
        } overflow-hidden`}
      >
        <DocumentList
          documents={documents}
          activeId={documentId}
          onRefresh={fetchDocuments}
          activeProjectId={activeProjectId}
          onProjectChange={handleProjectChange}
        />
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        <TopBar
          document={document}
          saveStatus={saveStatus}
          analyzing={analyzing}
          onAnalyze={handleAnalyze}
          onUpdate={handleUpdateDocument}
          onExport={handleExport}
          onCopyHtml={handleCopyHtml}
          htmlCopied={htmlCopied}
          leftOpen={leftOpen}
          rightOpen={rightOpen}
          onToggleLeft={() => setLeftOpen(!leftOpen)}
          onToggleRight={() => setRightOpen(!rightOpen)}
          isAiWriting={isAiWriting}
        />
        <div className="flex-1 overflow-auto">
          {document ? (
            <div className="max-w-3xl mx-auto px-8 py-4">
              <TiptapEditor
                document={document}
                onSave={handleSave}
                onEditorReady={(editor) => {
                  editorRef.current = editor;
                  setEditorInstance(editor);
                }}
                isAiWriting={isAiWriting}
                onAddComment={setPendingComment}
              />
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              <div className="text-center">
                <p className="text-lg font-medium mb-2">No document selected</p>
                <p className="text-sm">Create a new document or select one from the sidebar</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Inline Comment Form */}
      {pendingComment && document && editorInstance && (
        <InlineCommentForm
          documentId={document.id}
          quotedText={pendingComment.quotedText}
          selectionFrom={pendingComment.selectionFrom}
          selectionTo={pendingComment.selectionTo}
          editor={editorInstance}
          onClose={() => setPendingComment(null)}
          onCommentCreated={() => {
            setPendingComment(null);
            setCommentsRefreshKey((k) => k + 1);
          }}
        />
      )}

      {/* Right Sidebar */}
      <div
        className={`border-l border-border bg-card/95 backdrop-blur-sm transition-all duration-200 shrink-0 ${
          rightOpen ? 'w-[360px]' : 'w-0'
        } overflow-hidden`}
      >
        <AnalysisSidebar
          document={document}
          aiResult={aiResult}
          qualityResult={qualityResult}
          semanticResult={semanticResult}
          serpData={serpData}
          analyzing={analyzing}
          plainText={plainText}
          onInsertAiText={handleInsertAiText}
          onReplaceContent={handleReplaceContent}
          isAiWriting={isAiWriting}
          onLiveGenerate={handleLiveGenerate}
          onCancelGeneration={handleCancelGeneration}
          onUpdateDocument={handleUpdateDocument}
          activeProjectId={activeProjectId}
          editor={editorInstance}
          commentsRefreshKey={commentsRefreshKey}
        />
      </div>
    </div>
  );
}
