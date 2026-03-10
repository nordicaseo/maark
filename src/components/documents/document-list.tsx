'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Plus, Trash2, Settings, Eye, Kanban, Search, Globe, LayoutDashboard } from 'lucide-react';
import Link from 'next/link';
import { CreateDialog } from './create-dialog';
import { ProjectSwitcher } from '@/components/projects/project-switcher';
import { useAuth } from '@/components/auth/auth-provider';
import type { DocumentStatus } from '@/types/document';
import type { ContentItemCard } from '@/types/content-item';
import { STATUS_LABELS } from '@/types/document';
import { withProjectScope } from '@/lib/project-context';
import { hasRole } from '@/lib/permissions';

interface DocumentListProps {
  documents: ContentItemCard[];
  activeId?: number;
  onRefresh: () => void;
  activeProjectId: number | null;
  onProjectChange: (projectId: number | null) => void;
}

const STATUS_DOT_COLORS: Record<DocumentStatus, string> = {
  draft: 'bg-stone-400',
  in_progress: 'bg-emerald-500',
  review: 'bg-amber-500',
  publish: 'bg-orange-500',
  accepted: 'bg-teal-500',
  live: 'bg-green-500',
};

export function DocumentList({ documents, activeId, onRefresh, activeProjectId, onProjectChange }: DocumentListProps) {
  const router = useRouter();
  const { user } = useAuth();
  const [filter, setFilter] = useState<string>('all');
  const [showCreate, setShowCreate] = useState(false);

  const filtered =
    filter === 'all'
      ? documents
      : documents.filter((d) => d.status === filter);

  const handleDelete = async (id: number, e: React.SyntheticEvent) => {
    e.stopPropagation();
    try {
      await fetch(`/api/documents/${id}`, { method: 'DELETE' });
      onRefresh();
      if (activeId === id) router.push(withProjectScope('/documents', activeProjectId));
    } catch {}
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
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

      <div className="min-h-0 flex-1">
        <ScrollArea className="h-full [scrollbar-gutter:stable_both-edges]">
          <div className="p-2 pr-3 space-y-0.5">
            {filtered.map((doc) => (
              <div
                key={doc.id}
                role="button"
                tabIndex={0}
                onClick={() => router.push(withProjectScope(`/documents/${doc.id}`, activeProjectId))}
                onKeyDown={(e) => { if (e.key === 'Enter') router.push(withProjectScope(`/documents/${doc.id}`, activeProjectId)); }}
                className={`group w-full text-left rounded-md px-2.5 py-2 transition-colors hover:bg-accent cursor-pointer ${
                  activeId === doc.id ? 'bg-accent' : ''
                }`}
              >
                <div className="flex items-start gap-2 min-w-0">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mb-0.5">
                      <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${STATUS_DOT_COLORS[doc.status]}`} />
                      <span>{STATUS_LABELS[doc.status]}</span>
                      <span className="text-muted-foreground/40">·</span>
                      <span className="tabular-nums">{doc.wordCount || 0}w</span>
                    </div>
                    <p className="text-sm font-medium leading-5 line-clamp-2 break-words [overflow-wrap:anywhere]">
                      {doc.title}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => handleDelete(doc.id, e)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleDelete(doc.id, e); }}
                    className="opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity p-0.5 rounded hover:bg-red-500/20 hover:text-red-400 text-muted-foreground cursor-pointer shrink-0 mt-0.5"
                    title="Delete document"
                    aria-label="Delete document"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
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
      </div>

      <div className="shrink-0 border-t border-border bg-card p-2 space-y-0">
        <Link
          href={withProjectScope('/mission-control', activeProjectId)}
          className="flex items-center gap-2 px-3 py-1.5 rounded-md text-sm text-muted-foreground hover:bg-accent/50 hover:text-foreground transition-colors"
        >
          <Kanban className="h-4 w-4" />
          Mission Control
        </Link>
        <Link
          href={withProjectScope('/review', activeProjectId)}
          className="flex items-center gap-2 px-3 py-1.5 rounded-md text-sm text-muted-foreground hover:bg-accent/50 hover:text-foreground transition-colors"
        >
          <Eye className="h-4 w-4" />
          Review
        </Link>
        <Link
          href={withProjectScope('/keywords', activeProjectId)}
          className="flex items-center gap-2 px-3 py-1.5 rounded-md text-sm text-muted-foreground hover:bg-accent/50 hover:text-foreground transition-colors"
        >
          <Search className="h-4 w-4" />
          Keywords
        </Link>
        <Link
          href={withProjectScope('/pages', activeProjectId)}
          className="flex items-center gap-2 px-3 py-1.5 rounded-md text-sm text-muted-foreground hover:bg-accent/50 hover:text-foreground transition-colors"
        >
          <Globe className="h-4 w-4" />
          Pages
        </Link>
        {user?.role === 'client' && (
          <Link
            href={withProjectScope('/client/dashboard', activeProjectId)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-md text-sm text-muted-foreground hover:bg-accent/50 hover:text-foreground transition-colors"
          >
            <LayoutDashboard className="h-4 w-4" />
            Dashboard
          </Link>
        )}
        {user?.role && hasRole(user.role, 'admin') && (
          <Link
            href={withProjectScope('/admin', activeProjectId)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-md text-sm text-muted-foreground hover:bg-accent/50 hover:text-foreground transition-colors"
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
