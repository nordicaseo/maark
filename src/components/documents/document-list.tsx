'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Plus, FileText, Trash2, Settings, User, Tag, Eye, Kanban } from 'lucide-react';
import Link from 'next/link';
import { CreateDialog } from './create-dialog';
import { ProjectSwitcher } from '@/components/projects/project-switcher';
import { useAuth } from '@/components/auth/auth-provider';
import type { Document, DocumentStatus, ContentFormat } from '@/types/document';
import { STATUS_LABELS, CONTENT_FORMAT_LABELS } from '@/types/document';

interface DocumentListProps {
  documents: Document[];
  activeId?: number;
  onRefresh: () => void;
  activeProjectId: number | null;
  onProjectChange: (projectId: number | null) => void;
}

const statusColors: Record<DocumentStatus, string> = {
  draft: 'bg-zinc-500/20 text-zinc-400',
  in_progress: 'bg-blue-500/20 text-blue-400',
  review: 'bg-yellow-500/20 text-yellow-400',
  publish: 'bg-purple-500/20 text-purple-400',
  accepted: 'bg-emerald-500/20 text-emerald-400',
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

function ScoreBar({ label, score, max, invert }: { label: string; score: number | null; max: number; invert?: boolean }) {
  if (score === null) return null;
  const ratio = invert ? (max - score) / (max - 1) : score / max;
  const color = ratio > 0.66 ? 'bg-green-500' : ratio > 0.33 ? 'bg-yellow-500' : 'bg-red-500';
  const display = invert ? score.toFixed(1) : Math.round(score);
  return (
    <div className="flex items-center gap-1">
      <span className="text-[9px] text-muted-foreground w-5 shrink-0">{label}</span>
      <div className="h-1 w-8 bg-muted rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full`} style={{ width: `${Math.min(ratio * 100, 100)}%` }} />
      </div>
      <span className="text-[9px] text-muted-foreground">{display}</span>
    </div>
  );
}

export function DocumentList({ documents, activeId, onRefresh, activeProjectId, onProjectChange }: DocumentListProps) {
  const router = useRouter();
  const { user } = useAuth();
  const [filter, setFilter] = useState<string>('all');
  const [showCreate, setShowCreate] = useState(false);

  const filtered =
    filter === 'all'
      ? documents
      : documents.filter((d) => d.status === filter);

  const handleDelete = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await fetch(`/api/documents/${id}`, { method: 'DELETE' });
      onRefresh();
      if (activeId === id) router.push('/documents');
    } catch {}
  };

  return (
    <div className="flex flex-col h-full">
      {/* Project Switcher */}
      <div className="px-2 pt-2">
        <ProjectSwitcher
          activeProjectId={activeProjectId}
          onProjectChange={onProjectChange}
        />
      </div>

      <div className="p-3 border-b border-border flex items-center gap-2">
        <h2 className="text-sm font-semibold flex-1">Documents</h2>
        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setShowCreate(true)}>
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      <div className="px-3 py-2">
        <Select value={filter} onValueChange={setFilter}>
          <SelectTrigger className="h-7 text-xs">
            <SelectValue placeholder="Filter" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            {Object.entries(STATUS_LABELS).map(([key, label]) => (
              <SelectItem key={key} value={key}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-2 space-y-1">
          {filtered.map((doc) => (
            <div
              key={doc.id}
              role="button"
              tabIndex={0}
              onClick={() => router.push(`/documents/${doc.id}`)}
              onKeyDown={(e) => { if (e.key === 'Enter') router.push(`/documents/${doc.id}`); }}
              className={`w-full text-left rounded-lg p-3 transition-colors hover:bg-accent group cursor-pointer ${
                activeId === doc.id ? 'bg-accent' : ''
              }`}
            >
              <div className="flex items-start gap-2">
                <FileText className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{doc.title}</p>
                  <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                    <Badge
                      variant="secondary"
                      className={`text-[10px] px-1.5 py-0 ${statusColors[doc.status]}`}
                    >
                      {STATUS_LABELS[doc.status]}
                    </Badge>
                    <span className="text-[10px] text-muted-foreground">
                      {CONTENT_FORMAT_LABELS[doc.contentType] || doc.contentType}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      {doc.wordCount || 0}w
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mt-1 text-[10px] text-muted-foreground">
                    {doc.authorName && (
                      <span className="flex items-center gap-0.5 truncate">
                        <User className="h-2.5 w-2.5" />
                        {doc.authorName}
                      </span>
                    )}
                    {doc.targetKeyword && (
                      <span className="flex items-center gap-0.5 truncate max-w-[120px]">
                        <Tag className="h-2.5 w-2.5 shrink-0" />
                        {doc.targetKeyword}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center justify-between mt-1.5">
                    <span className="text-[9px] text-muted-foreground">
                      {timeAgo(doc.updatedAt)}
                    </span>
                    <div className="flex items-center gap-2">
                      <ScoreBar label="AI" score={doc.aiDetectionScore} max={5} invert />
                      <ScoreBar label="SEO" score={doc.semanticScore} max={100} />
                      <ScoreBar label="Q" score={doc.contentQualityScore} max={100} />
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={(e) => handleDelete(doc.id, e)}
                        onKeyDown={(e) => { if (e.key === 'Enter') handleDelete(doc.id, e as any); }}
                        className="opacity-0 group-hover:opacity-100 transition-opacity ml-1 p-0.5 rounded hover:bg-red-500/20 hover:text-red-400 text-muted-foreground cursor-pointer shrink-0"
                        title="Delete document"
                      >
                        <Trash2 className="h-3 w-3" />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))}
          {filtered.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-8">
              No documents yet
            </p>
          )}
        </div>
      </ScrollArea>

      <div className="p-2 border-t border-border space-y-0.5">
        <Link
          href="/mission-control"
          className="flex items-center gap-2 px-3 py-2 rounded-md text-sm text-muted-foreground hover:bg-accent/50 hover:text-foreground transition-colors"
        >
          <Kanban className="h-4 w-4" />
          Mission Control
        </Link>
        <Link
          href="/review"
          className="flex items-center gap-2 px-3 py-2 rounded-md text-sm text-muted-foreground hover:bg-accent/50 hover:text-foreground transition-colors"
        >
          <Eye className="h-4 w-4" />
          Review
        </Link>
        {user?.role === 'owner' && (
          <Link
            href="/admin"
            className="flex items-center gap-2 px-3 py-2 rounded-md text-sm text-muted-foreground hover:bg-accent/50 hover:text-foreground transition-colors"
          >
            <Settings className="h-4 w-4" />
            Admin
          </Link>
        )}
      </div>

      <CreateDialog
        open={showCreate}
        onOpenChange={setShowCreate}
        onCreated={onRefresh}
        projectId={activeProjectId}
      />
    </div>
  );
}
