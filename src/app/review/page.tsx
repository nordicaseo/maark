'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/auth/auth-provider';
import { ProjectSwitcher } from '@/components/projects/project-switcher';
import { Badge } from '@/components/ui/badge';
import {
  ArrowLeft,
  MessageSquare,
  FileText,
  ExternalLink,
  Eye,
  Tag,
  User,
  Loader2,
} from 'lucide-react';
import Link from 'next/link';
import { STATUS_LABELS, CONTENT_FORMAT_LABELS } from '@/types/document';
import type { DocumentStatus, ContentFormat } from '@/types/document';
import { useActiveProject } from '@/hooks/use-active-project';

interface ReviewDocument {
  id: number;
  projectId: number | null;
  projectName: string | null;
  authorId: string | null;
  authorName: string | null;
  title: string;
  status: string;
  contentType: string;
  targetKeyword: string | null;
  wordCount: number;
  aiDetectionScore: number | null;
  semanticScore: number | null;
  contentQualityScore: number | null;
  previewToken: string | null;
  updatedAt: string;
  commentCount: number;
  totalComments: number;
}

const statusColors: Record<string, string> = {
  draft: 'bg-zinc-500/20 text-zinc-400',
  in_progress: 'bg-blue-500/20 text-blue-400',
  review: 'bg-yellow-500/20 text-yellow-400',
  publish: 'bg-purple-500/20 text-purple-400',
  live: 'bg-green-500/20 text-green-400',
};

function timeAgo(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

function ScorePill({ label, score, max, invert }: { label: string; score: number | null; max: number; invert?: boolean }) {
  if (score === null || score === undefined) return null;
  const ratio = invert ? (max - score) / (max - 1) : score / max;
  const color = ratio > 0.66 ? 'text-green-400' : ratio > 0.33 ? 'text-yellow-400' : 'text-red-400';
  const display = invert ? score.toFixed(1) : Math.round(score);
  return (
    <span className={`text-[11px] font-medium ${color}`}>
      {label}: {display}
    </span>
  );
}

export default function ReviewPage() {
  const { user, isLoading: authLoading } = useAuth();
  const router = useRouter();
  const [docs, setDocs] = useState<ReviewDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const { activeProjectId, setActiveProjectId } = useActiveProject();
  const [statusFilter, setStatusFilter] = useState<string>('all');

  const fetchDocs = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (activeProjectId) params.set('projectId', String(activeProjectId));
      const res = await fetch(`/api/review?${params}`);
      if (res.ok) {
        const data = await res.json();
        setDocs(data);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [activeProjectId]);

  useEffect(() => {
    if (!authLoading && user) fetchDocs();
  }, [authLoading, user, fetchDocs]);

  useEffect(() => {
    if (!authLoading && !user) {
      router.replace('/auth/signin');
    }
  }, [authLoading, user, router]);

  if (authLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!user) {
    return null;
  }

  const filtered = statusFilter === 'all'
    ? docs
    : docs.filter((d) => d.status === statusFilter);

  const withComments = filtered.filter((d) => d.commentCount > 0);
  const noComments = filtered.filter((d) => d.commentCount === 0);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card">
        <div className="max-w-6xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link
                href="/documents"
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <ArrowLeft className="h-5 w-5" />
              </Link>
              <div>
                <h1 className="text-xl font-bold">Review Dashboard</h1>
                <p className="text-sm text-muted-foreground">
                  {filtered.length} document{filtered.length !== 1 ? 's' : ''}
                  {withComments.length > 0 && ` \u00b7 ${withComments.length} with open comments`}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {user.role === 'owner' && (
                <div className="w-48">
                  <ProjectSwitcher
                    activeProjectId={activeProjectId}
                    onProjectChange={setActiveProjectId}
                  />
                </div>
              )}
            </div>
          </div>

          {/* Status filter tabs */}
          <div className="flex items-center gap-1 mt-4">
            {['all', 'draft', 'in_progress', 'review', 'publish', 'live'].map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  statusFilter === s
                    ? 'bg-accent text-accent-foreground'
                    : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
                }`}
              >
                {s === 'all' ? 'All' : STATUS_LABELS[s as DocumentStatus] || s}
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-6xl mx-auto px-6 py-6">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20">
            <FileText className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground">No documents found</p>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Section: Needs Attention (has unresolved comments) */}
            {withComments.length > 0 && (
              <section>
                <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                  Needs Attention ({withComments.length})
                </h2>
                <div className="grid gap-3">
                  {withComments.map((doc) => (
                    <ReviewCard key={doc.id} doc={doc} />
                  ))}
                </div>
              </section>
            )}

            {/* Section: All documents */}
            {noComments.length > 0 && (
              <section>
                <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                  {withComments.length > 0 ? 'Other Documents' : 'All Documents'} ({noComments.length})
                </h2>
                <div className="grid gap-3">
                  {noComments.map((doc) => (
                    <ReviewCard key={doc.id} doc={doc} />
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

function ReviewCard({ doc }: { doc: ReviewDocument }) {
  return (
    <div className="bg-card border border-border rounded-lg p-4 hover:border-border/80 transition-colors">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <Link
              href={`/documents/${doc.id}`}
              className="text-sm font-medium hover:underline truncate"
            >
              {doc.title}
            </Link>
            <Badge
              variant="secondary"
              className={`text-[10px] px-1.5 py-0 shrink-0 ${statusColors[doc.status] || ''}`}
            >
              {STATUS_LABELS[doc.status as DocumentStatus] || doc.status}
            </Badge>
          </div>

          <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
            {doc.projectName && (
              <span className="flex items-center gap-1">
                <FileText className="h-3 w-3" />
                {doc.projectName}
              </span>
            )}
            {doc.authorName && (
              <span className="flex items-center gap-1">
                <User className="h-3 w-3" />
                {doc.authorName}
              </span>
            )}
            {doc.targetKeyword && (
              <span className="flex items-center gap-1">
                <Tag className="h-3 w-3" />
                {doc.targetKeyword}
              </span>
            )}
            <span>
              {CONTENT_FORMAT_LABELS[doc.contentType as ContentFormat] || doc.contentType}
            </span>
            <span>{doc.wordCount || 0} words</span>
            <span>{timeAgo(doc.updatedAt)}</span>
          </div>

          <div className="flex items-center gap-3 mt-2">
            <ScorePill label="AI" score={doc.aiDetectionScore} max={5} invert />
            <ScorePill label="SEO" score={doc.semanticScore} max={100} />
            <ScorePill label="Quality" score={doc.contentQualityScore} max={100} />
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {doc.commentCount > 0 && (
            <div className="flex items-center gap-1 px-2 py-1 bg-yellow-500/10 text-yellow-500 rounded-md">
              <MessageSquare className="h-3.5 w-3.5" />
              <span className="text-xs font-medium">{doc.commentCount}</span>
            </div>
          )}
          {doc.totalComments > 0 && doc.commentCount === 0 && (
            <div className="flex items-center gap-1 px-2 py-1 bg-green-500/10 text-green-500 rounded-md">
              <MessageSquare className="h-3.5 w-3.5" />
              <span className="text-xs font-medium">All resolved</span>
            </div>
          )}
          {doc.previewToken && (
            <Link
              href={`/preview/${doc.previewToken}`}
              target="_blank"
              className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium bg-accent hover:bg-accent/80 rounded-md transition-colors"
            >
              <Eye className="h-3.5 w-3.5" />
              Preview
            </Link>
          )}
          <Link
            href={`/documents/${doc.id}`}
            className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 rounded-md transition-colors"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Open
          </Link>
        </div>
      </div>
    </div>
  );
}
