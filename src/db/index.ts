const isVercel = !!process.env.POSTGRES_URL;

let _initPromise: Promise<void> | null = null;

async function initPostgres(sql: any) {
  // Auto-create tables on first use (no manual migration needed)
  await sql.query(`
    DO $$ BEGIN
      CREATE TYPE document_status AS ENUM ('draft','in_progress','review','published');
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;

    DO $$ BEGIN
      CREATE TYPE content_type AS ENUM ('blog_post','product_review','how_to_guide','listicle','comparison','news_article');
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;

    CREATE TABLE IF NOT EXISTS documents (
      id SERIAL PRIMARY KEY,
      title VARCHAR(500) NOT NULL DEFAULT 'Untitled',
      content JSONB,
      plain_text TEXT,
      status document_status NOT NULL DEFAULT 'draft',
      content_type content_type NOT NULL DEFAULT 'blog_post',
      target_keyword VARCHAR(300),
      word_count INTEGER DEFAULT 0,
      ai_detection_score REAL,
      ai_risk_level VARCHAR(20),
      semantic_score REAL,
      content_quality_score REAL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );

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
}

function createDb() {
  if (isVercel) {
    const { sql } = require('@vercel/postgres');
    const { drizzle } = require('drizzle-orm/vercel-postgres');
    const pgSchema = require('./schema-pg');

    // Run auto-migration once (fire-and-forget on cold start)
    if (!_initPromise) {
      _initPromise = initPostgres(sql).catch((err: any) =>
        console.error('DB init error:', err)
      );
    }

    return drizzle(sql, { schema: pgSchema });
  }

  const Database = require('better-sqlite3');
  const { drizzle } = require('drizzle-orm/better-sqlite3');
  const sqliteSchema = require('./schema-sqlite');
  const path = require('path');

  const dbPath = path.join(process.cwd(), 'local.db');
  const sqlite = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
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
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

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

  return drizzle(sqlite, { schema: sqliteSchema });
}

export const db = createDb() as any;
