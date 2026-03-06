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
  X,
} from 'lucide-react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useAuth } from '@/components/auth/auth-provider';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useActiveProject } from '@/hooks/use-active-project';
import { useProjectScopeSync } from '@/hooks/use-project-scope-sync';
import { withProjectScope } from '@/lib/project-context';
import { triggerTopicWorkflowRun } from '@/lib/topic-workflow-client';
import type {
  PageArtifactRecord,
  DiscoveryUrlRecord,
  ManagedPage,
  PageDataHealth,
  PageKeywordMappingRecord,
  PagePerformancePoint,
  PageTaskAnnotation,
} from '@/types/page';
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

interface PageInsightsResponse {
  page: {
    id: number;
    url: string;
    title: string | null;
    projectId: number;
  };
  performance: PagePerformancePoint[];
  annotations: PageTaskAnnotation[];
  keywordMappings: PageKeywordMappingRecord[];
  linkedDocuments: Array<{
    documentId: number;
    title: string;
    status: string;
    relationType: string;
    previewUrl: string;
  }>;
}

interface PageKeywordOption {
  id: number;
  keyword: string;
  status: string;
  volume: number | null;
  difficulty: number | null;
}

interface PageKeywordsResponse {
  primaryKeywordId: number | null;
  mappings: Array<{
    keywordId: number;
    mappingType: 'primary' | 'secondary';
  }>;
  availableKeywords: PageKeywordOption[];
}

