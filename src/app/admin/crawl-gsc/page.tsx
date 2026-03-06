'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  AlertTriangle,
  Globe,
  Loader2,
  RefreshCw,
  SearchCheck,
  ShieldCheck,
  Link as LinkIcon,
  Activity,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';

interface Project {
  id: number;
  name: string;
}

interface SiteConfigResponse {
  project: Project;
  site: {
    id: number;
    domain: string;
    sitemapUrl: string | null;
    gscProperty: string | null;
    gscConnectedAt: string | null;
    gscLastSyncAt: string | null;
    gscLastSyncStatus: string;
    gscLastError: string | null;
    crawlLastRunAt: string | null;
    crawlLastRunStatus: string;
    crawlLastError: string | null;
    autoCrawlEnabled: boolean;
    autoGscEnabled: boolean;
    crawlFrequencyHours: number;
    pendingQueue: number;
  } | null;
}

interface GscPropertyOption {
  siteUrl: string;
  permissionLevel: string;
}

interface ObservabilityResponse {
  queue: {
    queued: number;
    processing: number;
    done: number;
    failed: number;
  };
  gsc: {
    pointsLast30d: {
      clicks: number;
      impressions: number;
    };
    latestMetricDate: string | null;
  };
  artifacts: {
    queue: {
      queued: number;
      processing: number;
      done: number;
      failed: number;
      deadLetter: number;
    };
    recent: Array<{
      id: number;
      snapshotId: number;
      artifactType: string;
      status: string;
      gradeScore: number | null;
      readyAt: string | null;
      createdAt: string | null;
      lastError: string | null;
    }>;
  };
  crawlRuns: Array<{
    id: number;
    runType: string;
    status: string;
    totalUrls: number;
    processedUrls: number;
    successUrls: number;
    failedUrls: number;
    updatedAt: string | null;
  }>;
  alerts: Array<{
    id: number;
    source: string;
    eventType: string;
    severity: string;
    message: string;
    createdAt: string | null;
  }>;
}

function statusDot(on: boolean) {
  return (
    <span
      className={`inline-block h-2.5 w-2.5 rounded-full ${on ? 'bg-green-500' : 'bg-amber-500'}`}
    />
  );
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return 'Never';
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return 'Never';
  return new Date(parsed).toLocaleString();
}

