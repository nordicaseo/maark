'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/components/auth/auth-provider';
import { hasRole } from '@/lib/permissions';
import { useActiveProject } from '@/hooks/use-active-project';
import { useProjectScopeSync } from '@/hooks/use-project-scope-sync';
import { withProjectScope } from '@/lib/project-context';
import {
  FolderOpen,
  Globe,
  Sparkles,
  Users,
  LayoutDashboard,
  ArrowLeft,
  LogOut,
  ShieldCheck,
} from 'lucide-react';

const PROJECT_ADMIN_ITEMS = [
  { href: '/admin', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/admin/projects', label: 'Projects', icon: FolderOpen },
  { href: '/admin/crawl-gsc', label: 'Crawl & GSC', icon: Globe },
  { href: '/admin/skills', label: 'Skills', icon: Sparkles },
  { href: '/admin/users', label: 'Users', icon: Users },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, isLoading, signOut } = useAuth();
  const { activeProjectId, setActiveProjectId } = useActiveProject();
  useProjectScopeSync(activeProjectId, setActiveProjectId);
  const shouldRedirect = !isLoading && (!user || !hasRole(user.role, 'admin'));
  const canAccessSystemAdmin = Boolean(user && hasRole(user.role, 'super_admin'));
  const navItems = [
    ...PROJECT_ADMIN_ITEMS,
    ...(canAccessSystemAdmin
      ? [{ href: '/super-admin', label: 'Super Admin', icon: ShieldCheck }]
      : []),
  ];

  useEffect(() => {
    if (shouldRedirect) {
      router.replace(withProjectScope('/documents', activeProjectId));
      return;
    }
    if (
      pathname.startsWith('/admin/agents') ||
      pathname.startsWith('/admin/ai') ||
      pathname.startsWith('/admin/observability')
    ) {
      if (user && canAccessSystemAdmin) {
        router.replace(pathname.replace('/admin', '/super-admin'));
        return;
      }
      if (user && !canAccessSystemAdmin) {
        router.replace('/admin');
        return;
      }
    }
  }, [shouldRedirect, router, activeProjectId, user, canAccessSystemAdmin, pathname]);

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
          {navItems.map((item) => {
            const href = item.href.startsWith('/admin')
              || item.href.startsWith('/super-admin')
              ? item.href
              : withProjectScope(item.href, activeProjectId);
            const isActive =
              item.href === '/admin'
                ? pathname === '/admin'
                : pathname.startsWith(item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={href}
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
            href={withProjectScope('/documents', activeProjectId)}
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