interface PageArtifactsResponse {
  pageId: number;
  snapshotId: number | null;
  artifacts: PageArtifactRecord[];
  jobs: Array<{
    id: number;
    snapshotId: number;
    action: string;
    state: string;
    attempts: number;
    maxAttempts: number;
    nextAttemptAt: string | null;
    lastError: string | null;
    updatedAt: string | null;
  }>;
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
  const [detailPageId, setDetailPageId] = useState<number | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailData, setDetailData] = useState<PageInsightsResponse | null>(null);
  const [keywordData, setKeywordData] = useState<PageKeywordsResponse | null>(null);
  const [artifactData, setArtifactData] = useState<PageArtifactsResponse | null>(null);
  const [artifactBusyAction, setArtifactBusyAction] = useState<string | null>(null);
  const [keywordSearch, setKeywordSearch] = useState('');
  const [primaryKeywordId, setPrimaryKeywordId] = useState<number | null>(null);
  const [secondaryKeywordIds, setSecondaryKeywordIds] = useState<number[]>([]);
  const [savingKeywords, setSavingKeywords] = useState(false);

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

  useEffect(() => {
    setDetailPageId(null);
    setDetailData(null);
    setKeywordData(null);
    setDetailError(null);
    setKeywordSearch('');
    setPrimaryKeywordId(null);
    setSecondaryKeywordIds([]);
  }, [activeProjectId]);

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
          triggerTopicWorkflowRun(created.taskId, {
            autoContinue: true,
            maxStages: 6,
            logLabel: 'topic workflow',
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

  const loadPageDetails = async (pageId: number) => {
    setDetailLoading(true);
    setDetailError(null);
    try {
      const [insightsRes, keywordsRes, artifactsRes] = await Promise.all([
        fetch(`/api/pages/${pageId}/insights?days=180`),
        fetch(`/api/pages/${pageId}/keywords?limit=500`),
        fetch(`/api/pages/${pageId}/artifacts?limit=40`),
      ]);

      const insightsPayload = await insightsRes.json().catch(() => null);
      const keywordsPayload = await keywordsRes.json().catch(() => null);
      const artifactsPayload = await artifactsRes.json().catch(() => null);

      if (!insightsRes.ok) {
        setDetailError(insightsPayload?.error || 'Failed to load page insights.');
        setDetailData(null);
        setKeywordData(null);
        setArtifactData(null);
        return;
      }

      setDetailData(insightsPayload as PageInsightsResponse);

      if (keywordsRes.ok) {
        const keywordResponse = keywordsPayload as PageKeywordsResponse;
        setKeywordData(keywordResponse);
        const nextPrimary =
          keywordResponse.primaryKeywordId ??
          keywordResponse.mappings.find((entry) => entry.mappingType === 'primary')?.keywordId ??
          null;
        setPrimaryKeywordId(nextPrimary);
        setSecondaryKeywordIds(
          keywordResponse.mappings
            .filter((entry) => entry.mappingType === 'secondary')
            .map((entry) => entry.keywordId)
        );
      } else {
        setKeywordData(null);
      }

      if (artifactsRes.ok && artifactsPayload && typeof artifactsPayload === 'object') {
        setArtifactData(artifactsPayload as PageArtifactsResponse);
      } else {
        setArtifactData(null);
      }
    } finally {
      setDetailLoading(false);
    }
  };

  const handleOpenDetails = async (pageId: number) => {
    setDetailPageId(pageId);
    setKeywordSearch('');
    await loadPageDetails(pageId);
  };

  const handleCloseDetails = () => {
    setDetailPageId(null);
    setDetailData(null);
    setKeywordData(null);
    setArtifactData(null);
    setDetailError(null);
    setKeywordSearch('');
    setPrimaryKeywordId(null);
    setSecondaryKeywordIds([]);
  };

  const handleArtifactAction = async (action: 'reclean' | 'regrade' | 'reprocess') => {
    if (!detailPageId) return;
    setArtifactBusyAction(action);
    setNotice(null);
    try {
      const res = await fetch(`/api/pages/${detailPageId}/artifacts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          processNow: true,
        }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        setNotice(payload?.error || `Failed to ${action} artifacts.`);
        return;
      }
      if (payload?.success) {
        setNotice(`${action} queued and processed.`);
      } else {
        setNotice(
          payload?.processed?.message ||
            payload?.processed?.state ||
            `${action} queued but not completed.`
        );
      }
      await loadPageDetails(detailPageId);
      await fetchHealth();
    } finally {
      setArtifactBusyAction(null);
    }
  };

  const toggleSecondaryKeyword = (keywordId: number) => {
    setSecondaryKeywordIds((current) => {
      if (current.includes(keywordId)) {
        return current.filter((id) => id !== keywordId);
      }
      return [...current, keywordId];
    });
  };

  const handleSaveKeywordMappings = async () => {
    if (!detailPageId) return;
    setSavingKeywords(true);
    setNotice(null);
    try {
      const res = await fetch(`/api/pages/${detailPageId}/keywords`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          primaryKeywordId,
          secondaryKeywordIds: secondaryKeywordIds.filter((id) => id !== primaryKeywordId),
        }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        setNotice(payload?.error || 'Failed to save page keyword mappings.');
        return;
      }
      setNotice('Page keyword mappings updated.');
      await loadPageDetails(detailPageId);
    } finally {
      setSavingKeywords(false);
    }
  };

  const filteredKeywordOptions = useMemo(() => {
    const options = keywordData?.availableKeywords || [];
    if (!keywordSearch.trim()) return options.slice(0, 80);
    const query = keywordSearch.trim().toLowerCase();
    return options
      .filter((option) => option.keyword.toLowerCase().includes(query))
      .slice(0, 80);
  }, [keywordData?.availableKeywords, keywordSearch]);

  if (authLoading || !user) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

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
                  <Badge variant="secondary" className="flex items-center gap-1.5">
                    <Circle
                      className={`h-2.5 w-2.5 fill-current ${
                        health?.artifacts?.healthy ? 'text-green-500' : 'text-amber-500'
                      }`}
                    />
                    Artifacts
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
                            onClick={() => void handleOpenDetails(page.id)}
                          >
                            Details
                          </Button>
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

      {detailPageId !== null && (
        <>
          <button
            type="button"
            aria-label="Close details panel"
            className="fixed inset-0 z-40 bg-black/20"
            onClick={handleCloseDetails}
          />
          <aside className="fixed inset-y-0 right-0 z-50 w-full max-w-xl border-l border-border bg-card shadow-xl overflow-y-auto">
            <div className="p-4 border-b border-border flex items-center justify-between gap-2">
              <div className="min-w-0">
                <h3 className="font-semibold truncate">
                  {detailData?.page.title || detailData?.page.url || 'Page Details'}
                </h3>
                <p className="text-xs text-muted-foreground truncate">
                  {detailData?.page.url || 'Loading...'}
                </p>
              </div>
              <Button size="icon" variant="ghost" onClick={handleCloseDetails}>
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="p-4 space-y-6">
              {detailLoading ? (
                <div className="py-12 flex items-center justify-center text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin" />
                </div>
              ) : detailError ? (
                <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700">
                  {detailError}
                </div>
              ) : detailData ? (
                <>
                  <section className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <h4 className="text-sm font-semibold">Artifacts</h4>
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void handleArtifactAction('reclean')}
                          disabled={artifactBusyAction !== null}
                        >
                          {artifactBusyAction === 'reclean' ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : null}
                          Reclean
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void handleArtifactAction('regrade')}
                          disabled={artifactBusyAction !== null}
                        >
                          {artifactBusyAction === 'regrade' ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : null}
                          Regrade
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void handleArtifactAction('reprocess')}
                          disabled={artifactBusyAction !== null}
                        >
                          {artifactBusyAction === 'reprocess' ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : null}
                          Reprocess snapshot
                        </Button>
                      </div>
                    </div>
                    {artifactData?.artifacts?.length ? (
                      <div className="space-y-2">
                        {artifactData.artifacts.slice(0, 8).map((artifact) => (
                          <div key={artifact.id} className="rounded-md border border-border p-2 text-xs">
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-medium">
                                {artifact.artifactType} · v{artifact.version}
                              </span>
                              <Badge variant="outline">{artifact.status}</Badge>
                            </div>
                            <p className="text-muted-foreground mt-1">
                              Snapshot {artifact.snapshotId} · Score {artifact.gradeScore ?? '—'} · {artifact.readyAt ? new Date(artifact.readyAt).toLocaleString() : 'Pending'}
                            </p>
                            {artifact.lastError && (
                              <p className="text-amber-700 mt-1">{artifact.lastError}</p>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">No artifacts yet for this page.</p>
                    )}
                  </section>

                  <section className="space-y-2">
                    <h4 className="text-sm font-semibold">Performance (180d)</h4>
                    {detailData.performance.length === 0 ? (
                      <p className="text-xs text-muted-foreground">No Search Console data yet.</p>
                    ) : (
                      <div className="h-56 w-full rounded-md border border-border p-2">
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={detailData.performance}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis
                              dataKey="date"
                              tick={{ fontSize: 11 }}
                              tickFormatter={(value) => String(value).slice(5)}
                            />
                            <YAxis yAxisId="left" tick={{ fontSize: 11 }} />
                            <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} />
                            <Tooltip />
                            <Line
                              yAxisId="left"
                              type="monotone"
                              dataKey="clicks"
                              stroke="#16a34a"
                              strokeWidth={2}
                              dot={false}
                              name="Clicks"
                            />
                            <Line
                              yAxisId="right"
                              type="monotone"
                              dataKey="impressions"
                              stroke="#2563eb"
                              strokeWidth={2}
                              dot={false}
                              name="Impressions"
                            />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    )}
                  </section>

                  <section className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <h4 className="text-sm font-semibold">Keyword Mapping</h4>
                      <Button
                        size="sm"
                        onClick={() => void handleSaveKeywordMappings()}
                        disabled={savingKeywords}
                      >
                        {savingKeywords ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : null}
                        Save Mapping
                      </Button>
                    </div>
                    <div className="rounded-md border border-border p-3 space-y-3">
                      <div>
                        <label className="text-xs font-medium mb-1 block">Primary Keyword</label>
                        <select
                          className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                          value={primaryKeywordId ?? ''}
                          onChange={(event) =>
                            setPrimaryKeywordId(
                              event.target.value ? Number.parseInt(event.target.value, 10) : null
                            )
                          }
                        >
                          <option value="">Unassigned</option>
                          {(keywordData?.availableKeywords || []).map((option) => (
                            <option key={option.id} value={option.id}>
                              {option.keyword}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="text-xs font-medium mb-1 block">Secondary Keywords</label>
                        <Input
                          placeholder="Filter keywords"
                          value={keywordSearch}
                          onChange={(event) => setKeywordSearch(event.target.value)}
                        />
                        <div className="mt-2 max-h-52 overflow-y-auto space-y-1 pr-1">
                          {filteredKeywordOptions.map((option) => {
                            const checked =
                              option.id !== primaryKeywordId && secondaryKeywordIds.includes(option.id);
                            return (
                              <label
                                key={option.id}
                                className="flex items-center justify-between gap-2 rounded-md border border-border px-2 py-1 text-xs"
                              >
                                <span className="min-w-0 truncate">{option.keyword}</span>
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  disabled={option.id === primaryKeywordId}
                                  onChange={() => toggleSecondaryKeyword(option.id)}
                                />
                              </label>
                            );
                          })}
                        </div>
                        <p className="text-[11px] text-muted-foreground mt-2">
                          One primary keyword per page. Secondary keywords can be many.
                        </p>
                      </div>
                    </div>
                  </section>

                  <section className="space-y-2">
                    <h4 className="text-sm font-semibold">Task Annotations</h4>
                    {detailData.annotations.length === 0 ? (
                      <p className="text-xs text-muted-foreground">No task annotations linked to this page yet.</p>
                    ) : (
                      <div className="space-y-2">
                        {detailData.annotations.map((annotation) => (
                          <div key={`${annotation.taskId}-${annotation.linkType}`} className="rounded-md border border-border p-2">
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-sm font-medium truncate">{annotation.title}</p>
                              <Badge variant="outline">{annotation.status}</Badge>
                            </div>
                            <p className="text-xs text-muted-foreground mt-1">
                              {annotation.linkType} · {annotation.annotationDate ? new Date(annotation.annotationDate).toLocaleString() : 'No timestamp'}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </section>

                  <section className="space-y-2">
                    <h4 className="text-sm font-semibold">Linked Content</h4>
                    {detailData.linkedDocuments.length === 0 ? (
                      <p className="text-xs text-muted-foreground">No documents linked to this page.</p>
                    ) : (
                      <div className="space-y-2">
                        {detailData.linkedDocuments.map((doc) => (
                          <Link
                            key={`${doc.documentId}-${doc.relationType}`}
                            href={withProjectScope(doc.previewUrl, activeProjectId)}
                            className="block rounded-md border border-border p-2 hover:bg-accent/40"
                          >
                            <p className="text-sm font-medium">{doc.title}</p>
                            <p className="text-xs text-muted-foreground">
                              {doc.status} · {doc.relationType}
                            </p>
                          </Link>
                        ))}
                      </div>
                    )}
                  </section>
                </>
              ) : (
                <p className="text-xs text-muted-foreground">Select a page to inspect details.</p>
              )}
            </div>
          </aside>
        </>
      )}
    </div>
  );
}
