'use client';

import { useEffect, useMemo, useState, type ComponentType } from 'react';
import { BarChart3, FileSearch, Globe, Loader2, Search, Waves } from 'lucide-react';
import { useAuth } from '@/components/auth/auth-provider';
import { useActiveProject } from '@/hooks/use-active-project';
import { useProjectScopeSync } from '@/hooks/use-project-scope-sync';
import { MainLayout } from '@/components/layout/main-layout';

interface ClientDashboardData {
  projectId: number | null;
  aiVisibility: { documents: number; avgAiScore: number | null; avgQualityScore: number | null };
  rankings: { trackedKeywords: number; publishedKeywords: number };
  pages: { total: number; verified: number; indexable: number; openIssues: number };
  keywords: { total: number; planned: number; inProgress: number; published: number };
  reviewItems: { unresolvedComments: number; reviewDocs: number };
  activityFeed: Array<{
    id: number;
    action: string;
    resourceType: string;
    resourceId: string | null;
    createdAt: string;
    severity: string;
  }>;
}

export default function ClientDashboardPage() {
  const { user, isLoading: authLoading } = useAuth();
  const { activeProjectId, setActiveProjectId } = useActiveProject();
  useProjectScopeSync(activeProjectId, setActiveProjectId);
  const [data, setData] = useState<ClientDashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  const canLoad = useMemo(() => !authLoading && Boolean(user), [authLoading, user]);

  useEffect(() => {
    if (!canLoad) return;
    const loadingTimer = window.setTimeout(() => setLoading(true), 0);
    const params = new URLSearchParams();
    if (activeProjectId) params.set('projectId', String(activeProjectId));
    fetch(`/api/client/dashboard?${params.toString()}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((payload) => setData(payload))
      .catch(() => setData(null))
      .finally(() => {
        window.clearTimeout(loadingTimer);
        setLoading(false);
      });
    return () => window.clearTimeout(loadingTimer);
  }, [canLoad, activeProjectId]);

  if (authLoading || !user) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <MainLayout>
      <header className="border-b border-border bg-card">
        <div className="max-w-6xl mx-auto px-6 py-4">
          <div>
            <h1 className="text-xl font-bold flex items-center gap-2">
              <Waves className="h-5 w-5" />
              Client Dashboard
            </h1>
            <p className="text-sm text-muted-foreground">Read-only project health and delivery visibility</p>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-6">
        {loading || !data ? (
          <div className="py-16 flex items-center justify-center text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : (
          <>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <MetricCard
                icon={BarChart3}
                title="AI Visibility"
                lines={[
                  `Documents: ${data.aiVisibility.documents}`,
                  `Avg AI score: ${data.aiVisibility.avgAiScore != null ? Math.round(data.aiVisibility.avgAiScore) : '—'}`,
                  `Avg quality: ${data.aiVisibility.avgQualityScore != null ? Math.round(data.aiVisibility.avgQualityScore) : '—'}`,
                ]}
              />
              <MetricCard
                icon={Search}
                title="Rankings"
                lines={[
                  `Tracked keywords: ${data.rankings.trackedKeywords}`,
                  `Published keywords: ${data.rankings.publishedKeywords}`,
                ]}
              />
              <MetricCard
                icon={Globe}
                title="Pages"
                lines={[
                  `Tracked pages: ${data.pages.total}`,
                  `Verified: ${data.pages.verified}`,
                  `Indexable: ${data.pages.indexable}`,
                  `Open issues: ${data.pages.openIssues}`,
                ]}
              />
              <MetricCard
                icon={FileSearch}
                title="Keywords"
                lines={[
                  `Total: ${data.keywords.total}`,
                  `Planned: ${data.keywords.planned}`,
                  `In progress: ${data.keywords.inProgress}`,
                  `Published: ${data.keywords.published}`,
                ]}
              />
              <MetricCard
                icon={FileSearch}
                title="Review Items"
                lines={[
                  `Review docs: ${data.reviewItems.reviewDocs}`,
                  `Unresolved comments: ${data.reviewItems.unresolvedComments}`,
                ]}
              />
            </div>

            <section className="mt-6 border border-border rounded-lg bg-card">
              <div className="px-4 py-3 border-b border-border">
                <h2 className="text-sm font-semibold">Activity Feed</h2>
              </div>
              <div className="divide-y divide-border">
                {data.activityFeed.length === 0 ? (
                  <p className="px-4 py-8 text-sm text-muted-foreground">No recent activity.</p>
                ) : (
                  data.activityFeed.map((item) => (
                    <div key={item.id} className="px-4 py-3 text-sm">
                      <p className="font-medium">{item.action}</p>
                      <p className="text-xs text-muted-foreground">
                        {item.resourceType}
                        {item.resourceId ? ` · ${item.resourceId}` : ''} ·{' '}
                        {new Date(item.createdAt).toLocaleString()}
                      </p>
                    </div>
                  ))
                )}
              </div>
            </section>
          </>
        )}
      </main>
    </MainLayout>
  );
}

function MetricCard({
  icon: Icon,
  title,
  lines,
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  lines: string[];
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center gap-2 mb-2">
        <Icon className="h-4 w-4 text-muted-foreground" />
        <p className="text-sm font-semibold">{title}</p>
      </div>
      <div className="space-y-1">
        {lines.map((line) => (
          <p key={line} className="text-sm text-muted-foreground">
            {line}
          </p>
        ))}
      </div>
    </div>
  );
}
