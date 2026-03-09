'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import {
  MessageSquare,
  Check,
  Sparkles,
  Loader2,
  ChevronDown,
  ChevronRight,
  Search,
  AlertTriangle,
  RotateCcw,
  Bot,
  User,
  GitBranch,
} from 'lucide-react';
import type { Editor } from '@tiptap/react';
import { normalizeGeneratedHtml, validateRevisedHtmlOutput } from '@/lib/utils/html-normalize';

interface Comment {
  id: number;
  documentId: number;
  previewToken: string;
  authorName: string;
  content: string;
  quotedText: string | null;
  selectionFrom: number | null;
  selectionTo: number | null;
  isResolved: number;
  createdAt: string;
}

interface WorkflowFeedbackEvent {
  id: string;
  stageKey: string;
  eventType: string;
  actorType: string;
  actorName: string;
  summary: string;
  payload?: Record<string, unknown>;
  createdAt: number;
}

interface CommentsPanelProps {
  documentId: number | null;
  editor: Editor | null;
  onContentReplaced?: () => void;
  refreshKey?: number;
}

type ProcessNoticeCode =
  | 'editor_not_ready'
  | 'no_comments'
  | 'processing_failed'
  | 'processed';

interface ProcessNotice {
  code: ProcessNoticeCode;
  message: string;
  retryable: boolean;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export function CommentsPanel({ documentId, editor, onContentReplaced, refreshKey }: CommentsPanelProps) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [showResolved, setShowResolved] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [processNotice, setProcessNotice] = useState<ProcessNotice | null>(null);
  const [lastUseResearch, setLastUseResearch] = useState(false);
  const [workflowFeedback, setWorkflowFeedback] = useState<WorkflowFeedbackEvent[]>([]);
  const [showWorkflow, setShowWorkflow] = useState(true);

  useEffect(() => {
    setProcessNotice(null);
    setSelectedIds(new Set());
  }, [documentId]);

