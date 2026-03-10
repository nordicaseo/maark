'use client';

import { type ReactNode } from 'react';
import { AppSidebar } from './app-sidebar';
import { useActiveProject } from '@/hooks/use-active-project';
import { useProjectScopeSync } from '@/hooks/use-project-scope-sync';
import { cn } from '@/lib/utils';

interface MainLayoutProps {
  children: ReactNode;
  /** 'default' = scrollable main, 'editor' = flex overflow-hidden, 'fullscreen' = flex overflow-hidden */
  variant?: 'default' | 'editor' | 'fullscreen';
}

export function MainLayout({ children, variant = 'default' }: MainLayoutProps) {
  const { activeProjectId, setActiveProjectId } = useActiveProject();
  useProjectScopeSync(activeProjectId, setActiveProjectId);

  return (
    <div className="flex h-screen overflow-hidden">
      <AppSidebar activeProjectId={activeProjectId} onProjectChange={setActiveProjectId} />
      <main
        className={cn(
          'flex-1 min-w-0',
          variant === 'default' && 'overflow-y-auto',
          (variant === 'editor' || variant === 'fullscreen') && 'flex flex-col overflow-hidden',
        )}
      >
        {children}
      </main>
    </div>
  );
}
