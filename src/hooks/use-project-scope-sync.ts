'use client';

import { useEffect, useRef } from 'react';
import { ACTIVE_PROJECT_QUERY_KEY, parseProjectId } from '@/lib/project-context';

export function useProjectScopeSync(
  activeProjectId: number | null,
  setActiveProjectId: (projectId: number | null) => void
) {
  const lastAppliedSearchRef = useRef<string | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const currentSearch = window.location.search;
    if (lastAppliedSearchRef.current === currentSearch) return;
    lastAppliedSearchRef.current = currentSearch;

    const projectIdFromQuery = parseProjectId(
      new URLSearchParams(currentSearch).get(ACTIVE_PROJECT_QUERY_KEY)
    );
    if (projectIdFromQuery === null) return;
    if (projectIdFromQuery !== activeProjectId) {
      setActiveProjectId(projectIdFromQuery);
    }
  });
}
