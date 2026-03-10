'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import type { Editor } from '@tiptap/react';
import type { JSONContent } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import CharacterCount from '@tiptap/extension-character-count';
import UnderlineExt from '@tiptap/extension-underline';
import Highlight from '@tiptap/extension-highlight';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import LinkExt from '@tiptap/extension-link';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import ImageExt from '@tiptap/extension-image';
import {
  MessageSquare,
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Strikethrough,
  Code,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Quote,
  Link2,
  ImageIcon,
} from 'lucide-react';
import { CommentMark } from '@/lib/tiptap/comment-mark';
import { ImageGeneratorDialog } from './image-generator-dialog';
import type { Document } from '@/types/document';

const DRAFT_PHASE_LABELS: Record<string, string> = {
  initial_draft: 'Writing initial draft…',
  continuation_1: 'Expanding content (pass 1)…',
  continuation_2: 'Expanding content (pass 2)…',
  continuation_3: 'Expanding content (pass 3)…',
  compression: 'Optimizing word count…',
  style_fix: 'Applying style corrections…',
  complete: 'Writing complete',
};

/* ── BubbleMenu button ─────────────────────────────── */

function BubbleButton({
  onClick,
  active,
  title,
  children,
}: {
  onClick: () => void;
  active?: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`p-1.5 rounded text-zinc-300 hover:text-white hover:bg-zinc-700 transition-colors ${
        active ? 'bg-zinc-700 text-white' : ''
      }`}
      title={title}
    >
      {children}
    </button>
  );
}

function BubbleSep() {
  return <div className="w-px h-5 bg-zinc-700 mx-0.5" />;
}

/* ── Editor ────────────────────────────────────────── */

interface TiptapEditorProps {
  document: Document;
  onSave: (content: JSONContent, plainText: string, wordCount: number) => void;
  onEditorReady?: (editor: Editor) => void;
  isAiWriting?: boolean;
  onAddComment?: (data: { quotedText: string; selectionFrom: number; selectionTo: number }) => void;
}

