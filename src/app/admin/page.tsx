'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { FolderOpen, Sparkles, Users, Bot, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/components/auth/auth-provider';
import { hasRole } from '@/lib/permissions';

interface Stats {
  projects: number;
  skills: number;
  users: number;
}

export default function AdminDashboard() {
  const { user } = useAuth();
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    fetch('/api/admin/stats')
      .then((r) => (r.ok ? r.json() : null))
      .then(setStats)
      .catch(() => {});
  }, []);

  const cards = [
    { label: 'Projects', value: stats?.projects ?? '—', icon: FolderOpen, href: '/admin/projects' },
    { label: 'Skills', value: stats?.skills ?? '—', icon: Sparkles, href: '/admin/skills' },
    { label: 'Users', value: stats?.users ?? '—', icon: Users, href: '/admin/users' },
  ];
  if (user && hasRole(user.role, 'super_admin')) {
    cards.push(
      { label: 'Super Admin', value: 'System', icon: ShieldCheck, href: '/super-admin' },
      { label: 'Agents', value: '8 roles', icon: Bot, href: '/super-admin/agents' },
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Dashboard</h1>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
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
