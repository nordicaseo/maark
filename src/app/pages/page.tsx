'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  AlertCircle,
  ArrowLeft,
  Circle,
  FileText,
  Globe,
  Loader2,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { useAuth } from '@/components/auth/auth-provider';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useActiveProject } from '@/hooks/use-active-project';
import { useProjectScopeSync } from '@/hooks/use-project-scope-sync';
import { withProjectScope } from '@/lib/project-context';
import type { DiscoveryUrlRecord, ManagedPage, PageDataHealth } from '@/types/page';
import { OperationsSidebar } from '@/components/layout/operations-sidebar';

type PagesViewMode = 'inventory' | 'discovery';

const DISCOVERY_SOURCES = ['all', 'sitemap', 'gsc', 'inventory', 'crawl'] as const;
const DISCOVERY_REASON_OPTIONS = [
  'all',
  'query_variant',
  'faceted_variant',
  'legal_page',
  'contact_page',
  'system_page',
  'search_page',
  'cart_or_account',
  'category_or_tag',
  'non_canonical',
  'non_indexable',
  'non_200',
  'blocked_by_rule',
  'invalid_url',
] as const;

function boolBadge(value: number | null | undefined, trueLabel: string, falseLabel: string) {
  const on = value === 1;
  return (
    <Badge
      variant="secondary"
      className={on ? 'bg-green-500/15 text-green-500' : 'bg-red-500/15 text-red-500'}
    >
      {on ? trueLabel : falseLabel}
    </Badge>
  );
}

function sourceLabel(source: string) {
  if (source === 'gsc') return 'GSC';
  if (source === 'sitemap') return 'Sitemap';
  if (source === 'inventory') return 'Inventory';
  if (source === 'crawl') return 'Crawl';
  return source;
}

function formatReason(reason: string | null | undefined) {
  if (!reason) return 'None';
  return reason.replace(/_/g, ' ');
}

