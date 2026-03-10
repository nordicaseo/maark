'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Loader2, Plus, RefreshCw, ShieldCheck, Sparkles, Target } from 'lucide-react';
import { useAuth } from '@/components/auth/auth-provider';
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
import { triggerTopicWorkflowRun } from '@/lib/topic-workflow-client';
import type { Keyword, KeywordIntent, KeywordPriority, KeywordStatus } from '@/types/keyword';
import { KEYWORD_INTENT_LABELS, KEYWORD_STATUS_LABELS } from '@/types/keyword';
import { MainLayout } from '@/components/layout/main-layout';

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

interface KeywordCluster {
  id: number;
  projectId: number;
  name: string;
  status: string;
  notes: string | null;
  mainKeywordId: number | null;
  mainKeyword: string | null;
  memberCount: number;
  secondaryKeywords: Array<{ id: number; keyword: string }>;
  createdAt: string;
  updatedAt: string;
}

interface KeywordSerpSnapshot {
  keyword: string;
  provider: string;
  fetchedAt: string;
  competitors: Array<{ rank: number; domain: string; url: string; title: string }>;
  entities: Array<{ term: string }>;
  lsiKeywords: Array<{ term: string }>;
  suggestions: string[];
}

interface KeywordGovernancePayload {
  projectIds: number[];
  summary: {
    totalPages: number;
    pagesWithPrimary: number;
    pagesWithoutPrimary: number;
    duplicatePrimaryKeywordCount: number;
  };
  pagesWithoutPrimary: Array<{
    pageId: number;
    projectId: number;
    url: string;
    title: string | null;
  }>;
  duplicatePrimaryKeywords: Array<{
    projectId: number;
    keywordId: number;
    keyword: string;
    pages: Array<{ pageId: number; url: string; title: string | null }>;
  }>;
}

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
  const [clusters, setClusters] = useState<KeywordCluster[]>([]);
  const [loading, setLoading] = useState(true);
  const [clustersLoading, setClustersLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [clusterSubmitting, setClusterSubmitting] = useState(false);
  const [taskBusyId, setTaskBusyId] = useState<number | null>(null);
  const [clusterTaskBusyId, setClusterTaskBusyId] = useState<number | null>(null);
  const [serpBusyId, setSerpBusyId] = useState<number | null>(null);
  const [serpSnapshot, setSerpSnapshot] = useState<KeywordSerpSnapshot | null>(null);
  const [serpKeywordLabel, setSerpKeywordLabel] = useState<string | null>(null);
  const [serpError, setSerpError] = useState<string | null>(null);
  const [governance, setGovernance] = useState<KeywordGovernancePayload | null>(null);
  const [governanceLoading, setGovernanceLoading] = useState(false);
  const [newKeyword, setNewKeyword] = useState('');
  const [newIntent, setNewIntent] = useState<KeywordIntent>('informational');
  const [newPriority, setNewPriority] = useState<KeywordPriority>('medium');
  const [newVolume, setNewVolume] = useState('');
  const [newClusterName, setNewClusterName] = useState('');
  const [newClusterMainKeywordId, setNewClusterMainKeywordId] = useState<string>('');
  const [newClusterSecondaryKeywordIds, setNewClusterSecondaryKeywordIds] = useState<number[]>([]);
  const [newClusterNotes, setNewClusterNotes] = useState('');

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

  const fetchClusters = async () => {
    setClustersLoading(true);
    try {
      const params = new URLSearchParams();
      if (activeProjectId) params.set('projectId', String(activeProjectId));
      const res = await fetch(`/api/keywords/clusters?${params.toString()}`);
      if (res.ok) {
        setClusters(await res.json());
      } else {
        setClusters([]);
      }
    } finally {
      setClustersLoading(false);
    }
  };

  const fetchGovernance = async () => {
    setGovernanceLoading(true);
    try {
      const params = new URLSearchParams();
      if (activeProjectId) params.set('projectId', String(activeProjectId));
      const res = await fetch(`/api/keywords/governance?${params.toString()}`);
      if (res.ok) {
        setGovernance(await res.json());
      } else {
        setGovernance(null);
      }
    } catch {
      setGovernance(null);
    } finally {
      setGovernanceLoading(false);
    }
  };

  const refreshKeywordData = async () => {
    await Promise.all([fetchKeywords(), fetchClusters(), fetchGovernance()]);
  };

  useEffect(() => {
    if (!authLoading && user) {
      void refreshKeywordData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, user, activeProjectId]);

  useEffect(() => {
    setSerpSnapshot(null);
    setSerpKeywordLabel(null);
    setSerpError(null);
  }, [activeProjectId]);

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
        await refreshKeywordData();
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
    await refreshKeywordData();
  };

  const handleCreateTask = async (keyword: Keyword) => {
    setTaskBusyId(keyword.id);
    try {
      const res = await fetch(`/api/keywords/${keyword.id}/create-task`, { method: 'POST' });
      if (res.ok) {
        const created = await res.json();
        if (created?.taskId) {
          triggerTopicWorkflowRun(created.taskId, {
            autoContinue: true,
            maxStages: 10,
            logLabel: 'topic workflow',
          });
        }
        await refreshKeywordData();
      }
    } finally {
      setTaskBusyId(null);
    }
  };

  const handleToggleSecondaryKeyword = (keywordId: number) => {
    setNewClusterSecondaryKeywordIds((prev) =>
      prev.includes(keywordId)
        ? prev.filter((id) => id !== keywordId)
        : [...prev, keywordId]
    );
  };

  const handleCreateCluster = async () => {
    if (!activeProjectId) return;
    if (!newClusterName.trim()) return;
    const mainKeywordId = Number.parseInt(newClusterMainKeywordId, 10);
    if (!Number.isFinite(mainKeywordId) || mainKeywordId <= 0) return;

    setClusterSubmitting(true);
    try {
      const res = await fetch('/api/keywords/clusters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: activeProjectId,
          name: newClusterName.trim(),
          mainKeywordId,
          secondaryKeywordIds: newClusterSecondaryKeywordIds,
          notes: newClusterNotes.trim() || null,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to create keyword cluster');
      }
      setNewClusterName('');
      setNewClusterMainKeywordId('');
      setNewClusterSecondaryKeywordIds([]);
      setNewClusterNotes('');
      await refreshKeywordData();
    } catch (error) {
      console.error(error);
    } finally {
      setClusterSubmitting(false);
    }
  };

  const handleCreateClusterTask = async (cluster: KeywordCluster) => {
    setClusterTaskBusyId(cluster.id);
    try {
      const res = await fetch(`/api/keywords/clusters/${cluster.id}/create-task`, {
        method: 'POST',
      });
      if (res.ok) {
        const created = await res.json();
        if (created?.taskId) {
          triggerTopicWorkflowRun(created.taskId, {
            autoContinue: true,
            maxStages: 10,
            logLabel: 'cluster topic workflow',
          });
        }
        await refreshKeywordData();
      }
    } finally {
      setClusterTaskBusyId(null);
    }
  };

  const handleRunSerpIntel = async (keyword: Keyword, forceRefresh: boolean) => {
    setSerpBusyId(keyword.id);
    if (!forceRefresh) setSerpError(null);
    try {
      const endpoint = forceRefresh
        ? `/api/keywords/${keyword.id}/serp-intel`
        : `/api/keywords/${keyword.id}/serp-intel?refresh=0`;
      const res = await fetch(endpoint, {
        method: forceRefresh ? 'POST' : 'GET',
        headers: { 'Content-Type': 'application/json' },
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(payload.error || 'Failed to run SERP intel');
      }
      setSerpSnapshot(payload.snapshot || null);
      setSerpKeywordLabel(payload.keyword || keyword.keyword);
      setSerpError(null);
    } catch (error) {
      setSerpError((error as Error).message);
    } finally {
      setSerpBusyId(null);
    }
  };

  return (
    <MainLayout>
      <header className="border-b border-border bg-card">
        <div className="max-w-6xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <h1 className="text-xl font-bold flex items-center gap-2">
                <Target className="h-5 w-5" /> Keyword Universe
              </h1>
              <p className="text-sm text-muted-foreground">
                Track keywords and create Mission Control content tasks directly.
              </p>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-6 space-y-5">
        <section className="border border-border rounded-lg p-4 bg-card">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold flex items-center gap-2">
                <ShieldCheck className="h-4 w-4" />
                Keyword Governance
              </h2>
              <p className="text-xs text-muted-foreground">
                Ensure every optimization page has one primary keyword and no duplicate primaries.
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void fetchGovernance()}
              disabled={governanceLoading}
            >
              {governanceLoading ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : null}
              Refresh
            </Button>
          </div>
          <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
            <div className="rounded-md border border-border p-2">
              <p className="text-muted-foreground">Optimization pages</p>
              <p className="text-lg font-semibold">{governance?.summary.totalPages ?? 0}</p>
            </div>
            <div className="rounded-md border border-border p-2">
              <p className="text-muted-foreground">With primary</p>
              <p className="text-lg font-semibold text-emerald-600">{governance?.summary.pagesWithPrimary ?? 0}</p>
            </div>
            <div className="rounded-md border border-border p-2">
              <p className="text-muted-foreground">Missing primary</p>
              <p className="text-lg font-semibold text-amber-600">{governance?.summary.pagesWithoutPrimary ?? 0}</p>
            </div>
            <div className="rounded-md border border-border p-2">
              <p className="text-muted-foreground">Duplicate primaries</p>
              <p className="text-lg font-semibold text-red-600">{governance?.summary.duplicatePrimaryKeywordCount ?? 0}</p>
            </div>
          </div>
          {(governance?.summary.pagesWithoutPrimary || 0) > 0 && (
            <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3">
              <p className="text-xs font-medium text-amber-700 flex items-center gap-1">
                <AlertTriangle className="h-3.5 w-3.5" />
                Pages missing primary keyword
              </p>
              <div className="mt-1 space-y-1">
                {(governance?.pagesWithoutPrimary || []).slice(0, 5).map((page) => (
                  <p key={page.pageId} className="text-xs text-amber-700 truncate">
                    {page.url}
                  </p>
                ))}
              </div>
            </div>
          )}
          {(governance?.summary.duplicatePrimaryKeywordCount || 0) > 0 && (
            <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-3">
              <p className="text-xs font-medium text-red-700 flex items-center gap-1">
                <AlertTriangle className="h-3.5 w-3.5" />
                Primary keyword conflicts
              </p>
              <div className="mt-1 space-y-1">
                {(governance?.duplicatePrimaryKeywords || []).slice(0, 4).map((entry) => (
                  <p key={`${entry.projectId}-${entry.keywordId}`} className="text-xs text-red-700">
                    {entry.keyword} mapped to {entry.pages.length} pages
                  </p>
                ))}
              </div>
            </div>
          )}
        </section>

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

        <section className="border border-border rounded-lg p-4 bg-card space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">Keyword Clusters</h2>
            <span className="text-xs text-muted-foreground">
              Main keyword + secondary terms mapped for task creation
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Input
              placeholder="Cluster name"
              value={newClusterName}
              onChange={(e) => setNewClusterName(e.target.value)}
            />
            <Select value={newClusterMainKeywordId} onValueChange={setNewClusterMainKeywordId}>
              <SelectTrigger>
                <SelectValue placeholder="Main keyword" />
              </SelectTrigger>
              <SelectContent>
                {keywords.map((keyword) => (
                  <SelectItem key={keyword.id} value={String(keyword.id)}>
                    {keyword.keyword}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              placeholder="Notes (optional)"
              value={newClusterNotes}
              onChange={(e) => setNewClusterNotes(e.target.value)}
            />
          </div>

          <div className="rounded-md border border-border p-2">
            <p className="text-xs font-medium text-muted-foreground mb-2">
              Secondary keywords
            </p>
            {keywords.length === 0 ? (
              <p className="text-xs text-muted-foreground">Add keywords first.</p>
            ) : (
              <div className="max-h-32 overflow-y-auto grid grid-cols-1 md:grid-cols-2 gap-1">
                {keywords.map((keyword) => {
                  const selected = newClusterSecondaryKeywordIds.includes(keyword.id);
                  const isMainSelected = Number.parseInt(newClusterMainKeywordId || '0', 10) === keyword.id;
                  return (
                    <label
                      key={keyword.id}
                      className={`text-xs flex items-center gap-2 px-2 py-1 rounded ${
                        isMainSelected ? 'opacity-50 cursor-not-allowed' : 'hover:bg-accent/40 cursor-pointer'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={selected}
                        disabled={isMainSelected}
                        onChange={() => handleToggleSecondaryKeyword(keyword.id)}
                      />
                      <span className="truncate">{keyword.keyword}</span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          <div>
            <Button
              onClick={handleCreateCluster}
              disabled={
                clusterSubmitting ||
                !activeProjectId ||
                !newClusterName.trim() ||
                !newClusterMainKeywordId
              }
            >
              {clusterSubmitting ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Plus className="h-4 w-4 mr-2" />
              )}
              Create Cluster
            </Button>
          </div>

          <div className="rounded-md border border-border overflow-hidden">
            <div className="px-3 py-2 text-xs font-semibold border-b border-border">
              Clusters ({clusters.length})
            </div>
            {clustersLoading ? (
              <div className="py-4 flex items-center justify-center text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
              </div>
            ) : clusters.length === 0 ? (
              <div className="px-3 py-4 text-xs text-muted-foreground">
                No clusters created yet.
              </div>
            ) : (
              <div className="divide-y divide-border">
                {clusters.map((cluster) => (
                  <div key={cluster.id} className="px-3 py-2 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{cluster.name}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Main: {cluster.mainKeyword || '—'} · Secondary: {cluster.secondaryKeywords.length}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8"
                      onClick={() => void handleCreateClusterTask(cluster)}
                      disabled={clusterTaskBusyId === cluster.id}
                    >
                      {clusterTaskBusyId === cluster.id ? (
                        <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                      ) : (
                        <Sparkles className="h-3.5 w-3.5 mr-1" />
                      )}
                      Create Cluster Task
                    </Button>
                  </div>
                ))}
              </div>
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
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8"
                      onClick={() => void handleRunSerpIntel(keyword, true)}
                      disabled={serpBusyId === keyword.id}
                    >
                      {serpBusyId === keyword.id ? (
                        <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                      ) : (
                        <RefreshCw className="h-3.5 w-3.5 mr-1" />
                      )}
                      SERP Intel
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="border border-border rounded-lg bg-card overflow-hidden">
          <div className="px-4 py-3 border-b border-border text-sm font-semibold">
            SERP Intel Snapshot {serpKeywordLabel ? `· ${serpKeywordLabel}` : ''}
          </div>
          {serpError ? (
            <div className="px-4 py-3 text-sm text-red-500">{serpError}</div>
          ) : !serpSnapshot ? (
            <div className="px-4 py-4 text-sm text-muted-foreground">
              Run SERP Intel on a keyword to preview competitor domains, entity coverage, and suggestions.
            </div>
          ) : (
            <div className="px-4 py-4 space-y-3">
              <p className="text-xs text-muted-foreground">
                Provider: {serpSnapshot.provider} · Fetched: {new Date(serpSnapshot.fetchedAt).toLocaleString()}
              </p>
              <div>
                <p className="text-xs font-semibold mb-1">Top competitors</p>
                <div className="flex flex-wrap gap-2">
                  {serpSnapshot.competitors.slice(0, 8).map((competitor) => (
                    <Badge key={`${competitor.rank}-${competitor.url}`} variant="secondary" className="text-xs">
                      {competitor.domain || competitor.url}
                    </Badge>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-xs font-semibold mb-1">Entity / LSI preview</p>
                <p className="text-xs text-muted-foreground">
                  Entities: {serpSnapshot.entities.slice(0, 10).map((entity) => entity.term).join(', ') || '—'}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Related terms: {serpSnapshot.lsiKeywords.slice(0, 10).map((term) => term.term).join(', ') || '—'}
                </p>
              </div>
              <div>
                <p className="text-xs font-semibold mb-1">Action suggestions</p>
                <ul className="list-disc pl-5 space-y-1 text-xs text-muted-foreground">
                  {serpSnapshot.suggestions.slice(0, 5).map((suggestion) => (
                    <li key={suggestion}>{suggestion}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </section>
      </main>
    </MainLayout>
  );
}
