'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Activity, Bot, Cpu, Radar, Rocket, ShieldCheck, Sparkles } from 'lucide-react';

interface Stats {
  providers: number;
}

export default function SuperAdminDashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    fetch('/api/admin/stats')
      .then((response) => (response.ok ? response.json() : null))
      .then(setStats)
      .catch(() => {});
  }, []);

  const cards = [
    { label: 'Workflow Ops', value: 'Live', icon: Activity, href: '/super-admin/workflow-ops' },
    { label: 'Agents', value: '8 roles', icon: Bot, href: '/super-admin/agents' },
    { label: 'Templates', value: 'Managed', icon: Sparkles, href: '/super-admin/templates' },
    { label: 'Launch Checklist', value: 'Ready', icon: Rocket, href: '/super-admin/launch-checklist' },
    { label: 'AI Providers', value: stats?.providers ?? '—', icon: Cpu, href: '/super-admin/ai' },
    { label: 'Observability', value: 'Live', icon: Radar, href: '/super-admin/observability' },
  ];

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6 flex items-center gap-2">
        <ShieldCheck className="h-6 w-6" />
        Super Admin Dashboard
      </h1>
      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <Link
              key={card.label}
              href={card.href}
              className="border border-border rounded-lg p-4 bg-card hover:bg-accent/30 transition-colors"
            >
              <div className="flex items-center gap-2 text-muted-foreground mb-2">
                <Icon className="h-4 w-4" />
                <span className="text-xs font-medium">{card.label}</span>
              </div>
              <p className="text-2xl font-bold">{card.value}</p>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
