// Re-export the correct schema based on environment
// In local dev (no POSTGRES_URL), we use SQLite
// In production (Vercel), we use Postgres

const isVercel = !!process.env.POSTGRES_URL;

let documents: any;
let serpCache: any;
let analysisSnapshots: any;
let users: any;
let projects: any;
let projectMembers: any;
let skills: any;
let aiProviders: any;
let aiModelConfig: any;
let documentComments: any;

if (isVercel) {
  const pg = require('./schema-pg');
  documents = pg.documents;
  serpCache = pg.serpCache;
  analysisSnapshots = pg.analysisSnapshots;
  users = pg.users;
  projects = pg.projects;
  projectMembers = pg.projectMembers;
  skills = pg.skills;
  aiProviders = pg.aiProviders;
  aiModelConfig = pg.aiModelConfig;
  documentComments = pg.documentComments;
} else {
  const sqlite = require('./schema-sqlite');
  documents = sqlite.documents;
  serpCache = sqlite.serpCache;
  analysisSnapshots = sqlite.analysisSnapshots;
  users = sqlite.users;
  projects = sqlite.projects;
  projectMembers = sqlite.projectMembers;
  skills = sqlite.skills;
  aiProviders = sqlite.aiProviders;
  aiModelConfig = sqlite.aiModelConfig;
  documentComments = sqlite.documentComments;
}

export {
  documents,
  serpCache,
  analysisSnapshots,
  users,
  projects,
  projectMembers,
  skills,
  aiProviders,
  aiModelConfig,
  documentComments,
};
