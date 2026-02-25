// Re-export the correct schema based on environment
// In local dev (no POSTGRES_URL), we use SQLite
// In production (Vercel), we use Postgres

const isVercel = !!process.env.POSTGRES_URL;

let documents: any;
let serpCache: any;
let analysisSnapshots: any;

if (isVercel) {
  const pg = require('./schema-pg');
  documents = pg.documents;
  serpCache = pg.serpCache;
  analysisSnapshots = pg.analysisSnapshots;
} else {
  const sqlite = require('./schema-sqlite');
  documents = sqlite.documents;
  serpCache = sqlite.serpCache;
  analysisSnapshots = sqlite.analysisSnapshots;
}

export { documents, serpCache, analysisSnapshots };
