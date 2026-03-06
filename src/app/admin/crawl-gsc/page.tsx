'use client';

import { useEffect, useMemo, useState } from 'react';
import { Globe, Loader2, RefreshCw, SearchCheck, ShieldCheck } from 'lucide-react';
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

function statusDot(on: boolean) {
  return (
    <span
      className={`inline-block h-2.5 w-2.5 rounded-full ${on ? 'bg-green-500' : 'bg-amber-500'}`}
    />
  );
}

export default function AdminCrawlGscPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingSite, setLoadingSite] = useState(false);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const [domain, setDomain] = useState('');
  const [sitemapUrl, setSitemapUrl] = useState('');
  const [gscProperty, setGscProperty] = useState('');
  const [autoCrawlEnabled, setAutoCrawlEnabled] = useState(true);
  const [autoGscEnabled, setAutoGscEnabled] = useState(true);
  const [crawlFrequencyHours, setCrawlFrequencyHours] = useState(24);
  const [siteState, setSiteState] = useState<SiteConfigResponse['site'] | null>(null);

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
        setProjectId(next[0].id);
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

  useEffect(() => {
    void fetchProjects();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!projectId) return;
    void fetchSiteConfig(projectId);
  }, [projectId]);

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
          enqueueLimit: 30,
          workerLimit: 10,
        }),
      });
      const payload = await res.json().catch(() => null);
      if (res.ok) {
        const discovered = payload?.discovery?.totals?.discovered ?? 0;
        const processed = payload?.worker?.processedCount ?? 0;
        setNotice(`Run complete: ${discovered} discovered, ${processed} crawled.`);
        await fetchSiteConfig(projectId);
      } else {
        setNotice(payload?.error || 'Run failed.');
      }
    } finally {
      setRunning(false);
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
            Configure automatic crawling and Google Search Console sync per project.
          </p>
        </div>
        <Button variant="outline" onClick={() => projectId && fetchSiteConfig(projectId)} disabled={!projectId || loadingSite}>
          {loadingSite ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
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
            <Input
              value={gscProperty}
              onChange={(event) => setGscProperty(event.target.value)}
              placeholder="sc-domain:example.com or https://example.com/"
            />
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
          <Button variant="outline" onClick={() => void runNow()} disabled={!projectId || running}>
            {running ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
            Run Discovery + Crawl
          </Button>
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
    </div>
  );
}

