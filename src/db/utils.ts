/**
 * Returns the correct "now" value for the active database driver.
 * - PostgreSQL (Vercel): Date object (Drizzle timestamp columns expect Date)
 * - SQLite (local):      ISO string  (text columns store strings)
 */
export function dbNow(): any {
  return process.env.POSTGRES_URL ? new Date() : new Date().toISOString();
}
