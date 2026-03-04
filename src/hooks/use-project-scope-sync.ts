'use client';

import { useEffect } from 'react';
import { ACTIVE_PROJECT_QUERY_KEY, parseProjectId } from '@/lib/project-context';

export function useProjectScopeSync(
  activeProjectId: number | null,
  setActiveProjectId: (projectId: number | null) => void
) {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const projectIdFromQuery = parseProjectId(
      new URLSearchParams(window.location.search).get(ACTIVE_PROJECT_QUERY_KEY)
    );
    if (projectIdFromQuery === null) return;
    if (projectIdFromQuery !== activeProjectId) {
      setActiveProjectId(projectIdFromQuery);
    }
  }, [activeProjectId, setActiveProjectId]);
}
