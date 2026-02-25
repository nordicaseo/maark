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
import { Plus, FileText, Trash2 } from 'lucide-react';
import { CreateDialog } from './create-dialog';
import type { Document, DocumentStatus } from '@/types/document';
import { CONTENT_TYPE_LABELS, STATUS_LABELS } from '@/types/document';

interface DocumentListProps {
  documents: Document[];
  activeId?: number;
  onRefresh: () => void;
}

const statusColors: Record<DocumentStatus, string> = {
  draft: 'bg-zinc-500/20 text-zinc-400',
  in_progress: 'bg-blue-500/20 text-blue-400',
  review: 'bg-yellow-500/20 text-yellow-400',
  published: 'bg-green-500/20 text-green-400',
};

function ScoreDot({ score, max = 5 }: { score: number | null; max?: number }) {
  if (score === null) return <span className="w-2 h-2 rounded-full bg-zinc-700" />;
  const ratio = max === 5 ? (5 - score) / 4 : score / max;
  const color =
    ratio > 0.66
      ? 'bg-green-500'
      : ratio > 0.33
        ? 'bg-yellow-500'
        : 'bg-red-500';
  return <span className={`w-2 h-2 rounded-full ${color}`} />;
}

export function DocumentList({ documents, activeId, onRefresh }: DocumentListProps) {
  const router = useRouter();
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
                  <div className="flex items-center gap-2 mt-1">
                    <Badge
                      variant="secondary"
                      className={`text-[10px] px-1.5 py-0 ${statusColors[doc.status]}`}
                    >
                      {STATUS_LABELS[doc.status]}
                    </Badge>
                    <span className="text-[10px] text-muted-foreground">
                      {doc.wordCount || 0}w
                    </span>
                    <div className="flex gap-1 ml-auto">
                      <ScoreDot score={doc.aiDetectionScore} max={5} />
                      <ScoreDot score={doc.semanticScore} max={100} />
                      <ScoreDot score={doc.contentQualityScore} max={100} />
                    </div>
                  </div>
                </div>
                <div
                  role="button"
                  tabIndex={0}
                  onClick={(e) => handleDelete(doc.id, e)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleDelete(doc.id, e as any); }}
                  className="opacity-0 group-hover:opacity-100 transition-opacity h-6 w-6 flex items-center justify-center hover:text-red-400 cursor-pointer"
                >
                  <Trash2 className="h-3 w-3" />
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

      <CreateDialog open={showCreate} onOpenChange={setShowCreate} onCreated={onRefresh} />
    </div>
  );
}
