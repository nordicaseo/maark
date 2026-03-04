export const ACTIVE_PROJECT_STORAGE_KEY = 'maark_activeProjectId';
export const ACTIVE_PROJECT_COOKIE_KEY = 'maark_active_project';
export const ACTIVE_PROJECT_QUERY_KEY = 'projectId';

export function parseProjectId(value: string | null | undefined): number | null {
  if (!value) return null;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function withProjectScope(path: string, projectId: number | null | undefined): string {
  if (!projectId) return path;
  const url = new URL(path, 'http://localhost');
  url.searchParams.set(ACTIVE_PROJECT_QUERY_KEY, String(projectId));
  const query = url.searchParams.toString();
  return `${url.pathname}${query ? `?${query}` : ''}${url.hash}`;
}
