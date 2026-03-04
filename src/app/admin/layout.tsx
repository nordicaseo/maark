'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/components/auth/auth-provider';
import { hasRole } from '@/lib/permissions';
import {
  FolderOpen,
  Sparkles,
  Cpu,
  Users,
  LayoutDashboard,
  ArrowLeft,
  LogOut,
  Eye,
  Kanban,
  Search,
  Globe,
  Radar,
} from 'lucide-react';

const NAV_ITEMS = [
  { href: '/admin', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/admin/projects', label: 'Projects', icon: FolderOpen },
  { href: '/admin/skills', label: 'Skills', icon: Sparkles },
  { href: '/admin/ai', label: 'AI Models', icon: Cpu },
  { href: '/admin/users', label: 'Users', icon: Users },
  { href: '/admin/observability', label: 'Observability', icon: Radar },
  { href: '/keywords', label: 'Keywords', icon: Search },
  { href: '/pages', label: 'Pages', icon: Globe },
  { href: '/mission-control', label: 'Mission Control', icon: Kanban },
  { href: '/review', label: 'Review', icon: Eye },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, isLoading, signOut } = useAuth();
  const shouldRedirect = !isLoading && (!user || !hasRole(user.role, 'admin'));

  useEffect(() => {
    if (shouldRedirect) {
      router.replace('/documents');
    }
  }, [shouldRedirect, router]);

  // Redirect non-admin users away from admin
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <p className="text-muted-foreground text-sm">Loading...</p>
      </div>
    );
  }

  if (shouldRedirect) {
    return null;
  }

  return (
    <div className="flex h-screen bg-background">
      {/* Sidebar */}
      <div className="w-56 border-r border-border bg-card flex flex-col">
        <div className="p-4 border-b border-border">
          <h1 className="text-lg font-bold">Maark Admin</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {user?.name || user?.email}
          </p>
        </div>

        <nav className="flex-1 p-2 space-y-0.5">
          {NAV_ITEMS.map((item) => {
            const isActive =
              item.href === '/admin'
                ? pathname === '/admin'
                : pathname.startsWith(item.href);
            const Icon = item.icon;
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
            href="/documents"
            className="flex items-center gap-2 px-3 py-2 rounded-md text-sm text-muted-foreground hover:bg-accent/50 hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Editor
          </Link>
          <button
            onClick={() => signOut()}
            className="flex items-center gap-2 px-3 py-2 rounded-md text-sm text-muted-foreground hover:bg-accent/50 hover:text-foreground w-full text-left"
          >
            <LogOut className="h-4 w-4" />
            Sign Out
          </button>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 overflow-auto">
        <div className="max-w-5xl mx-auto p-6">{children}</div>
      </div>
    </div>
  );
}
