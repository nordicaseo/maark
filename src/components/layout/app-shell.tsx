'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { marked } from 'marked';
import { DocumentList } from '@/components/documents/document-list';
import { TiptapEditor } from '@/components/editor/tiptap-editor';
import { AnalysisSidebar } from '@/components/sidebar/analysis-sidebar';
import { TopBar } from '@/components/layout/top-bar';
import { Button } from '@/components/ui/button';
import { PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from 'lucide-react';
import type { Editor } from '@tiptap/react';
import type { Document } from '@/types/document';
import type { AiDetectionResult, ContentQualityResult, SemanticResult } from '@/types/analysis';
import type { SerpData } from '@/types/serp';

interface AppShellProps {
  documentId?: number;
}

export function AppShell({ documentId }: AppShellProps) {
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [document, setDocument] = useState<Document | null>(null);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [analyzing, setAnalyzing] = useState(false);
  const [aiResult, setAiResult] = useState<AiDetectionResult | null>(null);
  const [qualityResult, setQualityResult] = useState<ContentQualityResult | null>(null);
  const [semanticResult, setSemanticResult] = useState<SemanticResult | null>(null);
  const [serpData, setSerpData] = useState<SerpData | null>(null);
  const [plainText, setPlainText] = useState('');
  const editorRef = useRef<Editor | null>(null);

  const handleInsertAiText = useCallback((text: string) => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.chain().focus().insertContent(text).run();
  }, []);

  const fetchDocuments = useCallback(async () => {
    try {
      const res = await fetch('/api/documents');
      if (res.ok) {
        const data = await res.json();
        setDocuments(data);
      }
    } catch {}
  }, []);

  const handleReplaceContent = useCallback((text: string) => {
    const editor = editorRef.current;
    if (!editor) return;
    // Convert markdown to HTML so TipTap renders headings, lists, tables etc.
    const html = marked.parse(text, { async: false }) as string;
    editor.chain().focus().clearContent().insertContent(html).run();
    // Trigger a save after replace
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

  const fetchDocument = useCallback(async (id: number) => {
    try {
      const res = await fetch(`/api/documents/${id}`);
      if (res.ok) {
        const data = await res.json();
        setDocument(data);
        // Initialise plainText so Analyze works without editing first
        if (data.plainText) setPlainText(data.plainText);
      }
    } catch {}
  }, []);

  useEffect(() => {
    fetchDocuments();
  }, [fetchDocuments]);

  useEffect(() => {
    if (documentId) {
      fetchDocument(documentId);
    }
  }, [documentId, fetchDocument]);

  const handleSave = useCallback(
    async (content: any, text: string, wordCount: number) => {
      if (!document) return;
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
    [document, fetchDocuments]
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
    <div className="flex h-screen bg-background overflow-hidden">
      {/* Left Sidebar */}
      <div
        className={`border-r border-border bg-card transition-all duration-200 flex flex-col ${
          leftOpen ? 'w-72' : 'w-0'
        } overflow-hidden`}
      >
        <DocumentList
          documents={documents}
          activeId={documentId}
          onRefresh={fetchDocuments}
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
          leftOpen={leftOpen}
          rightOpen={rightOpen}
          onToggleLeft={() => setLeftOpen(!leftOpen)}
          onToggleRight={() => setRightOpen(!rightOpen)}
        />
        <div className="flex-1 overflow-auto">
          {document ? (
            <div className="max-w-3xl mx-auto px-8 py-4">
              <TiptapEditor
                document={document}
                onSave={handleSave}
                onEditorReady={(editor) => { editorRef.current = editor; }}
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

      {/* Right Sidebar */}
      <div
        className={`border-l border-border bg-card transition-all duration-200 ${
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
        />
      </div>
    </div>
  );
}
