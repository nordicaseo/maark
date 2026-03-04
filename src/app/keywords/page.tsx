'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Loader2, Plus, Sparkles, Target } from 'lucide-react';
import { useAuth } from '@/components/auth/auth-provider';
import { ProjectSwitcher } from '@/components/projects/project-switcher';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useActiveProject } from '@/hooks/use-active-project';
import { useProjectScopeSync } from '@/hooks/use-project-scope-sync';
import { withProjectScope } from '@/lib/project-context';
import type { Keyword, KeywordIntent, KeywordPriority, KeywordStatus } from '@/types/keyword';
import { KEYWORD_INTENT_LABELS, KEYWORD_STATUS_LABELS } from '@/types/keyword';

const STATUS_OPTIONS: KeywordStatus[] = [
  'new',
  'planned',
  'in_progress',
  'content_created',
  'published',
  'archived',
];

const PRIORITY_OPTIONS: KeywordPriority[] = ['low', 'medium', 'high'];
const INTENT_OPTIONS: KeywordIntent[] = ['informational', 'commercial', 'transactional', 'navigational', 'local'];

function statusClass(status: KeywordStatus): string {
  if (status === 'published') return 'bg-green-500/15 text-green-400';
  if (status === 'content_created') return 'bg-blue-500/15 text-blue-400';
  if (status === 'in_progress') return 'bg-yellow-500/15 text-yellow-400';
  if (status === 'planned') return 'bg-purple-500/15 text-purple-400';
  if (status === 'archived') return 'bg-zinc-500/15 text-zinc-400';
  return 'bg-zinc-500/15 text-zinc-300';
}

export default function KeywordsPage() {
  const { user, isLoading: authLoading } = useAuth();
  const router = useRouter();
  const { activeProjectId, setActiveProjectId } = useActiveProject();
  useProjectScopeSync(activeProjectId, setActiveProjectId);
  const [keywords, setKeywords] = useState<Keyword[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [taskBusyId, setTaskBusyId] = useState<number | null>(null);
  const [newKeyword, setNewKeyword] = useState('');
  const [newIntent, setNewIntent] = useState<KeywordIntent>('informational');
  const [newPriority, setNewPriority] = useState<KeywordPriority>('medium');
  const [newVolume, setNewVolume] = useState('');

  const canCreate = useMemo(() => newKeyword.trim().length > 0 && !!activeProjectId, [newKeyword, activeProjectId]);

  useEffect(() => {
    if (!authLoading && !user) {
      router.replace('/auth/signin');
    }
  }, [authLoading, user, router]);

  const fetchKeywords = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (activeProjectId) params.set('projectId', String(activeProjectId));
      const res = await fetch(`/api/keywords?${params.toString()}`);
      if (res.ok) {
        setKeywords(await res.json());
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!authLoading && user) {
      void fetchKeywords();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, user, activeProjectId]);

  if (authLoading || !user) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const handleCreate = async () => {
    if (!canCreate) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/keywords', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: activeProjectId,
          keyword: newKeyword.trim(),
          intent: newIntent,
          priority: newPriority,
          volume: newVolume ? Number.parseInt(newVolume, 10) : null,
        }),
      });
      if (res.ok) {
        setNewKeyword('');
        setNewVolume('');
        await fetchKeywords();
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleStatusChange = async (keyword: Keyword, status: KeywordStatus) => {
    await fetch(`/api/keywords/${keyword.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    await fetchKeywords();
  };

  const handleCreateTask = async (keyword: Keyword) => {
    setTaskBusyId(keyword.id);
    try {
      const res = await fetch(`/api/keywords/${keyword.id}/create-task`, { method: 'POST' });
      if (res.ok) {
        await fetchKeywords();
      }
    } finally {
      setTaskBusyId(null);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="max-w-6xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-4 min-w-0">
              <Link
                href={withProjectScope('/documents', activeProjectId)}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <ArrowLeft className="h-5 w-5" />
              </Link>
              <div className="min-w-0">
                <h1 className="text-xl font-bold flex items-center gap-2">
                  <Target className="h-5 w-5" /> Keyword Universe
                </h1>
                <p className="text-sm text-muted-foreground">
                  Track keywords and create Mission Control content tasks directly.
                </p>
              </div>
            </div>
            <div className="w-56">
              <ProjectSwitcher activeProjectId={activeProjectId} onProjectChange={setActiveProjectId} />
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-6 space-y-5">
        <section className="border border-border rounded-lg p-4 bg-card">
          <h2 className="text-sm font-semibold mb-3">Add Keyword</h2>
          <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
            <Input
              placeholder="Keyword"
              value={newKeyword}
              onChange={(e) => setNewKeyword(e.target.value)}
              className="md:col-span-2"
            />
            <Select value={newIntent} onValueChange={(v) => setNewIntent(v as KeywordIntent)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {INTENT_OPTIONS.map((intent) => (
                  <SelectItem key={intent} value={intent}>
                    {KEYWORD_INTENT_LABELS[intent]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={newPriority} onValueChange={(v) => setNewPriority(v as KeywordPriority)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PRIORITY_OPTIONS.map((priority) => (
                  <SelectItem key={priority} value={priority}>
                    {priority[0].toUpperCase() + priority.slice(1)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              placeholder="Volume"
              type="number"
              value={newVolume}
              onChange={(e) => setNewVolume(e.target.value)}
            />
          </div>
          <div className="mt-3">
            <Button onClick={handleCreate} disabled={submitting || !canCreate}>
              {submitting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Plus className="h-4 w-4 mr-2" />}
              Add Keyword
            </Button>
            {!activeProjectId && (
              <span className="text-xs text-muted-foreground ml-3">
                Select a project first to create keywords.
              </span>
            )}
          </div>
        </section>

        <section className="border border-border rounded-lg bg-card overflow-hidden">
          <div className="px-4 py-3 border-b border-border text-sm font-semibold">
            Keywords ({keywords.length})
          </div>
          {loading ? (
            <div className="py-12 flex items-center justify-center text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : keywords.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              No keywords yet for this scope.
            </div>
          ) : (
            <div className="divide-y divide-border">
              {keywords.map((keyword) => (
                <div key={keyword.id} className="px-4 py-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                  <div className="min-w-0">
                    <p className="font-medium truncate">{keyword.keyword}</p>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5 flex-wrap">
                      <span>{KEYWORD_INTENT_LABELS[keyword.intent as KeywordIntent] || keyword.intent}</span>
                      <span>Vol {keyword.volume ?? '—'}</span>
                      <span>KD {keyword.difficulty ?? '—'}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="secondary" className={statusClass(keyword.status as KeywordStatus)}>
                      {KEYWORD_STATUS_LABELS[keyword.status as KeywordStatus] || keyword.status}
                    </Badge>
                    <Select
                      value={keyword.status}
                      onValueChange={(status) => void handleStatusChange(keyword, status as KeywordStatus)}
                    >
                      <SelectTrigger className="h-8 w-[140px] text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {STATUS_OPTIONS.map((status) => (
                          <SelectItem key={status} value={status}>
                            {KEYWORD_STATUS_LABELS[status]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8"
                      onClick={() => void handleCreateTask(keyword)}
                      disabled={taskBusyId === keyword.id}
                    >
                      {taskBusyId === keyword.id ? (
                        <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                      ) : (
                        <Sparkles className="h-3.5 w-3.5 mr-1" />
                      )}
                      Create Task
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
