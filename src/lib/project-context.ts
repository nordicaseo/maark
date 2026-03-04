export const ACTIVE_PROJECT_STORAGE_KEY = 'maark_activeProjectId';
export const ACTIVE_PROJECT_COOKIE_KEY = 'maark_active_project';

export function parseProjectId(value: string | null | undefined): number | null {
  if (!value) return null;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : null;
}