  const fetchComments = useCallback(async () => {
    if (!documentId) return;
    setLoading(true);
    try {
      const [commentsRes, feedbackRes] = await Promise.all([
        fetch(`/api/documents/${documentId}/comments`),
        fetch(`/api/documents/${documentId}/workflow-feedback`),
      ]);
      if (commentsRes.ok) {
        const data = await commentsRes.json();
        setComments(Array.isArray(data) ? data : []);
      }
      if (feedbackRes.ok) {
        const data = await feedbackRes.json();
        setWorkflowFeedback(Array.isArray(data) ? data : []);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [documentId]);

  useEffect(() => {
    fetchComments();
  }, [fetchComments]);

  // Re-fetch when refreshKey changes (e.g. after a new inline comment is created)
  useEffect(() => {
    if (refreshKey && refreshKey > 0) {
      fetchComments();
    }
  }, [refreshKey, fetchComments]);

  // Apply comment highlights to the editor for unresolved inline comments
  useEffect(() => {
    if (!editor || !comments.length) return;

    const inlineUnresolved = comments.filter(
      (c: Comment) => c.selectionFrom != null && c.selectionTo != null && !c.isResolved
    );

    const timer = setTimeout(() => {
      for (const c of inlineUnresolved) {
        try {
          const docSize = editor.state.doc.content.size;
          const from = c.selectionFrom!;
          const to = c.selectionTo!;
          if (from >= 0 && to <= docSize && from < to) {
            editor.chain().setTextSelection({ from, to }).setCommentMark(String(c.id)).run();
          }
        } catch {
          // Position may not match after edits
        }
      }
      // Reset selection
      editor.commands.setTextSelection(0);
    }, 200);

    return () => clearTimeout(timer);
  }, [editor, comments]);

  const unresolvedComments = comments.filter((c) => !c.isResolved);
  const resolvedComments = comments.filter((c) => !!c.isResolved);
  const inlineComments = unresolvedComments.filter((c) => c.quotedText);
  const generalComments = unresolvedComments.filter((c) => !c.quotedText);
  const processDisabledReason = !editor
    ? 'Editor not ready'
    : unresolvedComments.length === 0
      ? 'No unresolved comments'
      : null;

  const handleResolve = async (commentId: number) => {
    if (!documentId) return;
    try {
      const res = await fetch(`/api/documents/${documentId}/comments`, {
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

  const handleUnresolve = async (commentId: number) => {
    if (!documentId) return;
    try {
      const res = await fetch(`/api/documents/${documentId}/comments`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commentId, isResolved: false }),
      });
      if (res.ok) {
        setComments((prev) =>
          prev.map((c) => (c.id === commentId ? { ...c, isResolved: 0 } : c))
        );
      }
    } catch {
      // ignore
    }
  };

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleProcessWithAI = async (useResearch: boolean = false) => {
    setLastUseResearch(useResearch);
    if (!documentId) {
      setProcessNotice({
        code: 'processing_failed',
        message: 'Document is missing. Reload and try again.',
        retryable: true,
      });
      return;
    }
    if (!editor) {
      setProcessNotice({
        code: 'editor_not_ready',
        message: 'Editor not ready yet. Wait for the document to finish loading.',
        retryable: false,
      });
      return;
    }
    if (unresolvedComments.length === 0) {
      setProcessNotice({
        code: 'no_comments',
        message: 'No unresolved comments to process.',
        retryable: false,
      });
      return;
    }

    setProcessing(true);
    setProcessNotice(null);

    try {
      const commentIdsToProcess = selectedIds.size > 0
        ? Array.from(selectedIds)
        : undefined;

      const res = await fetch('/api/ai/process-comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          documentId,
          commentIds: commentIdsToProcess,
          useResearch,
        }),
      });

      const payload = await res.json().catch(() => ({}));
      if (!res.ok || !payload?.ok) {
        const message =
          payload?.error ||
          payload?.message ||
          'Failed to process comments';
        setProcessNotice({
          code:
            payload?.code === 'NO_COMMENTS'
              ? 'no_comments'
              : payload?.code === 'EDITOR_NOT_READY'
                ? 'editor_not_ready'
                : 'processing_failed',
          message,
          retryable: payload?.code !== 'NO_COMMENTS',
        });
        setProcessing(false);
        return;
      }

      const result = String(payload.contentHtml || '').trim();
      if (!result) {
        setProcessNotice({
          code: 'processing_failed',
          message: 'AI returned an empty revision. Retry processing.',
          retryable: true,
        });
        setProcessing(false);
        return;
      }

      const sourceHtml = editor.getHTML();
      const normalized = normalizeGeneratedHtml(result);
      const validation = validateRevisedHtmlOutput(sourceHtml, normalized);
      if (!validation.ok) {
        setProcessNotice({
          code: 'processing_failed',
          message:
            validation.reason || 'AI output was rejected to prevent document truncation.',
          retryable: true,
        });
        setProcessing(false);
        return;
      }
      editor.chain().focus().clearContent().insertContent(normalized).run();

      const idsToResolve = commentIdsToProcess || unresolvedComments.map((c) => c.id);
      for (const id of idsToResolve) {
        await handleResolve(id);
      }

      setSelectedIds(new Set());
      onContentReplaced?.();
      setProcessNotice({
        code: 'processed',
        message: `Processed ${idsToResolve.length} comment${idsToResolve.length === 1 ? '' : 's'} with AI.`,
        retryable: false,
      });
    } catch (err) {
      console.error('AI processing error:', err);
      setProcessNotice({
        code: 'processing_failed',
        message: (err as Error)?.message || 'Failed to process comments',
        retryable: true,
      });
    } finally {
      setProcessing(false);
    }
  };

  const scrollToHighlight = (comment: Comment) => {
    if (!editor || !comment.selectionFrom) return;
    try {
      const docSize = editor.state.doc.content.size;
      if (comment.selectionFrom < docSize) {
        editor.chain().setTextSelection(comment.selectionFrom).scrollIntoView().run();
      }
    } catch {
      // Position may not match
    }
  };

  if (!documentId) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm p-4">
        Select a document to see comments
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-3 border-b border-border shrink-0">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">
              Comments ({unresolvedComments.length})
            </span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={fetchComments}
            disabled={loading}
          >
            {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Refresh'}
          </Button>
        </div>

        {/* AI Processing buttons */}
        <div className="flex flex-col sm:flex-row gap-2">
          <Button
            size="sm"
            className="h-8 text-xs w-full sm:flex-1 gap-1"
            onClick={() => handleProcessWithAI(false)}
            disabled={processing || Boolean(processDisabledReason)}
            title={processDisabledReason || undefined}
          >
            {processing ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Sparkles className="h-3 w-3" />
            )}
            {selectedIds.size > 0 ? `Process ${selectedIds.size} with AI` : 'Process All with AI'}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8 text-xs w-full sm:w-auto gap-1"
            onClick={() => handleProcessWithAI(true)}
            disabled={processing || Boolean(processDisabledReason)}
            title="Process with AI + Perplexity research"
          >
            <Search className="h-3 w-3" />
            + Research
          </Button>
        </div>
        {(processDisabledReason || processNotice) && (
          <div className="mt-2 text-[11px] flex items-center justify-between gap-2">
            <span
              className={`flex items-center gap-1 ${
                processNotice?.code === 'processing_failed'
                  ? 'text-red-600'
                  : 'text-muted-foreground'
              }`}
            >
              {processNotice?.code === 'processing_failed' ? (
                <AlertTriangle className="h-3 w-3" />
              ) : null}
              {processNotice?.message || processDisabledReason}
            </span>
            {processNotice?.retryable && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-[10px]"
                onClick={() => handleProcessWithAI(lastUseResearch)}
                disabled={processing}
              >
                <RotateCcw className="h-3 w-3 mr-1" />
                Retry
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Comment list */}
      <div className="flex-1 overflow-y-auto min-h-0 p-3 space-y-4">
        {loading && comments.length === 0 ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : unresolvedComments.length === 0 && resolvedComments.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-8">
            No comments yet. Share the preview link to collect feedback.
          </p>
        ) : (
          <>
            {/* Inline comments */}
            {inlineComments.length > 0 && (
              <div>
                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-2">
                  Inline ({inlineComments.length})
                </p>
                <div className="space-y-2">
                  {inlineComments.map((c) => (
                    <CommentCard
                      key={c.id}
                      comment={c}
                      selected={selectedIds.has(c.id)}
                      onToggleSelect={() => toggleSelect(c.id)}
                      onResolve={() => handleResolve(c.id)}
                      onClick={() => scrollToHighlight(c)}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* General comments */}
            {generalComments.length > 0 && (
              <div>
                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-2">
                  General ({generalComments.length})
                </p>
                <div className="space-y-2">
                  {generalComments.map((c) => (
                    <CommentCard
                      key={c.id}
                      comment={c}
                      selected={selectedIds.has(c.id)}
                      onToggleSelect={() => toggleSelect(c.id)}
                      onResolve={() => handleResolve(c.id)}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Resolved comments */}
            {resolvedComments.length > 0 && (
              <div>
                <button
                  onClick={() => setShowResolved(!showResolved)}
                  className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
                >
                  {showResolved ? (
                    <ChevronDown className="h-3 w-3" />
                  ) : (
                    <ChevronRight className="h-3 w-3" />
                  )}
                  {resolvedComments.length} resolved
                </button>
                {showResolved && (
                  <div className="mt-2 space-y-2">
                    {resolvedComments.map((c) => (
                      <div
                        key={c.id}
                        className="p-2.5 rounded-md border border-border/50 bg-muted/30 opacity-60"
                      >
                        {c.quotedText && (
                          <p className="text-[10px] text-muted-foreground italic border-l-2 border-muted-foreground/30 pl-2 mb-1 line-clamp-1">
                            &ldquo;{c.quotedText}&rdquo;
                          </p>
                        )}
                        <p className="text-xs text-muted-foreground line-through">
                          {c.content}
                        </p>
                        <div className="flex items-center justify-between mt-1.5">
                          <span className="text-[10px] text-muted-foreground">
                            {c.authorName} &middot; {timeAgo(c.createdAt)}
                          </span>
                          <button
                            onClick={() => handleUnresolve(c.id)}
                            className="text-[10px] text-muted-foreground hover:text-foreground"
                          >
                            Unresolve
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Workflow Feedback */}
            {workflowFeedback.length > 0 && (
              <div>
                <button
                  onClick={() => setShowWorkflow(!showWorkflow)}
                  className="flex items-center gap-1 text-[10px] font-medium text-muted-foreground uppercase tracking-wider hover:text-foreground"
                >
                  {showWorkflow ? (
                    <ChevronDown className="h-3 w-3" />
                  ) : (
                    <ChevronRight className="h-3 w-3" />
                  )}
                  <GitBranch className="h-3 w-3" />
                  Workflow Feedback ({workflowFeedback.length})
                </button>
                {showWorkflow && (
                  <div className="mt-2 space-y-2">
                    {workflowFeedback.map((evt) => (
                      <WorkflowFeedbackCard key={evt.id} event={evt} />
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function stageLabel(key: string): string {
  const labels: Record<string, string> = {
    research: 'Research',
    serp_analysis: 'SERP Analysis',
    outline_build: 'Outline',
    prewrite: 'Prewrite',
    pm_review: 'PM Review',
    writing: 'Writing',
    editing: 'Editing',
    final_review: 'Final Review',
  };
  return labels[key] || key.replace(/_/g, ' ');
}

function feedbackColor(eventType: string): string {
  switch (eventType) {
    case 'approval':
      return 'border-green-500/40 bg-green-500/5';
    case 'discussion':
      return 'border-amber-500/40 bg-amber-500/5';
    case 'transition':
      return 'border-blue-500/40 bg-blue-500/5';
    default:
      return 'border-border';
  }
}

function WorkflowFeedbackCard({ event }: { event: WorkflowFeedbackEvent }) {
  const isAgent = event.actorType === 'agent' || event.actorType === 'system';
  const p = event.payload && typeof event.payload === 'object'
    ? (event.payload as Record<string, unknown>)
    : null;
  const rawPayload = p?.text || p?.feedback || p?.reason || p?.value;
  const payloadText = typeof rawPayload === 'string' ? rawPayload : null;

  return (
    <div className={`p-2.5 rounded-md border-l-2 ${feedbackColor(event.eventType)}`}>
      <div className="flex items-center gap-1.5 mb-1">
        {isAgent ? (
          <Bot className="h-3 w-3 text-muted-foreground shrink-0" />
        ) : (
          <User className="h-3 w-3 text-muted-foreground shrink-0" />
        )}
        <span className="text-[10px] font-medium text-muted-foreground">
          {event.actorName}
        </span>
        <span className="text-[10px] text-muted-foreground/60">
          &middot; {stageLabel(event.stageKey)}
        </span>
      </div>
      <p className="text-xs leading-relaxed whitespace-pre-wrap">{event.summary}</p>
      {payloadText && (
        <p className="text-[11px] text-muted-foreground mt-1 italic border-l-2 border-muted-foreground/20 pl-2">
          {payloadText.length > 300 ? payloadText.slice(0, 300) + '...' : payloadText}
        </p>
      )}
      <p className="text-[10px] text-muted-foreground/50 mt-1">
        {new Date(event.createdAt).toLocaleString()}
      </p>
    </div>
  );
}

function CommentCard({
  comment,
  selected,
  onToggleSelect,
  onResolve,
  onClick,
}: {
  comment: Comment;
  selected: boolean;
  onToggleSelect: () => void;
  onResolve: () => void;
  onClick?: () => void;
}) {
  return (
    <div
      className={`p-2.5 rounded-md border transition-colors cursor-pointer ${
        selected
          ? 'border-primary/50 bg-primary/5'
          : 'border-border hover:border-border/80'
      }`}
      onClick={onClick}
    >
      {comment.quotedText && (
        <p className="text-[10px] text-yellow-500/80 italic border-l-2 border-yellow-500/50 pl-2 mb-1.5 line-clamp-2">
          &ldquo;{comment.quotedText}&rdquo;
        </p>
      )}
      <p className="text-xs whitespace-pre-wrap">{comment.content}</p>
      <div className="flex items-center justify-between mt-2">
        <span className="text-[10px] text-muted-foreground">
          {comment.authorName} &middot; {timeAgo(comment.createdAt)}
        </span>
        <div className="flex items-center gap-1.5">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleSelect();
            }}
            className={`text-[10px] px-1.5 py-0.5 rounded ${
              selected
                ? 'bg-primary/20 text-primary'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {selected ? 'Selected' : 'Select'}
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onResolve();
            }}
            className="text-[10px] text-muted-foreground hover:text-green-500 flex items-center gap-0.5"
          >
            <Check className="h-3 w-3" />
            Resolve
          </button>
        </div>
      </div>
    </div>
  );
}
