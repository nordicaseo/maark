const isVercel = !!process.env.POSTGRES_URL;

let _initPromise: Promise<void> | null = null;

async function initPostgres(sql: { query: (statement: string) => Promise<unknown> }) {
  // ── Enums ──
  await sql.query(`
    DO $$ BEGIN
      CREATE TYPE document_status AS ENUM ('draft','in_progress','review','accepted','published','publish','live');
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `);

  // ── Users ──
  await sql.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name VARCHAR(200),
      email VARCHAR(300) NOT NULL UNIQUE,
      image TEXT,
      role VARCHAR(30) NOT NULL DEFAULT 'writer',
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  // ── Projects ──
  await sql.query(`
    CREATE TABLE IF NOT EXISTS projects (
      id SERIAL PRIMARY KEY,
      name VARCHAR(200) NOT NULL,
      description TEXT,
      default_content_format VARCHAR(50) DEFAULT 'blog_post',
      brand_voice TEXT,
      settings JSONB,
      created_by_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS project_members (
      id SERIAL PRIMARY KEY,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role VARCHAR(30) DEFAULT 'writer',
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS project_members_unique ON project_members(project_id, user_id);
  `);

  // ── Documents (with new columns) ──
  await sql.query(`
    CREATE TABLE IF NOT EXISTS documents (
      id SERIAL PRIMARY KEY,
      project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
      author_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      title VARCHAR(500) NOT NULL DEFAULT 'Untitled',
      content JSONB,
      plain_text TEXT,
      status document_status NOT NULL DEFAULT 'draft',
      content_type VARCHAR(50) NOT NULL DEFAULT 'blog_post',
      target_keyword VARCHAR(300),
      word_count INTEGER DEFAULT 0,
      ai_detection_score REAL,
      ai_risk_level VARCHAR(20),
      semantic_score REAL,
      content_quality_score REAL,
      research_snapshot JSONB,
      outline_snapshot JSONB,
      prewrite_checklist JSONB,
      agent_questions JSONB,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  // ── Migrate: Add new columns to existing documents table if they don't exist ──
  await sql.query(`
    ALTER TABLE documents ADD COLUMN IF NOT EXISTS project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL;
    ALTER TABLE documents ADD COLUMN IF NOT EXISTS author_id TEXT REFERENCES users(id) ON DELETE SET NULL;
    ALTER TABLE documents ADD COLUMN IF NOT EXISTS research_snapshot JSONB;
    ALTER TABLE documents ADD COLUMN IF NOT EXISTS outline_snapshot JSONB;
    ALTER TABLE documents ADD COLUMN IF NOT EXISTS prewrite_checklist JSONB;
    ALTER TABLE documents ADD COLUMN IF NOT EXISTS agent_questions JSONB;
  `);

  // ── Migrate: Convert content_type from enum to varchar if it's still enum ──
  await sql.query(`
    DO $$ BEGIN
      ALTER TABLE documents ALTER COLUMN content_type TYPE VARCHAR(50) USING content_type::VARCHAR(50);
    EXCEPTION WHEN others THEN NULL;
    END $$;
  `);

  // ── Migrate: Remap old content type values ──
  await sql.query(`
    UPDATE documents SET content_type = 'blog_review' WHERE content_type = 'product_review';
    UPDATE documents SET content_type = 'blog_how_to' WHERE content_type = 'how_to_guide';
    UPDATE documents SET content_type = 'blog_listicle' WHERE content_type = 'listicle';
  `);

  // ── Drop old enum if exists ──
  await sql.query(`
    DROP TYPE IF EXISTS content_type;
  `);

  // ── Migrate: Add publish + live status values ──
  await sql.query(`
    DO $$ BEGIN ALTER TYPE document_status ADD VALUE IF NOT EXISTS 'accepted'; EXCEPTION WHEN others THEN NULL; END $$;
    DO $$ BEGIN ALTER TYPE document_status ADD VALUE IF NOT EXISTS 'publish'; EXCEPTION WHEN others THEN NULL; END $$;
    DO $$ BEGIN ALTER TYPE document_status ADD VALUE IF NOT EXISTS 'live'; EXCEPTION WHEN others THEN NULL; END $$;
  `);
  await sql.query(`
    UPDATE documents SET status = 'live' WHERE status = 'published';
  `);

  // ── SERP Cache ──
  await sql.query(`
    CREATE TABLE IF NOT EXISTS serp_cache (
      id SERIAL PRIMARY KEY,
      keyword VARCHAR(300) NOT NULL UNIQUE,
      entities JSONB NOT NULL,
      lsi_keywords JSONB NOT NULL,
      top_urls JSONB NOT NULL,
      fetched_at TIMESTAMP NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS analysis_snapshots (
      id SERIAL PRIMARY KEY,
      document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      analysis_type VARCHAR(50) NOT NULL,
      result_data JSONB NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  // ── Migrate: Add preview_token column ──
  await sql.query(`
    ALTER TABLE documents ADD COLUMN IF NOT EXISTS preview_token TEXT;
  `);

  // ── Document Comments ──
  await sql.query(`
    CREATE TABLE IF NOT EXISTS document_comments (
      id SERIAL PRIMARY KEY,
      document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      preview_token TEXT NOT NULL,
      author_name VARCHAR(200) NOT NULL,
      content TEXT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  // ── Migrate: Add inline comment columns to document_comments ──
  await sql.query(`
    ALTER TABLE document_comments ADD COLUMN IF NOT EXISTS quoted_text TEXT;
    ALTER TABLE document_comments ADD COLUMN IF NOT EXISTS selection_from INTEGER;
    ALTER TABLE document_comments ADD COLUMN IF NOT EXISTS selection_to INTEGER;
    ALTER TABLE document_comments ADD COLUMN IF NOT EXISTS is_resolved INTEGER DEFAULT 0;
  `);

  // ── Skills ──
  await sql.query(`
    CREATE TABLE IF NOT EXISTS skills (
      id SERIAL PRIMARY KEY,
      project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
      name VARCHAR(300) NOT NULL,
      description TEXT,
      content TEXT NOT NULL,
      is_global INTEGER DEFAULT 0,
      created_by_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  // ── Skill Parts ──
  await sql.query(`
    CREATE TABLE IF NOT EXISTS skill_parts (
      id SERIAL PRIMARY KEY,
      skill_id INTEGER NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
      part_type VARCHAR(50) NOT NULL DEFAULT 'custom',
      label VARCHAR(200) NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  // ── AI Providers & Model Config ──
  await sql.query(`
    CREATE TABLE IF NOT EXISTS ai_providers (
      id SERIAL PRIMARY KEY,
      name VARCHAR(50) NOT NULL,
      display_name VARCHAR(100),
      api_key TEXT NOT NULL,
      is_active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS ai_model_config (
      id SERIAL PRIMARY KEY,
      action VARCHAR(50) NOT NULL UNIQUE,
      provider_id INTEGER NOT NULL REFERENCES ai_providers(id) ON DELETE CASCADE,
      model VARCHAR(100) NOT NULL,
      max_tokens INTEGER DEFAULT 4096,
      temperature REAL DEFAULT 1.0,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  // ── Invitations ──
  await sql.query(`
    CREATE TABLE IF NOT EXISTS invitations (
      id SERIAL PRIMARY KEY,
      email VARCHAR(300),
      role VARCHAR(30) NOT NULL DEFAULT 'writer',
      token TEXT NOT NULL UNIQUE,
      invited_by_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      expires_at TIMESTAMP NOT NULL,
      accepted_at TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  // ── Keywords ──
  await sql.query(`
    CREATE TABLE IF NOT EXISTS keywords (
      id SERIAL PRIMARY KEY,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      keyword VARCHAR(500) NOT NULL,
      intent VARCHAR(50) NOT NULL DEFAULT 'informational',
      status VARCHAR(50) NOT NULL DEFAULT 'new',
      priority VARCHAR(30) NOT NULL DEFAULT 'medium',
      owner_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      volume INTEGER,
      difficulty INTEGER,
      target_url TEXT,
      notes TEXT,
      last_task_id TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS keywords_project_keyword_unique
      ON keywords(project_id, keyword);
  `);

  // ── Pages & Crawl snapshots/issues ──
  await sql.query(`
    CREATE TABLE IF NOT EXISTS pages (
      id SERIAL PRIMARY KEY,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      url TEXT NOT NULL,
      title TEXT,
      canonical_url TEXT,
      http_status INTEGER,
      is_indexable INTEGER DEFAULT 1,
      is_verified INTEGER DEFAULT 0,
      response_time_ms INTEGER,
      content_hash TEXT,
      last_crawled_at TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS pages_project_url_unique
      ON pages(project_id, url);

    CREATE TABLE IF NOT EXISTS page_snapshots (
      id SERIAL PRIMARY KEY,
      page_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
      http_status INTEGER,
      canonical_url TEXT,
      meta_robots TEXT,
      is_indexable INTEGER DEFAULT 1,
      is_verified INTEGER DEFAULT 0,
      response_time_ms INTEGER,
      seo_score REAL,
      issues_count INTEGER DEFAULT 0,
      snapshot_data JSONB,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS page_issues (
      id SERIAL PRIMARY KEY,
      page_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
      snapshot_id INTEGER REFERENCES page_snapshots(id) ON DELETE SET NULL,
      issue_type VARCHAR(120) NOT NULL,
      severity VARCHAR(20) NOT NULL DEFAULT 'medium',
      message TEXT NOT NULL,
      is_open INTEGER DEFAULT 1,
      metadata JSONB,
      first_seen_at TIMESTAMP NOT NULL DEFAULT NOW(),
      last_seen_at TIMESTAMP NOT NULL DEFAULT NOW(),
      resolved_at TIMESTAMP
    );
  `);

  // ── Observability tables ──
  await sql.query(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id SERIAL PRIMARY KEY,
      user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      action VARCHAR(120) NOT NULL,
      resource_type VARCHAR(60) NOT NULL,
      resource_id TEXT,
      project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
      severity VARCHAR(20) NOT NULL DEFAULT 'info',
      metadata JSONB,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS alert_events (
      id SERIAL PRIMARY KEY,
      source VARCHAR(80) NOT NULL,
      event_type VARCHAR(120) NOT NULL,
      severity VARCHAR(20) NOT NULL DEFAULT 'warning',
      message TEXT NOT NULL,
      project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
      resource_id TEXT,
      metadata JSONB,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      resolved_at TIMESTAMP
    );
  `);
}

function addColumnSafe(
  sqlite: { exec: (statement: string) => void },
  table: string,
  column: string,
  type: string
) {
  try {
    sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  } catch {
    // Column already exists
  }
}

function createDb() {
  if (isVercel) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { sql } = require('@vercel/postgres');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { drizzle } = require('drizzle-orm/vercel-postgres');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pgSchema = require('./schema-pg');

    if (!_initPromise) {
      _initPromise = initPostgres(sql).catch((err: unknown) => {
        console.error('DB init error:', err);
        _initPromise = null;
      });
    }

    return drizzle(sql, { schema: pgSchema });
  }

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Database = require('better-sqlite3');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { drizzle } = require('drizzle-orm/better-sqlite3');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const sqliteSchema = require('./schema-sqlite');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require('path');

  const dbPath = path.join(process.cwd(), 'local.db');
  const sqlite = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');

  // ── Auth tables ──
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT,
      email TEXT NOT NULL UNIQUE,
      image TEXT,
      role TEXT NOT NULL DEFAULT 'writer',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // ── Projects ──
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      default_content_format TEXT DEFAULT 'blog_post',
      brand_voice TEXT,
      settings TEXT,
      created_by_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS project_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT DEFAULT 'writer',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS project_members_unique ON project_members(project_id, user_id);
  `);

  // ── Documents ──
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
      author_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      title TEXT NOT NULL DEFAULT 'Untitled',
      content TEXT,
      plain_text TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      content_type TEXT NOT NULL DEFAULT 'blog_post',
      target_keyword TEXT,
      word_count INTEGER DEFAULT 0,
      ai_detection_score REAL,
      ai_risk_level TEXT,
      semantic_score REAL,
      content_quality_score REAL,
      research_snapshot TEXT,
      outline_snapshot TEXT,
      prewrite_checklist TEXT,
      agent_questions TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // ── Migrate: Add new columns to existing documents table ──
  addColumnSafe(sqlite, 'documents', 'project_id', "INTEGER REFERENCES projects(id) ON DELETE SET NULL");
  addColumnSafe(sqlite, 'documents', 'author_id', "TEXT REFERENCES users(id) ON DELETE SET NULL");
  addColumnSafe(sqlite, 'documents', 'preview_token', "TEXT");
  addColumnSafe(sqlite, 'documents', 'research_snapshot', "TEXT");
  addColumnSafe(sqlite, 'documents', 'outline_snapshot', "TEXT");
  addColumnSafe(sqlite, 'documents', 'prewrite_checklist', "TEXT");
  addColumnSafe(sqlite, 'documents', 'agent_questions', "TEXT");

  // ── Migrate: Remap old content type values ──
  sqlite.exec(`
    UPDATE documents SET content_type = 'blog_review' WHERE content_type = 'product_review';
    UPDATE documents SET content_type = 'blog_how_to' WHERE content_type = 'how_to_guide';
    UPDATE documents SET content_type = 'blog_listicle' WHERE content_type = 'listicle';
  `);

  // ── SERP Cache & Analysis ──
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS serp_cache (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      keyword TEXT NOT NULL UNIQUE,
      entities TEXT NOT NULL,
      lsi_keywords TEXT NOT NULL,
      top_urls TEXT NOT NULL,
      fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS analysis_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      analysis_type TEXT NOT NULL,
      result_data TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // ── Document Comments ──
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS document_comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      preview_token TEXT NOT NULL,
      author_name TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // ── Migrate: Add inline comment columns to document_comments ──
  addColumnSafe(sqlite, 'document_comments', 'quoted_text', 'TEXT');
  addColumnSafe(sqlite, 'document_comments', 'selection_from', 'INTEGER');
  addColumnSafe(sqlite, 'document_comments', 'selection_to', 'INTEGER');
  addColumnSafe(sqlite, 'document_comments', 'is_resolved', 'INTEGER DEFAULT 0');

  // ── Skills ──
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS skills (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT,
      content TEXT NOT NULL,
      is_global INTEGER DEFAULT 0,
      created_by_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // ── Skill Parts ──
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS skill_parts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      skill_id INTEGER NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
      part_type TEXT NOT NULL DEFAULT 'custom',
      label TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // ── AI Providers & Model Config ──
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS ai_providers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      display_name TEXT,
      api_key TEXT NOT NULL,
      is_active INTEGER DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS ai_model_config (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action TEXT NOT NULL UNIQUE,
      provider_id INTEGER NOT NULL REFERENCES ai_providers(id) ON DELETE CASCADE,
      model TEXT NOT NULL,
      max_tokens INTEGER DEFAULT 4096,
      temperature REAL DEFAULT 1.0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // ── Invitations ──
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS invitations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT,
      role TEXT NOT NULL DEFAULT 'writer',
      token TEXT NOT NULL UNIQUE,
      invited_by_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      expires_at TEXT NOT NULL,
      accepted_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // ── Keywords ──
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS keywords (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      keyword TEXT NOT NULL,
      intent TEXT NOT NULL DEFAULT 'informational',
      status TEXT NOT NULL DEFAULT 'new',
      priority TEXT NOT NULL DEFAULT 'medium',
      owner_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      volume INTEGER,
      difficulty INTEGER,
      target_url TEXT,
      notes TEXT,
      last_task_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS keywords_project_keyword_unique ON keywords(project_id, keyword);
  `);

  // ── Pages & Crawl snapshots/issues ──
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS pages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      url TEXT NOT NULL,
      title TEXT,
      canonical_url TEXT,
      http_status INTEGER,
      is_indexable INTEGER DEFAULT 1,
      is_verified INTEGER DEFAULT 0,
      response_time_ms INTEGER,
      content_hash TEXT,
      last_crawled_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS pages_project_url_unique ON pages(project_id, url);

    CREATE TABLE IF NOT EXISTS page_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      page_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
      http_status INTEGER,
      canonical_url TEXT,
      meta_robots TEXT,
      is_indexable INTEGER DEFAULT 1,
      is_verified INTEGER DEFAULT 0,
      response_time_ms INTEGER,
      seo_score REAL,
      issues_count INTEGER DEFAULT 0,
      snapshot_data TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS page_issues (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      page_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
      snapshot_id INTEGER REFERENCES page_snapshots(id) ON DELETE SET NULL,
      issue_type TEXT NOT NULL,
      severity TEXT NOT NULL DEFAULT 'medium',
      message TEXT NOT NULL,
      is_open INTEGER DEFAULT 1,
      metadata TEXT,
      first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
      resolved_at TEXT
    );
  `);

  // ── Observability tables ──
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      action TEXT NOT NULL,
      resource_type TEXT NOT NULL,
      resource_id TEXT,
      project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
      severity TEXT NOT NULL DEFAULT 'info',
      metadata TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS alert_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL,
      event_type TEXT NOT NULL,
      severity TEXT NOT NULL DEFAULT 'warning',
      message TEXT NOT NULL,
      project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
      resource_id TEXT,
      metadata TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      resolved_at TEXT
    );
  `);

  return drizzle(sqlite, { schema: sqliteSchema });
}

// The DB client is runtime-selected (Postgres on Vercel, SQLite locally),
// so we intentionally expose a unified untyped surface to app routes.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const db = createDb() as any;

/**
 * Await this before any DB query in API routes.
 * Ensures Postgres tables exist before the first query runs.
 * No-op for SQLite (tables created synchronously above).
 */
export async function ensureDb() {
  if (_initPromise) await _initPromise;
}
