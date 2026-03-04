'use client';

import { useState } from 'react';
import { X, Send } from 'lucide-react';
import type { Editor } from '@tiptap/react';

interface InlineCommentFormProps {
  documentId: number;
  quotedText: string;
  selectionFrom: number;
  selectionTo: number;
  editor: Editor;
  onClose: () => void;
  onCommentCreated: () => void;
}

export function InlineCommentForm({
  documentId,
  quotedText,
  selectionFrom,
  selectionTo,
  editor,
  onClose,
  onCommentCreated,
}: InlineCommentFormProps) {
  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!content.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/documents/${documentId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: content.trim(),
          quotedText,
          selectionFrom,
          selectionTo,
        }),
      });
      if (res.ok) {
        const comment = await res.json();
        // Apply comment highlight to editor
        editor
          .chain()
          .setTextSelection({ from: selectionFrom, to: selectionTo })
          .setCommentMark(String(comment.id))
          .run();
        onCommentCreated();
        onClose();
      }
    } catch (err) {
      console.error('Failed to create comment:', err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-32"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white rounded-lg shadow-xl border border-gray-200 w-96 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium">Add Comment</h3>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded">
            <X className="h-4 w-4 text-gray-500" />
          </button>
        </div>

        {/* Quoted text */}
        <div className="text-xs text-gray-500 bg-yellow-50 border-l-2 border-yellow-400 px-3 py-2 rounded">
          &ldquo;{quotedText}&rdquo;
        </div>

        {/* Comment input */}
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Add your comment..."
          className="w-full text-sm border border-gray-200 rounded-md p-2 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
          rows={3}
          autoFocus
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSubmit();
          }}
        />

        <div className="flex justify-end">
          <button
            onClick={handleSubmit}
            disabled={!content.trim() || submitting}
            className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1.5"
          >
            <Send className="h-3 w-3" />
            {submitting ? 'Sending...' : 'Comment'}
          </button>
        </div>
      </div>
    </div>
  );
}
