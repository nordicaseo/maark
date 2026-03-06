'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, Rocket } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

interface ChecklistItem {
  key: string;
  label: string;
  status: 'ok' | 'warning' | 'error';
  detail: string;
}

interface ChecklistPayload {
  checkedAt: string;
  summary: {
    ok: number;
    warnings: number;
    errors: number;
    ready: boolean;
  };
  items: ChecklistItem[];
}

export default function LaunchChecklistPage() {
  const [loading, setLoading] = useState(true);
  const [payload, setPayload] = useState<ChecklistPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadChecklist() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/super-admin/launch-checklist');
      const data = await res.json().catch(() => ({} as { error?: string }));
      if (!res.ok) {
        throw new Error(data.error || 'Failed to load launch checklist');
      }
      setPayload(data as ChecklistPayload);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load launch checklist');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadChecklist();
  }, []);

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Rocket className="h-5 w-5" />
            Launch Checklist
          </h1>
          <p className="text-sm text-muted-foreground">
            Validate platform readiness before production handoff.
          </p>
        </div>
        <Button variant="outline" onClick={() => void loadChecklist()} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <section className="rounded-lg border border-border bg-card p-4">
        {loading && !payload ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Checking readiness...
          </div>
        ) : payload ? (
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <Badge variant={payload.summary.ready ? 'default' : 'secondary'}>
              {payload.summary.ready ? 'Ready for rollout' : 'Needs attention'}
            </Badge>
            <span className="text-muted-foreground">OK: {payload.summary.ok}</span>
            <span className="text-amber-700">Warnings: {payload.summary.warnings}</span>
            <span className="text-red-700">Errors: {payload.summary.errors}</span>
            <span className="text-xs text-muted-foreground">
              Last check: {new Date(payload.checkedAt).toLocaleString()}
            </span>
          </div>
        ) : null}
      </section>

      <section className="rounded-lg border border-border bg-card divide-y divide-border">
        {(payload?.items || []).map((item) => (
          <div key={item.key} className="px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-medium">{item.label}</p>
              {item.status === 'ok' ? (
                <span className="inline-flex items-center gap-1 text-emerald-600 text-xs font-medium">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  OK
                </span>
              ) : (
                <span
                  className={`inline-flex items-center gap-1 text-xs font-medium ${
                    item.status === 'error' ? 'text-red-600' : 'text-amber-600'
                  }`}
                >
                  <AlertTriangle className="h-3.5 w-3.5" />
                  {item.status === 'error' ? 'Error' : 'Warning'}
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-1">{item.detail}</p>
          </div>
        ))}
      </section>
    </div>
  );
}