export function TiptapEditor({ document, onSave, onEditorReady, isAiWriting, onAddComment }: TiptapEditorProps) {
  const saveTimer = useRef<NodeJS.Timeout | null>(null);
  const docIdRef = useRef(document.id);
  const [imageDialogOpen, setImageDialogOpen] = useState(false);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3, 4] },
      }),
      Placeholder.configure({
        placeholder: 'Start writing…',
      }),
      CharacterCount,
      UnderlineExt,
      Highlight.configure({ multicolor: true }),
      TaskList,
      TaskItem.configure({ nested: true }),
      LinkExt.configure({ openOnClick: false }),
      Table.configure({
        resizable: true,
        HTMLAttributes: { class: 'tiptap-table' },
      }),
      TableRow,
      TableCell,
      TableHeader,
      ImageExt.configure({
        inline: false,
        allowBase64: false,
        HTMLAttributes: { class: 'tiptap-image' },
      }),
      CommentMark.configure({
        HTMLAttributes: { class: 'editor-comment-highlight' },
      }),
    ],
    content: document.content || {
      type: 'doc',
      content: [{ type: 'paragraph' }],
    },
    editorProps: {
      attributes: {
        class: 'tiptap prose prose-invert max-w-none focus:outline-none',
      },
      handlePaste(view, event) {
        const html = event.clipboardData?.getData('text/html');
        if (html) {
          return false;
        }
        return false;
      },
    },
    onUpdate: ({ editor }) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        const content = editor.getJSON();
        const text = editor.getText();
        const words = text.split(/\s+/).filter(Boolean).length;
        onSave(content, text, words);
      }, 2000);
    },
  });

  // Disable editing during AI writing
  useEffect(() => {
    if (editor) {
      editor.setEditable(!isAiWriting);
    }
  }, [editor, isAiWriting]);

  // ── Live draft polling ────────────────────────────────────────────
  const [draftPhase, setDraftPhase] = useState<string | null>(null);
  const lastDraftPhaseRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isAiWriting || !editor || !document.id) return;

    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch(`/api/documents/${document.id}/draft`);
        if (!res.ok || cancelled) return;
        const data = await res.json() as {
          draftContent?: string | null;
          draftPhase?: string | null;
          content?: unknown;
          status?: string;
        };

        if (cancelled) return;

        if (data.draftPhase && data.draftPhase !== lastDraftPhaseRef.current) {
          lastDraftPhaseRef.current = data.draftPhase;
          setDraftPhase(data.draftPhase);

          if (data.draftPhase === 'complete' && data.content) {
            editor.commands.setContent(data.content as JSONContent);
            return;
          }

          if (data.draftContent) {
            editor.commands.setContent(data.draftContent);
          }
        }
      } catch {
        // Polling errors are non-fatal
      }
    };

    const interval = setInterval(poll, 3000);
    poll();

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [isAiWriting, editor, document.id]);

  useEffect(() => {
    if (!isAiWriting) {
      lastDraftPhaseRef.current = null;
    }
  }, [isAiWriting]);

  // Notify parent of editor instance
  useEffect(() => {
    if (editor && onEditorReady) {
      onEditorReady(editor);
    }
  }, [editor, onEditorReady]);

  // Update content when document changes
  useEffect(() => {
    if (editor && document.id !== docIdRef.current) {
      docIdRef.current = document.id;
      editor.commands.setContent(
        document.content || { type: 'doc', content: [{ type: 'paragraph' }] }
      );
    }
  }, [editor, document.id, document.content]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  const handleInsertImage = useCallback((url: string, alt: string) => {
    if (!editor) return;
    editor.chain().focus().setImage({ src: url, alt }).run();
    const content = editor.getJSON();
    const text = editor.getText();
    const words = text.split(/\s+/).filter(Boolean).length;
    onSave(content, text, words);
  }, [editor, onSave]);

  const handleSetLink = useCallback(() => {
    if (!editor) return;
    const previousUrl = editor.getAttributes('link').href;
    const url = window.prompt('URL', previousUrl);
    if (url === null) return;
    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
  }, [editor]);

  const handleAddComment = useCallback(() => {
    if (!editor || !onAddComment) return;
    const { from, to } = editor.state.selection;
    const quotedText = editor.state.doc.textBetween(from, to, ' ');
    if (quotedText.trim()) {
      onAddComment({ quotedText, selectionFrom: from, selectionTo: to });
    }
  }, [editor, onAddComment]);

  if (!editor) return null;

  return (
    <div className={isAiWriting ? 'border-l-2 border-primary/50 pl-2' : ''}>
      {isAiWriting && draftPhase && (
        <div className="flex items-center gap-2 px-3 py-1.5 mb-2 rounded-md text-xs font-medium bg-primary/10 text-primary border border-primary/20">
          <span className="inline-block h-2 w-2 rounded-full bg-primary animate-pulse" />
          {DRAFT_PHASE_LABELS[draftPhase] || `Writing (${draftPhase})…`}
        </div>
      )}

      {/* Dark floating toolbar on text selection */}
      {editor && (
        <BubbleMenu
          editor={editor}
          className="bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl flex items-center gap-0.5 p-1"
        >
          {/* Text formatting */}
          <BubbleButton onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive('bold')} title="Bold">
            <Bold className="h-3.5 w-3.5" />
          </BubbleButton>
          <BubbleButton onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive('italic')} title="Italic">
            <Italic className="h-3.5 w-3.5" />
          </BubbleButton>
          <BubbleButton onClick={() => editor.chain().focus().toggleUnderline().run()} active={editor.isActive('underline')} title="Underline">
            <UnderlineIcon className="h-3.5 w-3.5" />
          </BubbleButton>
          <BubbleButton onClick={() => editor.chain().focus().toggleStrike().run()} active={editor.isActive('strike')} title="Strikethrough">
            <Strikethrough className="h-3.5 w-3.5" />
          </BubbleButton>
          <BubbleButton onClick={() => editor.chain().focus().toggleCode().run()} active={editor.isActive('code')} title="Code">
            <Code className="h-3.5 w-3.5" />
          </BubbleButton>

          <BubbleSep />

          {/* Headings */}
          <BubbleButton onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} active={editor.isActive('heading', { level: 1 })} title="Heading 1">
            <Heading1 className="h-3.5 w-3.5" />
          </BubbleButton>
          <BubbleButton onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} active={editor.isActive('heading', { level: 2 })} title="Heading 2">
            <Heading2 className="h-3.5 w-3.5" />
          </BubbleButton>
          <BubbleButton onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} active={editor.isActive('heading', { level: 3 })} title="Heading 3">
            <Heading3 className="h-3.5 w-3.5" />
          </BubbleButton>

          <BubbleSep />

          {/* Block formatting */}
          <BubbleButton onClick={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive('bulletList')} title="Bullet List">
            <List className="h-3.5 w-3.5" />
          </BubbleButton>
          <BubbleButton onClick={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive('orderedList')} title="Numbered List">
            <ListOrdered className="h-3.5 w-3.5" />
          </BubbleButton>
          <BubbleButton onClick={() => editor.chain().focus().toggleBlockquote().run()} active={editor.isActive('blockquote')} title="Quote">
            <Quote className="h-3.5 w-3.5" />
          </BubbleButton>

          <BubbleSep />

          {/* Link */}
          <BubbleButton onClick={handleSetLink} active={editor.isActive('link')} title="Link">
            <Link2 className="h-3.5 w-3.5" />
          </BubbleButton>
          {/* Image */}
          <BubbleButton onClick={() => setImageDialogOpen(true)} title="Image">
            <ImageIcon className="h-3.5 w-3.5" />
          </BubbleButton>

          {/* Comment */}
          {onAddComment && (
            <>
              <BubbleSep />
              <BubbleButton onClick={handleAddComment} title="Comment">
                <MessageSquare className="h-3.5 w-3.5" />
              </BubbleButton>
            </>
          )}
        </BubbleMenu>
      )}

      <EditorContent editor={editor} />

      <ImageGeneratorDialog
        open={imageDialogOpen}
        onOpenChange={setImageDialogOpen}
        onInsertImage={handleInsertImage}
        contextKeyword={document.targetKeyword || undefined}
        documentId={document.id}
        projectId={document.projectId}
      />
    </div>
  );
}
