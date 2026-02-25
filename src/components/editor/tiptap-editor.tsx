'use client';

import { useEffect, useRef } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import type { Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import CharacterCount from '@tiptap/extension-character-count';
import Underline from '@tiptap/extension-underline';
import Highlight from '@tiptap/extension-highlight';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Link from '@tiptap/extension-link';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import { EditorToolbar } from './editor-toolbar';
import type { Document } from '@/types/document';

interface TiptapEditorProps {
  document: Document;
  onSave: (content: any, plainText: string, wordCount: number) => void;
  onEditorReady?: (editor: Editor) => void;
}

export function TiptapEditor({ document, onSave, onEditorReady }: TiptapEditorProps) {
  const saveTimer = useRef<NodeJS.Timeout | null>(null);
  const docIdRef = useRef(document.id);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3, 4] },
      }),
      Placeholder.configure({
        placeholder: 'Start writing or press / for commands...',
      }),
      CharacterCount,
      Underline,
      Highlight.configure({ multicolor: true }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Link.configure({ openOnClick: false }),
      Table.configure({
        resizable: true,
        HTMLAttributes: { class: 'tiptap-table' },
      }),
      TableRow,
      TableCell,
      TableHeader,
    ],
    content: document.content || {
      type: 'doc',
      content: [{ type: 'paragraph' }],
    },
    editorProps: {
      attributes: {
        class: 'tiptap prose prose-invert max-w-none focus:outline-none',
      },
      // Improve paste handling for HTML content (tables, formatting)
      handlePaste(view, event) {
        const html = event.clipboardData?.getData('text/html');
        if (html) {
          // Let TipTap handle HTML paste natively with table support
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

  if (!editor) return null;

  return (
    <div>
      <EditorToolbar editor={editor} />

      {editor && (
        <BubbleMenu
          editor={editor}
          className="bg-popover border border-border rounded-lg shadow-lg flex items-center overflow-hidden"
        >
          <button
            onClick={() => editor.chain().focus().toggleBold().run()}
            className={`px-3 py-1.5 text-xs font-medium hover:bg-accent ${
              editor.isActive('bold') ? 'bg-accent text-accent-foreground' : ''
            }`}
          >
            B
          </button>
          <button
            onClick={() => editor.chain().focus().toggleItalic().run()}
            className={`px-3 py-1.5 text-xs italic hover:bg-accent ${
              editor.isActive('italic') ? 'bg-accent text-accent-foreground' : ''
            }`}
          >
            I
          </button>
          <button
            onClick={() => editor.chain().focus().toggleUnderline().run()}
            className={`px-3 py-1.5 text-xs underline hover:bg-accent ${
              editor.isActive('underline') ? 'bg-accent text-accent-foreground' : ''
            }`}
          >
            U
          </button>
          <button
            onClick={() => editor.chain().focus().toggleStrike().run()}
            className={`px-3 py-1.5 text-xs line-through hover:bg-accent ${
              editor.isActive('strike') ? 'bg-accent text-accent-foreground' : ''
            }`}
          >
            S
          </button>
          <button
            onClick={() => editor.chain().focus().toggleHighlight().run()}
            className={`px-3 py-1.5 text-xs hover:bg-accent ${
              editor.isActive('highlight') ? 'bg-accent text-accent-foreground' : ''
            }`}
          >
            H
          </button>
          <button
            onClick={() => editor.chain().focus().toggleCode().run()}
            className={`px-3 py-1.5 text-xs font-mono hover:bg-accent ${
              editor.isActive('code') ? 'bg-accent text-accent-foreground' : ''
            }`}
          >
            {'<>'}
          </button>
        </BubbleMenu>
      )}

      <EditorContent editor={editor} />
    </div>
  );
}
