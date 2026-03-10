'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  ChevronDown,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  LogOut,
  Settings,
  ShieldCheck,
} from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { ProjectSwitcher } from '@/components/projects/project-switcher';
import { useAuth } from '@/components/auth/auth-provider';
import { hasRole } from '@/lib/permissions';
import { withProjectScope } from '@/lib/project-context';
import { SIDEBAR_SECTIONS, type SidebarSection, type SidebarItem } from './sidebar-config';
import { useSidebarState } from '@/hooks/use-sidebar-state';
import { cn } from '@/lib/utils';

interface AppSidebarProps {
  activeProjectId: number | null;
  onProjectChange: (projectId: number | null) => void;
}

export function AppSidebar({ activeProjectId, onProjectChange }: AppSidebarProps) {
  const pathname = usePathname();
  const { user, signOut } = useAuth();
  const { collapsedSections, toggleSection, isCollapsed, toggleCollapsed } = useSidebarState();

  const checkActive = (item: SidebarItem): boolean => {
    if (item.disabled) return false;
    if (pathname === item.href) return true;
    if (item.href !== '/' && pathname.startsWith(item.href)) return true;
    if (item.matchPaths?.some((p) => pathname.startsWith(p))) return true;
    return false;
  };

  const checkVisible = (item: SidebarItem): boolean => {
    if (!item.requiredRole) return true;
    if (!user) return false;
    return hasRole(user.role, item.requiredRole);
  };

  const canAccessAdmin = Boolean(user && hasRole(user.role, 'admin'));
  const canAccessSuperAdmin = Boolean(user && hasRole(user.role, 'super_admin'));

  return (
    <aside
      className={cn(
        'h-full border-r flex flex-col shrink-0 transition-all duration-200',
        isCollapsed ? 'w-14' : 'w-60',
      )}
      style={{
        background: 'var(--sidebar)',
        borderColor: 'var(--sidebar-border)',
        color: 'var(--sidebar-foreground)',
      }}
    >
      {/* ── Brand + Collapse Toggle ── */}
      <div
        className="h-12 flex items-center px-3 shrink-0 border-b"
        style={{ borderColor: 'var(--sidebar-border)' }}
      >
        {!isCollapsed && (
          <span className="font-bold text-sm tracking-tight" style={{ color: 'var(--sidebar-foreground)' }}>
            Maark
          </span>
        )}
        <button
          type="button"
          onClick={toggleCollapsed}
          className="ml-auto p-1.5 rounded-md transition-colors"
          style={{ color: 'color-mix(in srgb, var(--sidebar-foreground) 50%, transparent)' }}
          title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {isCollapsed ? <ChevronsRight className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}
        </button>
      </div>

      {/* ── Scrollable Navigation ── */}
      <ScrollArea className="flex-1">
        <div className="p-2 space-y-1">
          {SIDEBAR_SECTIONS.map((section) => (
            <SidebarSectionGroup
              key={section.id}
              section={section}
              sidebarCollapsed={isCollapsed}
              sectionCollapsed={!!collapsedSections[section.id]}
              onToggleSection={() => toggleSection(section.id)}
              activeProjectId={activeProjectId}
              checkActive={checkActive}
              checkVisible={checkVisible}
            />
          ))}
        </div>
      </ScrollArea>

      {/* ── Pinned Bottom ── */}
      <div className="mt-auto border-t p-2 space-y-1" style={{ borderColor: 'var(--sidebar-border)' }}>
        {/* Project Switcher */}
        {!isCollapsed && (
          <div className="px-1 py-1">
            <ProjectSwitcher activeProjectId={activeProjectId} onProjectChange={onProjectChange} />
          </div>
        )}

        <Separator style={{ background: 'var(--sidebar-border)' }} />

        {/* Admin Links */}
        {canAccessAdmin && (
          <Link
            href="/admin"
            className={cn(
              'flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors',
              pathname.startsWith('/admin')
                ? 'font-medium'
                : '',
            )}
            style={{
              color: pathname.startsWith('/admin')
                ? 'var(--sidebar-accent-foreground)'
                : 'color-mix(in srgb, var(--sidebar-foreground) 60%, transparent)',
              background: pathname.startsWith('/admin') ? 'var(--sidebar-accent)' : undefined,
            }}
            title={isCollapsed ? 'Settings' : undefined}
          >
            <Settings className="h-4 w-4 shrink-0" />
            {!isCollapsed && 'Settings'}
          </Link>
        )}
        {canAccessSuperAdmin && (
          <Link
            href="/super-admin"
            className={cn(
              'flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors',
              pathname.startsWith('/super-admin')
                ? 'font-medium'
                : '',
            )}
            style={{
              color: pathname.startsWith('/super-admin')
                ? 'var(--sidebar-accent-foreground)'
                : 'color-mix(in srgb, var(--sidebar-foreground) 60%, transparent)',
              background: pathname.startsWith('/super-admin') ? 'var(--sidebar-accent)' : undefined,
            }}
            title={isCollapsed ? 'Super Admin' : undefined}
          >
            <ShieldCheck className="h-4 w-4 shrink-0" />
            {!isCollapsed && 'Super Admin'}
          </Link>
        )}

        {/* User / Sign Out */}
        <div className="flex items-center gap-2 px-3 py-2">
          {!isCollapsed && user && (
            <span
              className="text-xs truncate flex-1"
              style={{ color: 'color-mix(in srgb, var(--sidebar-foreground) 50%, transparent)' }}
            >
              {user.name || user.email}
            </span>
          )}
          <button
            type="button"
            onClick={() => signOut()}
            className="p-1 rounded transition-colors hover:opacity-80"
            title="Sign out"
            style={{ color: 'color-mix(in srgb, var(--sidebar-foreground) 50%, transparent)' }}
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </aside>
  );
}

