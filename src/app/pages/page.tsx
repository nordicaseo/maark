'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, FileText, Globe, Loader2, RefreshCw, Search, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/components/auth/auth-provider';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useActiveProject } from '@/hooks/use-active-project';
import { useProjectScopeSync } from '@/hooks/use-project-scope-sync';
import { withProjectScope } from '@/lib/project-context';
import type { ManagedPage } from '@/types/page';
import { OperationsSidebar } from '@/components/layout/operations-sidebar';

function boolBadge(value: number | null | undefined, trueLabel: string, falseLabel: string) {
  const on = value === 1;
  return (
    <Badge
      variant="secondary"
      className={on ? 'bg-green-500/15 text-green-400' : 'bg-red-500/15 text-red-400'}
    >
      {on ? trueLabel : falseLabel}
    </Badge>
  );
}

export default function PagesPage() {
  const { user, isLoading: authLoading } = useAuth();
  const router = useRouter();
  const { activeProjectId, setActiveProjectId } = useActiveProject();
  useProjectScopeSync(activeProjectId, setActiveProjectId);
  const [pages, setPages] = useState<ManagedPage[]>([]);
  const [loading, setLoading] = useState(true);
  const [newUrl, setNewUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [crawlingId, setCrawlingId] = useState<number | null>(null);
  const [topicBusyId, setTopicBusyId] = useState<number | null>(null);

  useEffect(() => {
    if (!authLoading && !user) {
      router.replace('/auth/signin');
    }
  }, [authLoading, user, router]);

  const fetchPages = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (activeProjectId) params.set('projectId', String(activeProjectId));
      const res = await fetch(`/api/pages?${params.toString()}`);
      if (res.ok) {
        setPages(await res.json());
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!authLoading && user) {
      void fetchPages();
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

  const handleAddPage = async () => {
    if (!activeProjectId || !newUrl.trim()) return;
    setSaving(true);
    try {
      const res = await fetch('/api/pages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: activeProjectId, url: newUrl.trim() }),
      });
      if (res.ok) {
        setNewUrl('');
        await fetchPages();
      }
    } finally {
      setSaving(false);
    }
  };

  const handleCrawl = async (pageId: number) => {
    setCrawlingId(pageId);
    try {
      await fetch('/api/pages/crawl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageId }),
      });
      await fetchPages();
    } finally {
      setCrawlingId(null);
    }
  };

  const handleCreateTopic = async (pageId: number) => {
    setTopicBusyId(pageId);
    try {
      const res = await fetch(`/api/pages/${pageId}/create-topic`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (res.ok) {
        const created = await res.json();
        if (created?.taskId) {
          void fetch('/api/topic-workflow/run', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              taskId: created.taskId,
              autoContinue: true,
              maxStages: 6,
            }),
          }).catch((err) => {
            console.error('Auto-run topic workflow failed:', err);
          });
        }
        await fetchPages();
      }
    } finally {
      setTopicBusyId(null);
    }
  };

  return (
    <div className="min-h-screen bg-background flex">
      <OperationsSidebar
        activeProjectId={activeProjectId}
        onProjectChange={setActiveProjectId}
      />

      <div className="flex-1 min-w-0">
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
                  <Globe className="h-5 w-5" /> Pages & Crawler
                </h1>
                <p className="text-sm text-muted-foreground">
                  Crawl canonical/indexable pages and track issues over time.
                </p>
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-6 space-y-5">
        <section className="border border-border rounded-lg p-4 bg-card">
          <h2 className="text-sm font-semibold mb-3">Add Page</h2>
          <div className="flex gap-3">
            <Input
              placeholder="https://example.com/page"
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
            />
            <Button onClick={handleAddPage} disabled={!activeProjectId || !newUrl.trim() || saving}>
              {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Search className="h-4 w-4 mr-2" />}
              Add
            </Button>
          </div>
          {!activeProjectId && (
            <p className="text-xs text-muted-foreground mt-2">Select a project first to manage pages.</p>
          )}
        </section>

        <section className="border border-border rounded-lg bg-card overflow-hidden">
          <div className="px-4 py-3 border-b border-border text-sm font-semibold">
            Pages ({pages.length})
          </div>
          {loading ? (
            <div className="py-12 flex items-center justify-center text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : pages.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              No tracked pages in this scope.
            </div>
          ) : (
            <div className="divide-y divide-border">
              {pages.map((page) => (
                <div key={page.id} className="px-4 py-3 space-y-2">
                  <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <a
                        href={page.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium hover:underline truncate block"
                      >
                        {page.url}
                      </a>
                      <p className="text-xs text-muted-foreground truncate">
                        {page.title || 'Untitled page'} · HTTP {page.httpStatus ?? '—'} ·
                        {` ${page.responseTimeMs ?? '—'}ms`} ·
                        {` ${page.openIssues ?? 0} open issues`}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void handleCreateTopic(page.id)}
                        disabled={topicBusyId === page.id}
                      >
                        {topicBusyId === page.id ? (
                          <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                        ) : (
                          <FileText className="h-3.5 w-3.5 mr-1" />
                        )}
                        Create Topic
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void handleCrawl(page.id)}
                        disabled={crawlingId === page.id}
                      >
                        {crawlingId === page.id ? (
                          <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                        ) : (
                          <RefreshCw className="h-3.5 w-3.5 mr-1" />
                        )}
                        Crawl
                      </Button>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    {boolBadge(page.isVerified, 'Verified', 'Not Verified')}
                    {boolBadge(page.isIndexable, 'Indexable', 'Not Indexable')}
                    <Badge variant="secondary" className="bg-blue-500/15 text-blue-400">
                      <ShieldCheck className="h-3 w-3 mr-1" />
                      Canonical {page.canonicalUrl ? 'Set' : 'Missing'}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      Last crawl: {page.lastCrawledAt ? new Date(page.lastCrawledAt).toLocaleString() : 'Never'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
      </div>
    </div>
  );
}
