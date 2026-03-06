'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/components/auth/auth-provider';
import { hasRole } from '@/lib/permissions';
import { ArrowLeft, Bot, Cpu, LayoutDashboard, LogOut, Radar, ShieldCheck, Sparkles } from 'lucide-react';

const SYSTEM_ITEMS = [
  { href: '/super-admin', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/super-admin/agents', label: 'Agents', icon: Bot },
  { href: '/super-admin/templates', label: 'Templates', icon: Sparkles },
  { href: '/super-admin/ai', label: 'AI Models', icon: Cpu },
  { href: '/super-admin/observability', label: 'Observability', icon: Radar },
];

export default function SuperAdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, isLoading, signOut } = useAuth();
  const shouldRedirect = !isLoading && (!user || !hasRole(user.role, 'super_admin'));

  useEffect(() => {
    if (shouldRedirect) {
      router.replace('/documents');
    }
  }, [shouldRedirect, router]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <p className="text-muted-foreground text-sm">Loading...</p>
      </div>
    );
  }

  if (shouldRedirect) return null;

  return (
    <div className="flex h-screen bg-background">
      <aside className="w-56 border-r border-border bg-card flex flex-col">
        <div className="p-4 border-b border-border">
          <h1 className="text-lg font-bold flex items-center gap-2">
            <ShieldCheck className="h-4 w-4" />
            Super Admin
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {user?.name || user?.email}
          </p>
        </div>

        <nav className="flex-1 p-2 space-y-0.5">
          {SYSTEM_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive =
              item.href === '/super-admin'
                ? pathname === '/super-admin'
                : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors ${
                  isActive
                    ? 'bg-accent text-accent-foreground font-medium'
                    : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
                }`}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="p-2 border-t border-border space-y-0.5">
          <Link
            href="/admin"
            className="flex items-center gap-2 px-3 py-2 rounded-md text-sm text-muted-foreground hover:bg-accent/50 hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Admin
          </Link>
          <button
            onClick={() => signOut()}
            className="flex items-center gap-2 px-3 py-2 rounded-md text-sm text-muted-foreground hover:bg-accent/50 hover:text-foreground w-full text-left"
          >
            <LogOut className="h-4 w-4" />
            Sign Out
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-auto">
        <div className="max-w-5xl mx-auto p-6">{children}</div>
      </main>
    </div>
  );
}