/* ── Section Group ── */

function SidebarSectionGroup({
  section,
  sidebarCollapsed,
  sectionCollapsed,
  onToggleSection,
  activeProjectId,
  checkActive,
  checkVisible,
}: {
  section: SidebarSection;
  sidebarCollapsed: boolean;
  sectionCollapsed: boolean;
  onToggleSection: () => void;
  activeProjectId: number | null;
  checkActive: (item: SidebarItem) => boolean;
  checkVisible: (item: SidebarItem) => boolean;
}) {
  const visibleItems = section.items.filter(checkVisible);
  if (visibleItems.length === 0) return null;

  const hasHeader = Boolean(section.label);

  return (
    <div className={hasHeader ? 'mt-3' : ''}>
      {/* Section header */}
      {hasHeader && !sidebarCollapsed && (
        <button
          type="button"
          onClick={section.collapsible ? onToggleSection : undefined}
          className={cn(
            'flex items-center w-full px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider transition-colors',
            section.collapsible && 'cursor-pointer hover:opacity-80',
          )}
          style={{ color: 'color-mix(in srgb, var(--sidebar-foreground) 35%, transparent)' }}
        >
          {section.collapsible && (
            sectionCollapsed
              ? <ChevronRight className="h-3 w-3 mr-1 shrink-0" />
              : <ChevronDown className="h-3 w-3 mr-1 shrink-0" />
          )}
          {section.label}
        </button>
      )}

      {/* Collapsed divider in icon-only mode */}
      {hasHeader && sidebarCollapsed && (
        <div className="mx-2 my-2">
          <Separator style={{ background: 'var(--sidebar-border)' }} />
        </div>
      )}

      {/* Items (hidden when section collapsed, unless sidebar is in icon-only mode) */}
      <div
        className={cn(
          'overflow-hidden transition-all duration-200',
          !sidebarCollapsed && sectionCollapsed ? 'max-h-0 opacity-0' : 'max-h-[600px] opacity-100',
        )}
      >
        {visibleItems.map((item) => (
          <SidebarNavItem
            key={item.id}
            item={item}
            isActive={checkActive(item)}
            sidebarCollapsed={sidebarCollapsed}
            activeProjectId={activeProjectId}
          />
        ))}
      </div>
    </div>
  );
}

/* ── Individual Nav Item ── */

function SidebarNavItem({
  item,
  isActive,
  sidebarCollapsed,
  activeProjectId,
}: {
  item: SidebarItem;
  isActive: boolean;
  sidebarCollapsed: boolean;
  activeProjectId: number | null;
}) {
  const Icon = item.icon;

  if (item.disabled) {
    return (
      <span
        className={cn(
          'flex items-center gap-2 px-3 py-2 rounded-md text-sm cursor-not-allowed',
          sidebarCollapsed && 'justify-center px-0',
        )}
        style={{ color: 'color-mix(in srgb, var(--sidebar-foreground) 25%, transparent)' }}
        title={item.tooltip || 'Coming soon'}
      >
        <Icon className="h-4 w-4 shrink-0" />
        {!sidebarCollapsed && (
          <>
            <span className="truncate flex-1">{item.label}</span>
            <span
              className="text-[9px] uppercase tracking-wider ml-auto shrink-0"
              style={{ opacity: 0.6 }}
            >
              Soon
            </span>
          </>
        )}
      </span>
    );
  }

  const href = withProjectScope(item.href, activeProjectId);

  return (
    <Link
      href={href}
      className={cn(
        'flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors',
        sidebarCollapsed && 'justify-center px-0',
        isActive ? 'font-medium' : '',
      )}
      style={{
        color: isActive
          ? 'var(--sidebar-accent-foreground)'
          : 'color-mix(in srgb, var(--sidebar-foreground) 65%, transparent)',
        background: isActive ? 'var(--sidebar-accent)' : undefined,
      }}
      title={sidebarCollapsed ? item.label : undefined}
    >
      <Icon className="h-4 w-4 shrink-0" />
      {!sidebarCollapsed && <span className="truncate">{item.label}</span>}
    </Link>
  );
}
