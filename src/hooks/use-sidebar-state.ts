'use client';

import { useState, useCallback, useEffect } from 'react';

const SECTIONS_KEY = 'maark_sidebar_sections';
const COLLAPSED_KEY = 'maark_sidebar_collapsed';

export function useSidebarState() {
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>(() => {
    if (typeof window === 'undefined') return {};
    try {
      const stored = localStorage.getItem(SECTIONS_KEY);
      return stored ? JSON.parse(stored) : {};
    } catch {
      return {};
    }
  });

  const [isCollapsed, setIsCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem(COLLAPSED_KEY) === 'true';
  });

  useEffect(() => {
    try {
      localStorage.setItem(SECTIONS_KEY, JSON.stringify(collapsedSections));
    } catch {}
  }, [collapsedSections]);

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSED_KEY, String(isCollapsed));
    } catch {}
  }, [isCollapsed]);

  const toggleSection = useCallback((sectionId: string) => {
    setCollapsedSections((prev) => ({ ...prev, [sectionId]: !prev[sectionId] }));
  }, []);

  const toggleCollapsed = useCallback(() => {
    setIsCollapsed((prev) => !prev);
  }, []);

  return { collapsedSections, toggleSection, isCollapsed, toggleCollapsed };
}