export default function PagesPage() {
  const { user, isLoading: authLoading } = useAuth();
  const router = useRouter();
  const { activeProjectId, setActiveProjectId } = useActiveProject();
  useProjectScopeSync(activeProjectId, setActiveProjectId);

  const [pages, setPages] = useState<ManagedPage[]>([]);
  const [discoveryRows, setDiscoveryRows] = useState<DiscoveryUrlRecord[]>([]);
  const [viewMode, setViewMode] = useState<PagesViewMode>('inventory');
  const [discoverySource, setDiscoverySource] = useState<(typeof DISCOVERY_SOURCES)[number]>('all');
  const [discoveryReason, setDiscoveryReason] = useState<(typeof DISCOVERY_REASON_OPTIONS)[number]>('all');

  const [loading, setLoading] = useState(true);
  const [loadingDiscovery, setLoadingDiscovery] = useState(false);
  const [newUrl, setNewUrl] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [crawlingId, setCrawlingId] = useState<number | null>(null);
  const [topicBusyId, setTopicBusyId] = useState<number | null>(null);
  const [runningDiscovery, setRunningDiscovery] = useState(false);
  const [reconciling, setReconciling] = useState(false);
  const [health, setHealth] = useState<PageDataHealth | null>(null);

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

  const fetchDiscovery = async () => {
    setLoadingDiscovery(true);
    try {
      const params = new URLSearchParams();
      if (activeProjectId) params.set('projectId', String(activeProjectId));
      if (discoverySource !== 'all') params.set('source', discoverySource);
      if (discoveryReason !== 'all') params.set('excludeReason', discoveryReason);

      const res = await fetch(`/api/pages/discovery?${params.toString()}`);
      if (res.ok) {
        setDiscoveryRows(await res.json());
      }
    } finally {
      setLoadingDiscovery(false);
    }
  };

  const fetchHealth = async () => {
    if (!activeProjectId) {
      setHealth(null);
      return;
    }
    try {
      const res = await fetch(`/api/pages/health?projectId=${activeProjectId}`);
      if (res.ok) {
        setHealth(await res.json());
      }
    } catch {
      setHealth(null);
    }
  };

  useEffect(() => {
    if (!authLoading && user) {
      void fetchPages();
      void fetchHealth();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, user, activeProjectId]);

  useEffect(() => {
    if (!authLoading && user && viewMode === 'discovery') {
      void fetchDiscovery();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, user, activeProjectId, viewMode, discoverySource, discoveryReason]);

  const discoveryStats = useMemo(() => {
    let candidates = 0;
    let excluded = 0;
    for (const row of discoveryRows) {
      if (row.isCandidate === 1) candidates += 1;
      else excluded += 1;
    }
    return {
      total: discoveryRows.length,
      candidates,
      excluded,
    };
  }, [discoveryRows]);

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
    setNotice(null);
    try {
      const res = await fetch('/api/pages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: activeProjectId, url: newUrl.trim() }),
      });
      const payload = await res.json().catch(() => null);

      if (res.status === 202 && payload?.excluded) {
        setNotice(`URL excluded from optimization inventory (${formatReason(payload.reason)}).`);
      } else if (res.ok) {
        setNotice('Page added to optimization inventory.');
        setNewUrl('');
      } else {
        setNotice(payload?.error || 'Failed to add page.');
      }

      await fetchPages();
      await fetchHealth();
      if (viewMode === 'discovery') await fetchDiscovery();
    } finally {
      setSaving(false);
    }
  };

  const handleCrawl = async (pageId: number) => {
    setCrawlingId(pageId);
    setNotice(null);
    try {
      const res = await fetch('/api/pages/crawl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageId, processImmediately: true }),
      });
      const payload = await res.json().catch(() => null);
      if (res.ok) {
        if (payload?.state === 'queued') {
          setNotice('Crawl queued for retry.');
        } else {
          setNotice('Crawl completed.');
        }
      } else {
        setNotice(payload?.detail || payload?.error || 'Crawl failed.');
      }
      await fetchPages();
      await fetchHealth();
      if (viewMode === 'discovery') await fetchDiscovery();
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

  const handleRunDiscovery = async () => {
    if (!activeProjectId) return;
    setRunningDiscovery(true);
    setNotice(null);
    try {
      const res = await fetch('/api/discovery/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: activeProjectId,
          includeInventory: true,
          gscTopPagesLimit: 2000,
        }),
      });
      const payload = await res.json().catch(() => null);
      if (res.ok) {
        setNotice(`Discovery completed: ${payload?.totals?.discovered ?? 0} URLs scanned.`);
        await fetchPages();
        await fetchHealth();
        if (viewMode === 'discovery') await fetchDiscovery();
      } else {
        setNotice(payload?.error || 'Discovery failed.');
      }
    } finally {
      setRunningDiscovery(false);
    }
  };

  const handleReconcile = async () => {
    if (!activeProjectId) return;
    setReconciling(true);
    setNotice(null);
    try {
      const res = await fetch('/api/pages/reconcile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: activeProjectId }),
      });
      const payload = await res.json().catch(() => null);
      if (res.ok) {
        setNotice(`Reconciliation complete: ${payload?.retired ?? 0} pages retired.`);
        await fetchPages();
        await fetchHealth();
        if (viewMode === 'discovery') await fetchDiscovery();
      } else {
        setNotice(payload?.error || 'Reconciliation failed.');
      }
    } finally {
      setReconciling(false);
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
                    Optimization inventory with discovery ledger for excluded/non-indexable URLs.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="hidden sm:flex items-center gap-2 mr-2">
                  <Badge variant="secondary" className="flex items-center gap-1.5">
                    <Circle
                      className={`h-2.5 w-2.5 fill-current ${
                        health?.gsc?.healthy ? 'text-green-500' : 'text-amber-500'
                      }`}
                    />
                    GSC
                  </Badge>
                  <Badge variant="secondary" className="flex items-center gap-1.5">
                    <Circle
                      className={`h-2.5 w-2.5 fill-current ${
                        health?.crawl?.healthy ? 'text-green-500' : 'text-amber-500'
                      }`}
                    />
                    Crawl
                  </Badge>
                </div>
                <Button
                  variant={viewMode === 'inventory' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setViewMode('inventory')}
                >
                  Inventory
                </Button>
                <Button
                  variant={viewMode === 'discovery' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setViewMode('discovery')}
                >
                  Discovery / Excluded
                </Button>
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
            {notice && (
              <div className="mt-3 text-xs rounded-md border border-border bg-muted/40 px-3 py-2 flex items-center gap-2">
                <AlertCircle className="h-3.5 w-3.5 text-amber-500" />
                <span>{notice}</span>
              </div>
            )}
          </section>

          <section className="border border-border rounded-lg bg-card overflow-hidden">
            <div className="px-4 py-3 border-b border-border flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm font-semibold">
                {viewMode === 'inventory' ? `Pages (${pages.length})` : `Discovery URLs (${discoveryStats.total})`}
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void handleRunDiscovery()}
                  disabled={!activeProjectId || runningDiscovery}
                >
                  {runningDiscovery ? (
                    <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                  ) : (
                    <Sparkles className="h-3.5 w-3.5 mr-1" />
                  )}
                  Run Discovery
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void handleReconcile()}
                  disabled={!activeProjectId || reconciling}
                >
                  {reconciling ? (
                    <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5 mr-1" />
                  )}
                  Reconcile
                </Button>
              </div>
            </div>

            {viewMode === 'inventory' ? (
              loading ? (
                <div className="py-12 flex items-center justify-center text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin" />
                </div>
              ) : pages.length === 0 ? (
                <div className="py-12 text-center text-sm text-muted-foreground">
                  No tracked optimization pages in this scope.
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
                            {` ${page.openIssues ?? 0} open issues`} ·
                            {` ${page.linkedDocumentCount ?? 0} linked docs`}
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
                        <Badge variant="secondary" className="bg-blue-500/15 text-blue-500">
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
              )
            ) : (
              <div className="space-y-3">
                <div className="px-4 pt-3 pb-1 flex items-center gap-2 flex-wrap">
                  <Badge variant="secondary" className="bg-green-500/15 text-green-500">
                    Eligible {discoveryStats.candidates}
                  </Badge>
                  <Badge variant="secondary" className="bg-amber-500/15 text-amber-600">
                    Excluded {discoveryStats.excluded}
                  </Badge>
                </div>

                <div className="px-4 pb-2 flex items-center gap-2 flex-wrap">
                  {DISCOVERY_SOURCES.map((source) => (
                    <Button
                      key={source}
                      size="sm"
                      variant={discoverySource === source ? 'default' : 'outline'}
                      onClick={() => setDiscoverySource(source)}
                    >
                      {source === 'all' ? 'All Sources' : sourceLabel(source)}
                    </Button>
                  ))}
                </div>

                <div className="px-4 pb-3 flex items-center gap-2 flex-wrap border-b border-border">
                  {DISCOVERY_REASON_OPTIONS.map((reason) => (
                    <Button
                      key={reason}
                      size="sm"
                      variant={discoveryReason === reason ? 'default' : 'outline'}
                      onClick={() => setDiscoveryReason(reason)}
                    >
                      {reason === 'all' ? 'All Reasons' : formatReason(reason)}
                    </Button>
                  ))}
                </div>

                {loadingDiscovery ? (
                  <div className="py-12 flex items-center justify-center text-muted-foreground">
                    <Loader2 className="h-5 w-5 animate-spin" />
                  </div>
                ) : discoveryRows.length === 0 ? (
                  <div className="py-12 text-center text-sm text-muted-foreground">
                    No discovery records for this filter/scope.
                  </div>
                ) : (
                  <div className="divide-y divide-border">
                    {discoveryRows.map((row) => (
                      <div key={row.id} className="px-4 py-3 space-y-2">
                        <div className="flex items-center justify-between gap-3">
                          <a
                            href={row.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="min-w-0 font-medium hover:underline truncate"
                          >
                            {row.url}
                          </a>
                          <div className="flex items-center gap-2 shrink-0">
                            <Badge variant="secondary">{sourceLabel(row.source)}</Badge>
                            {row.isCandidate === 1 ? (
                              <Badge variant="secondary" className="bg-green-500/15 text-green-500">
                                Candidate
                              </Badge>
                            ) : (
                              <Badge variant="secondary" className="bg-red-500/15 text-red-500">
                                Excluded
                              </Badge>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-wrap text-xs text-muted-foreground">
                          <span>Reason: {formatReason(row.excludeReason)}</span>
                          <span>•</span>
                          <span>HTTP {row.httpStatus ?? '—'}</span>
                          <span>•</span>
                          <span>Robots {row.robots || '—'}</span>
                          <span>•</span>
                          <span>Last seen {new Date(row.lastSeenAt).toLocaleString()}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </section>
        </main>
      </div>
    </div>
  );
}