export default function AdminCrawlGscPage() {
  const searchParams = useSearchParams();

  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingSite, setLoadingSite] = useState(false);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [loadingProperties, setLoadingProperties] = useState(false);
  const [loadingObservability, setLoadingObservability] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const [domain, setDomain] = useState('');
  const [sitemapUrl, setSitemapUrl] = useState('');
  const [gscProperty, setGscProperty] = useState('');
  const [autoCrawlEnabled, setAutoCrawlEnabled] = useState(true);
  const [autoGscEnabled, setAutoGscEnabled] = useState(true);
  const [crawlFrequencyHours, setCrawlFrequencyHours] = useState(24);
  const [siteState, setSiteState] = useState<SiteConfigResponse['site'] | null>(null);
  const [properties, setProperties] = useState<GscPropertyOption[]>([]);
  const [observability, setObservability] = useState<ObservabilityResponse | null>(null);

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === projectId) ?? null,
    [projects, projectId]
  );

  async function fetchProjects() {
    setLoading(true);
    try {
      const res = await fetch('/api/projects');
      if (!res.ok) return;
      const rows = await res.json();
      const next = Array.isArray(rows)
        ? rows.map((row) => ({ id: Number(row.id), name: String(row.name) }))
        : [];
      setProjects(next);
      if (next.length > 0 && !projectId) {
        const fromQuery = Number.parseInt(String(searchParams.get('projectId') || ''), 10);
        if (Number.isFinite(fromQuery) && next.some((entry) => entry.id === fromQuery)) {
          setProjectId(fromQuery);
        } else {
          setProjectId(next[0].id);
        }
      }
    } finally {
      setLoading(false);
    }
  }

  async function fetchSiteConfig(targetProjectId: number) {
    setLoadingSite(true);
    try {
      const res = await fetch(`/api/admin/crawl-gsc?projectId=${targetProjectId}`);
      if (!res.ok) {
        setSiteState(null);
        return;
      }
      const payload: SiteConfigResponse = await res.json();
      setSiteState(payload.site);
      setDomain(payload.site?.domain || '');
      setSitemapUrl(payload.site?.sitemapUrl || '');
      setGscProperty(payload.site?.gscProperty || '');
      setAutoCrawlEnabled(payload.site?.autoCrawlEnabled ?? true);
      setAutoGscEnabled(payload.site?.autoGscEnabled ?? true);
      setCrawlFrequencyHours(payload.site?.crawlFrequencyHours ?? 24);
    } finally {
      setLoadingSite(false);
    }
  }

  async function fetchObservability(targetProjectId: number) {
    setLoadingObservability(true);
    try {
      const res = await fetch(`/api/admin/crawl-gsc/observability?projectId=${targetProjectId}`);
      if (!res.ok) {
        setObservability(null);
        return;
      }
      const payload: ObservabilityResponse = await res.json();
      setObservability(payload);
    } finally {
      setLoadingObservability(false);
    }
  }

  useEffect(() => {
    void fetchProjects();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!projectId) return;
    void fetchSiteConfig(projectId);
    void fetchObservability(projectId);
  }, [projectId]);

  useEffect(() => {
    const oauthStatus = searchParams.get('oauth');
    const msg = searchParams.get('msg');
    if (!oauthStatus) return;

    if (oauthStatus === 'connected') {
      setNotice('Google Search Console connected successfully.');
      return;
    }

    const statusText = oauthStatus.replace(/_/g, ' ');
    setNotice(`GSC connect ${statusText}${msg ? `: ${msg}` : ''}`);
  }, [searchParams]);

  async function saveConfig() {
    if (!projectId) return;
    setSaving(true);
    setNotice(null);
    try {
      const res = await fetch('/api/admin/crawl-gsc', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          domain,
          sitemapUrl,
          gscProperty,
          autoCrawlEnabled,
          autoGscEnabled,
          crawlFrequencyHours,
        }),
      });
      const payload = await res.json().catch(() => null);
      if (res.ok) {
        setNotice('Crawler and GSC settings saved.');
        await fetchSiteConfig(projectId);
        await fetchObservability(projectId);
      } else {
        setNotice(payload?.error || 'Failed to save settings.');
      }
    } finally {
      setSaving(false);
    }
  }

  async function runNow() {
    if (!projectId) return;
    setRunning(true);
    setNotice(null);
    try {
      const res = await fetch('/api/admin/crawl-gsc/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          runDiscovery: true,
          runGscSync: true,
          runTrafficTasking: true,
          enqueueLimit: 30,
          workerLimit: 10,
        }),
      });
      const payload = await res.json().catch(() => null);
      if (res.ok) {
        const discovered = payload?.discovery?.totals?.discovered ?? 0;
        const processed = payload?.worker?.processedCount ?? 0;
        const artifactProcessed = payload?.artifactWorker?.processedCount ?? 0;
        const gscRows = payload?.gsc?.rowsUpserted ?? 0;
        const tasksCreated = payload?.trafficTasking?.created ?? 0;
        setNotice(
          `Run complete: ${discovered} discovered, ${gscRows} GSC rows synced, ${processed} crawled, ${artifactProcessed} artifacts processed, ${tasksCreated} traffic tasks created.`
        );
        await fetchSiteConfig(projectId);
        await fetchObservability(projectId);
      } else {
        setNotice(payload?.error || payload?.gscError || 'Run failed.');
      }
    } finally {
      setRunning(false);
    }
  }

  async function connectGsc() {
    if (!projectId) return;
    setConnecting(true);
    setNotice(null);
    try {
      const res = await fetch(`/api/admin/crawl-gsc/oauth/start?projectId=${projectId}`);
      const payload = await res.json().catch(() => null);
      if (!res.ok || !payload?.url) {
        setNotice(payload?.error || 'Failed to initialize Google OAuth flow.');
        return;
      }
      window.location.href = payload.url;
    } finally {
      setConnecting(false);
    }
  }

  async function loadGscProperties() {
    if (!projectId) return;
    setLoadingProperties(true);
    setNotice(null);
    try {
      const res = await fetch(`/api/admin/crawl-gsc/properties?projectId=${projectId}`);
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        setNotice(payload?.error || 'Failed to load GSC properties.');
        return;
      }
      const next = Array.isArray(payload?.properties)
        ? payload.properties.map((row: { siteUrl: string; permissionLevel: string }) => ({
            siteUrl: String(row.siteUrl),
            permissionLevel: String(row.permissionLevel || 'unknown'),
          }))
        : [];
      setProperties(next);
      if (!gscProperty && next.length > 0) {
        setGscProperty(next[0].siteUrl);
      }
      setNotice(next.length > 0 ? `Loaded ${next.length} GSC properties.` : 'No GSC properties found.');
    } finally {
      setLoadingProperties(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Globe className="h-6 w-6" />
            Crawl & GSC
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Configure automatic crawling, connect Google Search Console, and monitor operational health.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => {
            if (!projectId) return;
            void fetchSiteConfig(projectId);
            void fetchObservability(projectId);
          }}
          disabled={!projectId || loadingSite || loadingObservability}
        >
          {loadingSite || loadingObservability ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4 mr-2" />
          )}
          Refresh
        </Button>
      </div>

      <section className="border border-border rounded-lg p-4 bg-card space-y-4">
        <div>
          <label className="text-sm font-medium mb-1 block">Project</label>
          <select
            className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
            value={projectId ?? ''}
            onChange={(event) => setProjectId(event.target.value ? Number(event.target.value) : null)}
          >
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="secondary" className="flex items-center gap-2">
            {statusDot(Boolean(siteState?.gscConnectedAt) && siteState?.gscLastSyncStatus === 'ok')}
            GSC {siteState?.gscLastSyncStatus || 'never'}
          </Badge>
          <Badge variant="secondary" className="flex items-center gap-2">
            {statusDot(siteState?.crawlLastRunStatus === 'ok')}
            Crawl {siteState?.crawlLastRunStatus || 'never'}
          </Badge>
          <Badge variant="secondary" className="flex items-center gap-2">
            {statusDot((observability?.artifacts.queue.failed ?? 0) + (observability?.artifacts.queue.deadLetter ?? 0) === 0)}
            Artifacts {(observability?.artifacts.queue.processing ?? 0) > 0 ? 'processing' : 'ready'}
          </Badge>
          <Badge variant="outline" className="flex items-center gap-1">
            <ShieldCheck className="h-3 w-3" />
            Queue {siteState?.pendingQueue ?? 0}
          </Badge>
          {selectedProject && <Badge variant="outline">{selectedProject.name}</Badge>}
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <label className="text-sm font-medium mb-1 block">Domain</label>
            <Input
              value={domain}
              onChange={(event) => setDomain(event.target.value)}
              placeholder="example.com"
            />
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block">Sitemap URL</label>
            <Input
              value={sitemapUrl}
              onChange={(event) => setSitemapUrl(event.target.value)}
              placeholder="https://example.com/sitemap.xml"
            />
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block">GSC Property</label>
            {properties.length > 0 ? (
              <select
                className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                value={gscProperty}
                onChange={(event) => setGscProperty(event.target.value)}
              >
                <option value="">Select GSC property</option>
                {properties.map((property) => (
                  <option key={property.siteUrl} value={property.siteUrl}>
                    {property.siteUrl} ({property.permissionLevel})
                  </option>
                ))}
              </select>
            ) : (
              <Input
                value={gscProperty}
                onChange={(event) => setGscProperty(event.target.value)}
                placeholder="sc-domain:example.com or https://example.com/"
              />
            )}
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block">Crawl Frequency (hours)</label>
            <Input
              type="number"
              min={1}
              max={168}
              value={crawlFrequencyHours}
              onChange={(event) => setCrawlFrequencyHours(Number(event.target.value) || 24)}
            />
          </div>
        </div>

        <div className="flex items-center gap-6 text-sm">
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              checked={autoCrawlEnabled}
              onChange={(event) => setAutoCrawlEnabled(event.target.checked)}
            />
            Auto Crawl
          </label>
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              checked={autoGscEnabled}
              onChange={(event) => setAutoGscEnabled(event.target.checked)}
            />
            Auto GSC Sync
          </label>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Button onClick={() => void saveConfig()} disabled={!projectId || saving}>
            {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <SearchCheck className="h-4 w-4 mr-2" />}
            Save Config
          </Button>
          <Button variant="outline" onClick={() => void connectGsc()} disabled={!projectId || connecting}>
            {connecting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <LinkIcon className="h-4 w-4 mr-2" />}
            Connect Google
          </Button>
          <Button variant="outline" onClick={() => void loadGscProperties()} disabled={!projectId || loadingProperties}>
            {loadingProperties ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
            Load Properties
          </Button>
          <Button variant="outline" onClick={() => void runNow()} disabled={!projectId || running}>
            {running ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
            Run Discovery + GSC + Crawl
          </Button>
        </div>

        <div className="grid md:grid-cols-2 gap-2 text-xs text-muted-foreground">
          <div>GSC last sync: {formatDateTime(siteState?.gscLastSyncAt)}</div>
          <div>Crawl last run: {formatDateTime(siteState?.crawlLastRunAt)}</div>
        </div>

        {siteState?.gscLastError && (
          <p className="text-xs text-amber-700">
            GSC: {siteState.gscLastError}
          </p>
        )}
        {siteState?.crawlLastError && (
          <p className="text-xs text-amber-700">
            Crawl: {siteState.crawlLastError}
          </p>
        )}
        {notice && <p className="text-xs text-muted-foreground">{notice}</p>}
      </section>

      <section className="border border-border rounded-lg p-4 bg-card space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold flex items-center gap-2">
            <Activity className="h-4 w-4" />
            Observability
          </h2>
          {loadingObservability && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        </div>

        <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
          <div className="rounded-md border border-border p-3">
            <p className="text-xs text-muted-foreground">Queued</p>
            <p className="text-lg font-semibold">{observability?.queue.queued ?? 0}</p>
          </div>
          <div className="rounded-md border border-border p-3">
            <p className="text-xs text-muted-foreground">Processing</p>
            <p className="text-lg font-semibold">{observability?.queue.processing ?? 0}</p>
          </div>
          <div className="rounded-md border border-border p-3">
            <p className="text-xs text-muted-foreground">GSC Clicks (30d)</p>
            <p className="text-lg font-semibold">{Math.round(observability?.gsc.pointsLast30d.clicks ?? 0)}</p>
          </div>
          <div className="rounded-md border border-border p-3">
            <p className="text-xs text-muted-foreground">GSC Impressions (30d)</p>
            <p className="text-lg font-semibold">{Math.round(observability?.gsc.pointsLast30d.impressions ?? 0)}</p>
          </div>
          <div className="rounded-md border border-border p-3">
            <p className="text-xs text-muted-foreground">Artifacts Queued</p>
            <p className="text-lg font-semibold">{observability?.artifacts.queue.queued ?? 0}</p>
          </div>
          <div className="rounded-md border border-border p-3">
            <p className="text-xs text-muted-foreground">Artifacts Failed</p>
            <p className="text-lg font-semibold">
              {(observability?.artifacts.queue.failed ?? 0) + (observability?.artifacts.queue.deadLetter ?? 0)}
            </p>
          </div>
        </div>

        <div>
          <p className="text-xs text-muted-foreground mb-2">Recent Crawl Runs</p>
          {observability?.crawlRuns?.length ? (
            <div className="space-y-2">
              {observability.crawlRuns.map((run) => (
                <div key={run.id} className="rounded-md border border-border p-2 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-medium">Run #{run.id} · {run.runType}</div>
                    <Badge variant="outline">{run.status}</Badge>
                  </div>
                  <div className="text-muted-foreground mt-1">
                    Processed {run.processedUrls}/{run.totalUrls} · Success {run.successUrls} · Failed {run.failedUrls}
                  </div>
                  <div className="text-muted-foreground mt-1">Updated {formatDateTime(run.updatedAt)}</div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">No crawl runs yet.</p>
          )}
        </div>

        <div>
          <p className="text-xs text-muted-foreground mb-2">Recent Artifacts</p>
          {observability?.artifacts?.recent?.length ? (
            <div className="space-y-2">
              {observability.artifacts.recent.map((artifact) => (
                <div key={artifact.id} className="rounded-md border border-border p-2 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-medium">
                      #{artifact.id} · {artifact.artifactType} · snapshot {artifact.snapshotId}
                    </div>
                    <Badge variant="outline">{artifact.status}</Badge>
                  </div>
                  <div className="text-muted-foreground mt-1">
                    Score {artifact.gradeScore ?? '—'} · Ready {formatDateTime(artifact.readyAt)}
                  </div>
                  {artifact.lastError && (
                    <div className="text-amber-700 mt-1">{artifact.lastError}</div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">No artifact rows yet.</p>
          )}
        </div>

        <div>
          <p className="text-xs text-muted-foreground mb-2">Recent Alerts</p>
          {observability?.alerts?.length ? (
            <div className="space-y-2">
              {observability.alerts.map((alert) => (
                <div key={alert.id} className="rounded-md border border-border p-2 text-xs">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
                    <span className="font-medium">{alert.eventType}</span>
                    <Badge variant="secondary" className="uppercase">{alert.severity}</Badge>
                  </div>
                  <p className="mt-1 text-muted-foreground">{alert.message}</p>
                  <p className="mt-1 text-muted-foreground">{formatDateTime(alert.createdAt)}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">No recent crawler/GSC alerts.</p>
          )}
        </div>
      </section>
    </div>
  );
}
