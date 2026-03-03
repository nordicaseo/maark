'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams } from 'next/navigation';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Highlight from '@tiptap/extension-highlight';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Link from '@tiptap/extension-link';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import Image from '@tiptap/extension-image';
import { CommentMark } from '@/lib/tiptap/comment-mark';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface PreviewDoc {
  title: string;
  content: any;
  plainText: string | null;
  status: string;
  contentType: string;
  wordCount: number;
  updatedAt: string;
}

interface Comment {
  id: number;
  authorName: string;
  content: string;
  quotedText: string | null;
  selectionFrom: number | null;
  selectionTo: number | null;
  isResolved: number;
  createdAt: string;
}

interface SelectionInfo {
  from: number;
  to: number;
  text: string;
  top: number;
  left: number;
}

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  in_progress: 'In Progress',
  review: 'Review',
  publish: 'Publish',
  live: 'Live',
};

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function PreviewPage() {
  const { token } = useParams<{ token: string }>();
  const [doc, setDoc] = useState<PreviewDoc | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Comment form state
  const [name, setName] = useState('');
  const [commentText, setCommentText] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Inline selection state
  const [selection, setSelection] = useState<SelectionInfo | null>(null);
  const [showInlineForm, setShowInlineForm] = useState(false);
  const [activeCommentId, setActiveCommentId] = useState<number | null>(null);
  const [showResolved, setShowResolved] = useState(false);

  const editorWrapperRef = useRef<HTMLDivElement>(null);
  const inlineFormRef = useRef<HTMLDivElement>(null);

  /* ── Editor setup ──────────────────────────────────────────────── */

  const editor = useEditor({
    immediatelyRender: false,
    // Keep editable: true so contenteditable="true" remains on the DOM —
    // this is required for window.getSelection() and editor.state.selection
    // to work correctly when the user selects text. All actual editing is
    // blocked by the editorProps handlers below.
    editable: true,
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3, 4] } }),
      Underline,
      Highlight.configure({ multicolor: true }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Link.configure({ openOnClick: true }),
      Table.configure({ resizable: false }),
      TableRow,
      TableCell,
      TableHeader,
      Image.configure({
        inline: false,
        allowBase64: false,
        HTMLAttributes: { class: 'tiptap-image' },
      }),
      CommentMark.configure({
        HTMLAttributes: { class: 'comment-highlight' },
      }),
    ],
    content: { type: 'doc', content: [{ type: 'paragraph' }] },
    editorProps: {
      // Block all user editing while keeping selections functional
      handleKeyDown: () => true,
      handleKeyPress: () => true,
      handlePaste: () => true,
      handleDrop: () => true,
      handleTextInput: () => true,
      attributes: {
        class: 'tiptap prose prose-zinc max-w-none preview-content',
        // Hide the text caret so it looks non-editable
        style: 'caret-color: transparent; cursor: default;',
      },
    },
  });

  /* ── Data fetching ─────────────────────────────────────────────── */

  useEffect(() => {
    if (!token) return;
    (async () => {
      try {
        const res = await fetch(`/api/preview/${token}`);
        if (!res.ok) {
          setError('Preview not found or link has expired.');
          return;
        }
        const data = await res.json();
        setDoc(data);
        if (editor && data.content) {
          editor.commands.setContent(data.content);
        }
      } catch {
        setError('Failed to load preview.');
      } finally {
        setLoading(false);
      }
    })();
  }, [token, editor]);

  const fetchComments = useCallback(async () => {
    if (!token) return;
    try {
      const r = await fetch(`/api/preview/${token}/comments`);
      const data = await r.json();
      setComments(Array.isArray(data) ? data : []);
    } catch {
      // ignore
    }
  }, [token]);

  useEffect(() => {
    fetchComments();
  }, [fetchComments]);

  /* ── Apply comment highlights to editor ────────────────────────── */

  const applyCommentHighlights = useCallback(() => {
    if (!editor || !comments.length) return;

    // Editor is already editable: true (for selection tracking), so we can
    // apply marks directly without toggling
    const inlineComments = comments.filter(
      (c) => c.selectionFrom != null && c.selectionTo != null && !c.isResolved
    );

    for (const c of inlineComments) {
      try {
        const docSize = editor.state.doc.content.size;
        const from = c.selectionFrom!;
        const to = c.selectionTo!;

        if (from >= 0 && to <= docSize && from < to) {
          editor
            .chain()
            .setTextSelection({ from, to })
            .setCommentMark(String(c.id))
            .run();
        }
      } catch {
        // Position may not match after doc changes — skip
      }
    }

    // Reset selection to start
    editor.commands.setTextSelection(0);
  }, [editor, comments]);

  useEffect(() => {
    if (editor && doc && comments.length > 0) {
      // Small delay to ensure content is fully rendered
      const t = setTimeout(applyCommentHighlights, 100);
      return () => clearTimeout(t);
    }
  }, [editor, doc, comments, applyCommentHighlights]);

  /* ── Text selection handler ────────────────────────────────────── */

  useEffect(() => {
    const wrapper = editorWrapperRef.current;
    if (!wrapper || !editor) return;

    const handleMouseUp = () => {
      // Give ProseMirror a tick to sync its selection from the DOM
      setTimeout(() => {
        if (!editor) return;

        // Since editor is editable: true, ProseMirror tracks selection natively
        const { from, to } = editor.state.selection;
        if (from === to) {
          if (!showInlineForm) setSelection(null);
          return;
        }

        const text = editor.state.doc.textBetween(from, to, ' ').trim();
        if (!text) {
          if (!showInlineForm) setSelection(null);
          return;
        }

        // Get visual position for the floating button from the browser selection
        const sel = window.getSelection();
        if (!sel || !sel.rangeCount) return;
        const range = sel.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        const wrapperRect = wrapper.getBoundingClientRect();

        setSelection({
          from,
          to,
          text: text.substring(0, 200),
          top: rect.top - wrapperRect.top + rect.height + 4,
          left: rect.left - wrapperRect.left + rect.width / 2,
        });
        setShowInlineForm(false);
      }, 10);
    };

    wrapper.addEventListener('mouseup', handleMouseUp);
    return () => wrapper.removeEventListener('mouseup', handleMouseUp);
  }, [editor, showInlineForm]);

  // Click outside to dismiss
  useEffect(() => {
    if (!selection && !showInlineForm) return;

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (
        inlineFormRef.current?.contains(target) ||
        target.closest('.comment-add-btn')
      ) {
        return;
      }
      // Don't dismiss if clicking inside the editor (for text selection)
      if (editorWrapperRef.current?.contains(target)) return;

      setSelection(null);
      setShowInlineForm(false);
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [selection, showInlineForm]);

  /* ── Comment actions ───────────────────────────────────────────── */

  const handleSubmitInlineComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !commentText.trim() || !selection) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/preview/${token}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          authorName: name.trim(),
          content: commentText.trim(),
          quotedText: selection.text,
          selectionFrom: selection.from,
          selectionTo: selection.to,
        }),
      });
      if (res.ok) {
        const newComment = await res.json();
        setComments((prev) => [newComment, ...prev]);
        setCommentText('');
        setSelection(null);
        setShowInlineForm(false);
      }
    } catch {
      // ignore
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmitGeneralComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !commentText.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/preview/${token}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          authorName: name.trim(),
          content: commentText.trim(),
        }),
      });
      if (res.ok) {
        const newComment = await res.json();
        setComments((prev) => [newComment, ...prev]);
        setCommentText('');
      }
    } catch {
      // ignore
    } finally {
      setSubmitting(false);
    }
  };

  const resolveComment = async (commentId: number) => {
    try {
      const res = await fetch(`/api/preview/${token}/comments`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commentId, isResolved: true }),
      });
      if (res.ok) {
        setComments((prev) =>
          prev.map((c) => (c.id === commentId ? { ...c, isResolved: 1 } : c))
        );
        // Remove highlight from editor
        if (editor) {
          editor.commands.unsetCommentMark(String(commentId));
        }
      }
    } catch {
      // ignore
    }
  };

  const scrollToComment = (commentId: number) => {
    setActiveCommentId(commentId);
    const el = document.getElementById(`comment-${commentId}`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  /* ── Click on highlight → scroll to comment ────────────────────── */

  useEffect(() => {
    const wrapper = editorWrapperRef.current;
    if (!wrapper) return;

    const handleClick = (e: Event) => {
      const target = e.target as HTMLElement;
      const highlight = target.closest('.comment-highlight');
      if (!highlight) return;

      const commentId = highlight.getAttribute('data-comment-id');
      if (commentId) {
        scrollToComment(Number(commentId));
      }
    };

    wrapper.addEventListener('click', handleClick);
    return () => wrapper.removeEventListener('click', handleClick);
  }, []);

  /* ── Derived data ──────────────────────────────────────────────── */

  const inlineComments = comments.filter(
    (c) => c.quotedText && !c.isResolved
  );
  const generalComments = comments.filter((c) => !c.quotedText && !c.isResolved);
  const resolvedComments = comments.filter((c) => !!c.isResolved);

  function timeAgo(dateStr: string) {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  }

  /* ── Render ────────────────────────────────────────────────────── */

  if (loading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <p className="text-zinc-500">Loading preview...</p>
      </div>
    );
  }

  if (error || !doc) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-zinc-800 mb-2">Preview Not Found</h1>
          <p className="text-zinc-500">{error || 'This preview link is invalid.'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white">
      <style>{`
        .preview-content { color: #27272a !important; }
        .preview-content h1, .preview-content h2,
        .preview-content h3, .preview-content h4 { color: #18181b !important; }
        .preview-content a { color: #2563eb !important; }
        .preview-content strong { color: #18181b !important; }
        .preview-content code { color: #27272a !important; }
        .preview-content blockquote { color: #52525b !important; border-color: #d4d4d8 !important; }
        .preview-content li::marker { color: #71717a !important; }
        .preview-content table td, .preview-content table th { border-color: #e4e4e7 !important; color: #27272a !important; }
        .preview-content hr { border-color: #e4e4e7 !important; }
        .preview-content .tiptap-image { max-width: 100%; height: auto; border-radius: 0.5rem; margin: 1.5rem 0; }
        .comment-highlight {
          background: rgba(253, 224, 71, 0.3);
          border-bottom: 2px solid rgb(253, 224, 71);
          cursor: pointer;
          transition: background 0.15s;
        }
        .comment-highlight:hover {
          background: rgba(253, 224, 71, 0.5);
        }
      `}</style>

      {/* Header */}
      <header className="border-b border-zinc-200 bg-zinc-50">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center gap-3 mb-2">
            <span className="text-xs font-medium px-2 py-0.5 rounded bg-zinc-200 text-zinc-600">
              {STATUS_LABELS[doc.status] || doc.status}
            </span>
            <span className="text-xs text-zinc-400">{doc.wordCount} words</span>
            <span className="text-xs text-zinc-400">
              Updated {new Date(doc.updatedAt).toLocaleDateString()}
            </span>
          </div>
          <h1 className="text-3xl font-bold text-zinc-900">{doc.title}</h1>
          <p className="text-xs text-zinc-400 mt-1">
            Select any text to add an inline comment
          </p>
        </div>
      </header>

      {/* Two-column layout */}
      <div className="max-w-7xl mx-auto flex">
        {/* Content column */}
        <main className="flex-1 min-w-0 px-6 py-8 border-r border-zinc-100">
          <div className="max-w-3xl relative" ref={editorWrapperRef}>
            <EditorContent editor={editor} />

            {/* Floating "Add Comment" button */}
            {selection && !showInlineForm && (
              <button
                className="comment-add-btn absolute z-20 px-3 py-1.5 bg-zinc-900 text-white text-xs font-medium rounded-md shadow-lg hover:bg-zinc-800 transition-colors"
                style={{
                  top: selection.top,
                  left: Math.max(0, selection.left - 50),
                }}
                onClick={() => setShowInlineForm(true)}
              >
                + Comment
              </button>
            )}

            {/* Inline comment form */}
            {selection && showInlineForm && (
              <div
                ref={inlineFormRef}
                className="absolute z-20 w-80 bg-white border border-zinc-200 rounded-lg shadow-xl p-3"
                style={{
                  top: selection.top,
                  left: Math.max(0, Math.min(selection.left - 160, 400)),
                }}
              >
                <div className="mb-2 px-2 py-1.5 bg-yellow-50 border-l-2 border-yellow-400 rounded text-xs text-zinc-600 italic line-clamp-2">
                  &ldquo;{selection.text}&rdquo;
                </div>
                <form onSubmit={handleSubmitInlineComment} className="space-y-2">
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Your name"
                    className="w-full px-2.5 py-1.5 border border-zinc-200 rounded text-xs text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-1 focus:ring-yellow-400"
                    required
                  />
                  <textarea
                    value={commentText}
                    onChange={(e) => setCommentText(e.target.value)}
                    placeholder="Add your comment..."
                    rows={2}
                    className="w-full px-2.5 py-1.5 border border-zinc-200 rounded text-xs text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-1 focus:ring-yellow-400 resize-none"
                    required
                    autoFocus
                  />
                  <div className="flex gap-2 justify-end">
                    <button
                      type="button"
                      onClick={() => {
                        setShowInlineForm(false);
                        setSelection(null);
                      }}
                      className="px-2.5 py-1 text-xs text-zinc-500 hover:text-zinc-700"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={submitting}
                      className="px-3 py-1 bg-yellow-500 text-white text-xs font-medium rounded hover:bg-yellow-600 disabled:opacity-50"
                    >
                      {submitting ? 'Posting...' : 'Comment'}
                    </button>
                  </div>
                </form>
              </div>
            )}
          </div>
        </main>

        {/* Comment sidebar */}
        <aside className="w-80 shrink-0 bg-zinc-50/50 overflow-y-auto max-h-[calc(100vh-120px)] sticky top-0">
          <div className="p-4">
            <h2 className="text-sm font-semibold text-zinc-800 mb-3">
              Comments ({inlineComments.length + generalComments.length})
            </h2>

            {/* Inline comments */}
            {inlineComments.length > 0 && (
              <div className="mb-4">
                <p className="text-[11px] font-medium text-zinc-400 uppercase tracking-wider mb-2">
                  Inline
                </p>
                <div className="space-y-2">
                  {inlineComments.map((c) => (
                    <div
                      key={c.id}
                      id={`comment-${c.id}`}
                      className={`p-3 rounded-lg border transition-colors cursor-pointer ${
                        activeCommentId === c.id
                          ? 'border-yellow-400 bg-yellow-50'
                          : 'border-zinc-200 bg-white hover:border-zinc-300'
                      }`}
                      onClick={() => {
                        setActiveCommentId(c.id);
                        // Try to scroll to the highlight in the editor
                        const el = editorWrapperRef.current?.querySelector(
                          `[data-comment-id="${c.id}"]`
                        );
                        el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                      }}
                    >
                      <div className="text-[11px] text-zinc-500 italic border-l-2 border-yellow-400 pl-2 mb-1.5 line-clamp-2">
                        &ldquo;{c.quotedText}&rdquo;
                      </div>
                      <p className="text-xs text-zinc-700 whitespace-pre-wrap">
                        {c.content}
                      </p>
                      <div className="flex items-center justify-between mt-2">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[11px] font-medium text-zinc-600">
                            {c.authorName}
                          </span>
                          <span className="text-[10px] text-zinc-400">
                            {timeAgo(c.createdAt)}
                          </span>
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            resolveComment(c.id);
                          }}
                          className="text-[10px] text-zinc-400 hover:text-green-600 transition-colors"
                          title="Resolve"
                        >
                          Resolve
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* General comments */}
            {generalComments.length > 0 && (
              <div className="mb-4">
                <p className="text-[11px] font-medium text-zinc-400 uppercase tracking-wider mb-2">
                  General
                </p>
                <div className="space-y-2">
                  {generalComments.map((c) => (
                    <div
                      key={c.id}
                      id={`comment-${c.id}`}
                      className="p-3 rounded-lg border border-zinc-200 bg-white"
                    >
                      <p className="text-xs text-zinc-700 whitespace-pre-wrap">
                        {c.content}
                      </p>
                      <div className="flex items-center gap-1.5 mt-2">
                        <span className="text-[11px] font-medium text-zinc-600">
                          {c.authorName}
                        </span>
                        <span className="text-[10px] text-zinc-400">
                          {timeAgo(c.createdAt)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Resolved toggle */}
            {resolvedComments.length > 0 && (
              <div className="mb-4">
                <button
                  onClick={() => setShowResolved(!showResolved)}
                  className="text-[11px] text-zinc-400 hover:text-zinc-600 flex items-center gap-1"
                >
                  <span>{showResolved ? '▾' : '▸'}</span>
                  {resolvedComments.length} resolved
                </button>
                {showResolved && (
                  <div className="mt-2 space-y-2">
                    {resolvedComments.map((c) => (
                      <div
                        key={c.id}
                        className="p-3 rounded-lg border border-zinc-100 bg-zinc-50 opacity-60"
                      >
                        {c.quotedText && (
                          <div className="text-[11px] text-zinc-400 italic border-l-2 border-zinc-300 pl-2 mb-1.5 line-clamp-1">
                            &ldquo;{c.quotedText}&rdquo;
                          </div>
                        )}
                        <p className="text-xs text-zinc-500 whitespace-pre-wrap line-through">
                          {c.content}
                        </p>
                        <div className="flex items-center gap-1.5 mt-1.5">
                          <span className="text-[11px] text-zinc-400">
                            {c.authorName}
                          </span>
                          <span className="text-[10px] text-green-500">
                            Resolved
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* General comment form */}
            <div className="border-t border-zinc-200 pt-3 mt-3">
              <p className="text-[11px] font-medium text-zinc-400 uppercase tracking-wider mb-2">
                Add a comment
              </p>
              <form onSubmit={handleSubmitGeneralComment} className="space-y-2">
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your name"
                  className="w-full px-2.5 py-1.5 border border-zinc-200 rounded text-xs text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-1 focus:ring-zinc-400"
                  required
                />
                <textarea
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  placeholder="Leave a general comment..."
                  rows={2}
                  className="w-full px-2.5 py-1.5 border border-zinc-200 rounded text-xs text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-1 focus:ring-zinc-400 resize-none"
                  required
                />
                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full px-3 py-1.5 bg-zinc-900 text-white text-xs font-medium rounded hover:bg-zinc-800 disabled:opacity-50"
                >
                  {submitting ? 'Posting...' : 'Post Comment'}
                </button>
              </form>
            </div>

            {inlineComments.length === 0 &&
              generalComments.length === 0 &&
              resolvedComments.length === 0 && (
                <p className="text-xs text-zinc-400 text-center py-6">
                  No comments yet. Select text to add inline feedback.
                </p>
              )}
          </div>
        </aside>
      </div>

      {/* Footer */}
      <footer className="border-t border-zinc-200 bg-zinc-50 py-4">
        <p className="text-center text-xs text-zinc-400">Powered by Maark</p>
      </footer>
    </div>
  );
}
