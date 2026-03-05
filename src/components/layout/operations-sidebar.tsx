'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ArrowLeft, FolderOpen, Globe, Search } from 'lucide-react';
import { ProjectSwitcher } from '@/components/projects/project-switcher';
import { withProjectScope } from '@/lib/project-context';

interface OperationsSidebarProps {
  activeProjectId: number | null;
  onProjectChange: (projectId: number | null) => void;
}

const OPERATIONS_ITEMS = [
  { href: '/keywords', label: 'Keywords', icon: Search },
  { href: '/pages', label: 'Pages', icon: Globe },
];

export function OperationsSidebar({
  activeProjectId,
  onProjectChange,
}: OperationsSidebarProps) {
  const pathname = usePathname();

  return (
    <aside className="w-60 border-r border-border bg-card flex flex-col">
      <div className="p-4 border-b border-border space-y-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Operations
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            Org scope or project scope
          </p>
        </div>
        <ProjectSwitcher
          activeProjectId={activeProjectId}
          onProjectChange={onProjectChange}
        />
      </div>

      <nav className="flex-1 p-2 space-y-1">
        {OPERATIONS_ITEMS.map((item) => {
          const Icon = item.icon;
          const href = withProjectScope(item.href, activeProjectId);
          const isActive = pathname.startsWith(item.href);
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

      <div className="p-2 border-t border-border">
        <Link
          href={withProjectScope('/documents', activeProjectId)}
          className="flex items-center gap-2 px-3 py-2 rounded-md text-sm text-muted-foreground hover:bg-accent/50 hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Editor
        </Link>
        <Link
          href={withProjectScope('/mission-control', activeProjectId)}
          className="flex items-center gap-2 px-3 py-2 rounded-md text-sm text-muted-foreground hover:bg-accent/50 hover:text-foreground"
        >
          <FolderOpen className="h-4 w-4" />
          Mission Control
        </Link>
      </div>
    </aside>
  );
}
