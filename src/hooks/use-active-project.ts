'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  ACTIVE_PROJECT_STORAGE_KEY,
  ACTIVE_PROJECT_COOKIE_KEY,
  parseProjectId,
} from '@/lib/project-context';

const EVENT_NAME = 'maark:active-project-change';

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const parts = document.cookie
    .split(';')
    .map((p) => p.trim())
    .filter(Boolean);
  const found = parts.find((p) => p.startsWith(`${name}=`));
  if (!found) return null;
  return decodeURIComponent(found.slice(name.length + 1));
}

function writeProjectCookie(projectId: number | null) {
  if (typeof document === 'undefined') return;
  if (projectId === null) {
    document.cookie = `${ACTIVE_PROJECT_COOKIE_KEY}=; Path=/; Max-Age=0; SameSite=Lax`;
    return;
  }
  document.cookie = `${ACTIVE_PROJECT_COOKIE_KEY}=${encodeURIComponent(String(projectId))}; Path=/; Max-Age=31536000; SameSite=Lax`;
}

function readInitialProjectId(initialValue: number | null): number | null {
  if (typeof window === 'undefined') return initialValue;
  const fromStorage = parseProjectId(window.localStorage.getItem(ACTIVE_PROJECT_STORAGE_KEY));
  if (fromStorage !== null) return fromStorage;
  const fromCookie = parseProjectId(readCookie(ACTIVE_PROJECT_COOKIE_KEY));
  return fromCookie ?? initialValue;
}

export function useActiveProject(initialValue: number | null = null) {
  const [activeProjectId, setActiveProjectIdState] = useState<number | null>(() =>
    readInitialProjectId(initialValue)
  );

  useEffect(() => {
    const synced = readInitialProjectId(initialValue);
    const timeout = window.setTimeout(() => {
      setActiveProjectIdState((prev) => (prev === synced ? prev : synced));
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [initialValue]);

  const setActiveProjectId = useCallback((projectId: number | null) => {
    setActiveProjectIdState(projectId);
    if (typeof window !== 'undefined') {
      if (projectId === null) {
        window.localStorage.removeItem(ACTIVE_PROJECT_STORAGE_KEY);
      } else {
        window.localStorage.setItem(ACTIVE_PROJECT_STORAGE_KEY, String(projectId));
      }
      writeProjectCookie(projectId);
      window.dispatchEvent(
        new CustomEvent(EVENT_NAME, { detail: { projectId } })
      );
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const onStorage = (event: StorageEvent) => {
      if (event.key !== ACTIVE_PROJECT_STORAGE_KEY) return;
      setActiveProjectIdState(parseProjectId(event.newValue));
      writeProjectCookie(parseProjectId(event.newValue));
    };

    const onCustom = (event: Event) => {
      const customEvent = event as CustomEvent<{ projectId: number | null }>;
      setActiveProjectIdState(customEvent.detail?.projectId ?? null);
    };

    window.addEventListener('storage', onStorage);
    window.addEventListener(EVENT_NAME, onCustom as EventListener);

    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(EVENT_NAME, onCustom as EventListener);
    };
  }, []);

  return { activeProjectId, setActiveProjectId };
}
