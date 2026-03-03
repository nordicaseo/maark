'use client';

import { useEffect, useState } from 'react';
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
  createdAt: string;
}

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  in_progress: 'In Progress',
  review: 'Review',
  publish: 'Publish',
  live: 'Live',
};

export default function PreviewPage() {
  const { token } = useParams<{ token: string }>();
  const [doc, setDoc] = useState<PreviewDoc | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const editor = useEditor({
    immediatelyRender: false,
    editable: false,
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
    ],
    content: { type: 'doc', content: [{ type: 'paragraph' }] },
    editorProps: {
      attributes: {
        class: 'tiptap prose prose-zinc max-w-none preview-content',
      },
    },
  });

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

  useEffect(() => {
    if (!token) return;
    fetch(`/api/preview/${token}/comments`)
      .then((r) => r.json())
      .then(setComments)
      .catch(() => {});
  }, [token]);

  const handleSubmitComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !comment.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/preview/${token}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ authorName: name.trim(), content: comment.trim() }),
      });
      if (res.ok) {
        const newComment = await res.json();
        setComments((prev) => [newComment, ...prev]);
        setComment('');
      }
    } catch {
      // ignore
    } finally {
      setSubmitting(false);
    }
  };

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
      `}</style>
      {/* Header */}
      <header className="border-b border-zinc-200 bg-zinc-50">
        <div className="max-w-4xl mx-auto px-6 py-4">
          <div className="flex items-center gap-3 mb-2">
            <span className="text-xs font-medium px-2 py-0.5 rounded bg-zinc-200 text-zinc-600">
              {STATUS_LABELS[doc.status] || doc.status}
            </span>
            <span className="text-xs text-zinc-400">
              {doc.wordCount} words
            </span>
            <span className="text-xs text-zinc-400">
              Updated {new Date(doc.updatedAt).toLocaleDateString()}
            </span>
          </div>
          <h1 className="text-3xl font-bold text-zinc-900">{doc.title}</h1>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-4xl mx-auto px-6 py-8">
        <EditorContent editor={editor} />
      </main>

      {/* Comments */}
      <section className="max-w-4xl mx-auto px-6 py-8 border-t border-zinc-200">
        <h2 className="text-xl font-semibold text-zinc-800 mb-6">
          Comments ({comments.length})
        </h2>

        <form onSubmit={handleSubmitComment} className="mb-8 space-y-3">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name"
            className="w-full px-3 py-2 border border-zinc-300 rounded-md text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
            required
          />
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Leave a comment..."
            rows={3}
            className="w-full px-3 py-2 border border-zinc-300 rounded-md text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            required
          />
          <button
            type="submit"
            disabled={submitting}
            className="px-4 py-2 bg-zinc-900 text-white text-sm font-medium rounded-md hover:bg-zinc-800 disabled:opacity-50"
          >
            {submitting ? 'Posting...' : 'Post Comment'}
          </button>
        </form>

        <div className="space-y-4">
          {comments.map((c) => (
            <div key={c.id} className="p-4 bg-zinc-50 rounded-lg">
              <div className="flex items-center gap-2 mb-2">
                <span className="font-medium text-sm text-zinc-800">{c.authorName}</span>
                <span className="text-xs text-zinc-400">
                  {new Date(c.createdAt).toLocaleString()}
                </span>
              </div>
              <p className="text-sm text-zinc-600 whitespace-pre-wrap">{c.content}</p>
            </div>
          ))}
          {comments.length === 0 && (
            <p className="text-sm text-zinc-400 text-center py-4">No comments yet.</p>
          )}
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-zinc-200 bg-zinc-50 py-4">
        <p className="text-center text-xs text-zinc-400">
          Powered by Maark
        </p>
      </footer>
    </div>
  );
}
