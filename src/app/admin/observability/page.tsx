'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, ClipboardList, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

interface AuditLog {
  id: number;
  action: string;
  resourceType: string;
  resourceId: string | null;
  userId: string | null;
  projectId: number | null;
  severity: string;
  metadata: unknown;
  createdAt: string;
}

interface AlertEvent {
  id: number;
  source: string;
  eventType: string;
  severity: string;
  message: string;
  projectId: number | null;
  resourceId: string | null;
  metadata: unknown;
  createdAt: string;
  resolvedAt: string | null;
}

export default function ObservabilityPage() {
  const [loading, setLoading] = useState(true);
  const [audits, setAudits] = useState<AuditLog[]>([]);
  const [alerts, setAlerts] = useState<AlertEvent[]>([]);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/observability?limit=100');
      if (res.ok) {
        const data = await res.json();
        setAudits(data.audits || []);
        setAlerts(data.alerts || []);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Observability</h1>
          <p className="text-sm text-muted-foreground">
            Audit trail for admin/security events and runtime alerts.
          </p>
        </div>
        <Button variant="outline" onClick={() => void load()} disabled={loading}>
          {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          Refresh
        </Button>
      </div>

      <section className="border border-border rounded-lg bg-card overflow-hidden">
        <div className="px-4 py-3 border-b border-border text-sm font-semibold flex items-center gap-2">
          <AlertTriangle className="h-4 w-4" />
          Alerts ({alerts.length})
        </div>
        {loading ? (
          <div className="py-8 flex justify-center text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : alerts.length === 0 ? (
          <div className="py-8 text-sm text-muted-foreground text-center">No alerts found.</div>
        ) : (
          <div className="divide-y divide-border max-h-[360px] overflow-auto">
            {alerts.map((alert) => (
              <div key={alert.id} className="px-4 py-2.5 text-sm">
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">{alert.severity}</Badge>
                  <span className="font-medium">{alert.source}</span>
                  <span className="text-muted-foreground">{alert.eventType}</span>
                </div>
                <p className="mt-1">{alert.message}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {new Date(alert.createdAt).toLocaleString()} · project {alert.projectId ?? '—'} · resource {alert.resourceId ?? '—'}
                </p>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="border border-border rounded-lg bg-card overflow-hidden">
        <div className="px-4 py-3 border-b border-border text-sm font-semibold flex items-center gap-2">
          <ClipboardList className="h-4 w-4" />
          Audit Log ({audits.length})
        </div>
        {loading ? (
          <div className="py-8 flex justify-center text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : audits.length === 0 ? (
          <div className="py-8 text-sm text-muted-foreground text-center">No audit entries found.</div>
        ) : (
          <div className="divide-y divide-border max-h-[420px] overflow-auto">
            {audits.map((audit) => (
              <div key={audit.id} className="px-4 py-2.5 text-sm">
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">{audit.severity}</Badge>
                  <span className="font-medium">{audit.action}</span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {new Date(audit.createdAt).toLocaleString()} · user {audit.userId ?? '—'} ·
                  {' '}resource {audit.resourceType}:{audit.resourceId ?? '—'} ·
                  {' '}project {audit.projectId ?? '—'}
                </p>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
