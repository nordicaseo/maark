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

  // ── Project Agent Profiles ──
  await sql.query(`
    DO $$ BEGIN
      CREATE TABLE project_agent_profiles (
        id SERIAL PRIMARY KEY,
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        role VARCHAR(60) NOT NULL,
        display_name VARCHAR(200) NOT NULL,
        emoji VARCHAR(16),
        mission TEXT,
        is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
        file_bundle JSONB,
        skill_ids JSONB,
        model_overrides JSONB,
        heartbeat_meta JSONB,
        created_by_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        updated_by_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    EXCEPTION WHEN duplicate_table THEN NULL;
    END $$;

    DO $$ BEGIN
      CREATE UNIQUE INDEX project_agent_profiles_unique_project_role
        ON project_agent_profiles(project_id, role);
    EXCEPTION WHEN duplicate_table OR duplicate_object THEN NULL;
    END $$;

    DO $$ BEGIN
      CREATE TABLE agent_shared_profiles (
        id SERIAL PRIMARY KEY,
        key VARCHAR(120) NOT NULL UNIQUE,
        content TEXT NOT NULL DEFAULT '',
        updated_by_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    EXCEPTION WHEN duplicate_table THEN NULL;
    END $$;
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
      project_ids JSONB,
      project_role VARCHAR(30),
      token TEXT NOT NULL UNIQUE,
      invited_by_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      expires_at TIMESTAMP NOT NULL,
      accepted_at TIMESTAMP,
      revoked_at TIMESTAMP,
      last_sent_at TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);
  await sql.query(`
    ALTER TABLE invitations ADD COLUMN IF NOT EXISTS project_ids JSONB;
    ALTER TABLE invitations ADD COLUMN IF NOT EXISTS project_role VARCHAR(30);
    ALTER TABLE invitations ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMP;
    ALTER TABLE invitations ADD COLUMN IF NOT EXISTS last_sent_at TIMESTAMP;
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

  // ── Sites ──
  await sql.query(`
    CREATE TABLE IF NOT EXISTS sites (
      id SERIAL PRIMARY KEY,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      domain TEXT NOT NULL,
      sitemap_url TEXT,
      gsc_property TEXT,
      gsc_access_token TEXT,
      gsc_refresh_token TEXT,
      gsc_token_expires_at TIMESTAMP,
      gsc_connected_at TIMESTAMP,
      gsc_last_sync_at TIMESTAMP,
      gsc_last_sync_status VARCHAR(24) NOT NULL DEFAULT 'never',
      gsc_last_error TEXT,
      crawl_last_run_at TIMESTAMP,
      crawl_last_run_status VARCHAR(24) NOT NULL DEFAULT 'never',
      crawl_last_error TEXT,
      auto_crawl_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      auto_gsc_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      crawl_frequency_hours INTEGER NOT NULL DEFAULT 24,
      is_primary INTEGER NOT NULL DEFAULT 1,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS sites_project_domain_unique
      ON sites(project_id, domain);
  `);
  await sql.query(`
    ALTER TABLE sites ADD COLUMN IF NOT EXISTS sitemap_url TEXT;
    ALTER TABLE sites ADD COLUMN IF NOT EXISTS gsc_property TEXT;
    ALTER TABLE sites ADD COLUMN IF NOT EXISTS gsc_access_token TEXT;
    ALTER TABLE sites ADD COLUMN IF NOT EXISTS gsc_refresh_token TEXT;
    ALTER TABLE sites ADD COLUMN IF NOT EXISTS gsc_token_expires_at TIMESTAMP;
    ALTER TABLE sites ADD COLUMN IF NOT EXISTS gsc_connected_at TIMESTAMP;
    ALTER TABLE sites ADD COLUMN IF NOT EXISTS gsc_last_sync_at TIMESTAMP;
    ALTER TABLE sites ADD COLUMN IF NOT EXISTS gsc_last_sync_status VARCHAR(24) NOT NULL DEFAULT 'never';
    ALTER TABLE sites ADD COLUMN IF NOT EXISTS gsc_last_error TEXT;
    ALTER TABLE sites ADD COLUMN IF NOT EXISTS crawl_last_run_at TIMESTAMP;
    ALTER TABLE sites ADD COLUMN IF NOT EXISTS crawl_last_run_status VARCHAR(24) NOT NULL DEFAULT 'never';
    ALTER TABLE sites ADD COLUMN IF NOT EXISTS crawl_last_error TEXT;
    ALTER TABLE sites ADD COLUMN IF NOT EXISTS auto_crawl_enabled BOOLEAN NOT NULL DEFAULT TRUE;
    ALTER TABLE sites ADD COLUMN IF NOT EXISTS auto_gsc_enabled BOOLEAN NOT NULL DEFAULT TRUE;
    ALTER TABLE sites ADD COLUMN IF NOT EXISTS crawl_frequency_hours INTEGER NOT NULL DEFAULT 24;
  `);

  // ── Pages & Crawl snapshots/issues ──
  await sql.query(`
    CREATE TABLE IF NOT EXISTS pages (
      id SERIAL PRIMARY KEY,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      site_id INTEGER REFERENCES sites(id) ON DELETE SET NULL,
      url TEXT NOT NULL,
      normalized_url TEXT NOT NULL DEFAULT '',
      url_hash TEXT,
      title TEXT,
      canonical_url TEXT,
      http_status INTEGER,
      is_indexable INTEGER DEFAULT 1,
      is_verified INTEGER DEFAULT 0,
      discovery_source VARCHAR(32) NOT NULL DEFAULT 'inventory',
      eligibility_state VARCHAR(24) NOT NULL DEFAULT 'eligible',
      exclude_reason VARCHAR(120),
      response_time_ms INTEGER,
      content_hash TEXT,
      first_seen_at TIMESTAMP,
      last_seen_at TIMESTAMP,
      is_active INTEGER NOT NULL DEFAULT 1,
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

  await sql.query(`
    ALTER TABLE pages ADD COLUMN IF NOT EXISTS site_id INTEGER REFERENCES sites(id) ON DELETE SET NULL;
    ALTER TABLE pages ADD COLUMN IF NOT EXISTS normalized_url TEXT;
    ALTER TABLE pages ADD COLUMN IF NOT EXISTS url_hash TEXT;
    ALTER TABLE pages ADD COLUMN IF NOT EXISTS discovery_source VARCHAR(32) NOT NULL DEFAULT 'inventory';
    ALTER TABLE pages ADD COLUMN IF NOT EXISTS eligibility_state VARCHAR(24) NOT NULL DEFAULT 'eligible';
    ALTER TABLE pages ADD COLUMN IF NOT EXISTS exclude_reason VARCHAR(120);
    ALTER TABLE pages ADD COLUMN IF NOT EXISTS first_seen_at TIMESTAMP;
    ALTER TABLE pages ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMP;
    ALTER TABLE pages ADD COLUMN IF NOT EXISTS is_active INTEGER NOT NULL DEFAULT 1;
  `);
  await sql.query(`
    UPDATE pages
    SET normalized_url = lower(trim(url))
    WHERE normalized_url IS NULL OR normalized_url = '';
  `);
  await sql.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS pages_project_normalized_url_unique
      ON pages(project_id, normalized_url);
  `);

  await sql.query(`
    CREATE TABLE IF NOT EXISTS site_discovery_urls (
      id SERIAL PRIMARY KEY,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      site_id INTEGER REFERENCES sites(id) ON DELETE SET NULL,
      page_id INTEGER REFERENCES pages(id) ON DELETE SET NULL,
      url TEXT NOT NULL,
      normalized_url TEXT NOT NULL,
      source VARCHAR(24) NOT NULL DEFAULT 'inventory',
      is_candidate INTEGER NOT NULL DEFAULT 0,
      exclude_reason VARCHAR(120),
      canonical_target TEXT,
      http_status INTEGER,
      robots TEXT,
      metadata JSONB,
      seen_at TIMESTAMP NOT NULL DEFAULT NOW(),
      last_seen_at TIMESTAMP NOT NULL DEFAULT NOW(),
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS site_discovery_urls_unique
      ON site_discovery_urls(project_id, normalized_url);
  `);

  await sql.query(`
    CREATE TABLE IF NOT EXISTS crawl_runs (
      id SERIAL PRIMARY KEY,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      site_id INTEGER REFERENCES sites(id) ON DELETE SET NULL,
      run_type VARCHAR(40) NOT NULL DEFAULT 'manual',
      status VARCHAR(40) NOT NULL DEFAULT 'queued',
      total_urls INTEGER NOT NULL DEFAULT 0,
      processed_urls INTEGER NOT NULL DEFAULT 0,
      success_urls INTEGER NOT NULL DEFAULT 0,
      failed_urls INTEGER NOT NULL DEFAULT 0,
      started_at TIMESTAMP,
      finished_at TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS crawl_queue (
      id SERIAL PRIMARY KEY,
      run_id INTEGER NOT NULL REFERENCES crawl_runs(id) ON DELETE CASCADE,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      site_id INTEGER REFERENCES sites(id) ON DELETE SET NULL,
      page_id INTEGER REFERENCES pages(id) ON DELETE SET NULL,
      url TEXT NOT NULL,
      normalized_url TEXT NOT NULL,
      priority INTEGER NOT NULL DEFAULT 50,
      state VARCHAR(40) NOT NULL DEFAULT 'queued',
      attempts INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 3,
      next_attempt_at TIMESTAMP,
      lease_until TIMESTAMP,
      last_error TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS crawl_queue_run_normalized_unique
      ON crawl_queue(run_id, normalized_url);
  `);

  await sql.query(`
    ALTER TABLE page_snapshots ADD COLUMN IF NOT EXISTS run_id INTEGER REFERENCES crawl_runs(id) ON DELETE SET NULL;
  `);

  await sql.query(`
    CREATE TABLE IF NOT EXISTS document_page_links (
      id SERIAL PRIMARY KEY,
      document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      page_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
      relation_type VARCHAR(40) NOT NULL DEFAULT 'primary',
      is_primary INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS document_page_links_unique
      ON document_page_links(document_id, page_id, relation_type);

    CREATE TABLE IF NOT EXISTS task_page_links (
      id SERIAL PRIMARY KEY,
      task_id TEXT NOT NULL,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      page_id INTEGER REFERENCES pages(id) ON DELETE SET NULL,
      keyword_id INTEGER REFERENCES keywords(id) ON DELETE SET NULL,
      link_type VARCHAR(40) NOT NULL DEFAULT 'related',
      annotation_date TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS task_page_links_unique
      ON task_page_links(task_id, page_id, link_type);

    CREATE TABLE IF NOT EXISTS gsc_page_daily_metrics (
      id SERIAL PRIMARY KEY,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      site_id INTEGER REFERENCES sites(id) ON DELETE SET NULL,
      page_id INTEGER REFERENCES pages(id) ON DELETE SET NULL,
      date TEXT NOT NULL,
      url TEXT NOT NULL,
      normalized_url TEXT NOT NULL,
      clicks REAL NOT NULL DEFAULT 0,
      impressions REAL NOT NULL DEFAULT 0,
      ctr REAL NOT NULL DEFAULT 0,
      position REAL NOT NULL DEFAULT 0,
      source VARCHAR(24) NOT NULL DEFAULT 'gsc',
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS gsc_metrics_unique_project_date_url
      ON gsc_page_daily_metrics(project_id, date, normalized_url);

    CREATE TABLE IF NOT EXISTS page_keyword_mappings (
      id SERIAL PRIMARY KEY,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      page_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
      keyword_id INTEGER NOT NULL REFERENCES keywords(id) ON DELETE CASCADE,
      mapping_type VARCHAR(24) NOT NULL DEFAULT 'secondary',
      cluster_key TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS page_keyword_mappings_unique
      ON page_keyword_mappings(page_id, keyword_id, mapping_type);
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

  // ── Project Agent Profiles ──
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS project_agent_profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      display_name TEXT NOT NULL,
      emoji TEXT,
      mission TEXT,
      is_enabled INTEGER NOT NULL DEFAULT 1,
      file_bundle TEXT,
      skill_ids TEXT,
      model_overrides TEXT,
      heartbeat_meta TEXT,
      created_by_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      updated_by_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS project_agent_profiles_unique_project_role
      ON project_agent_profiles(project_id, role);

    CREATE TABLE IF NOT EXISTS agent_shared_profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT NOT NULL UNIQUE,
      content TEXT NOT NULL DEFAULT '',
      updated_by_id TEXT REFERENCES users(id) ON DELETE SET NULL,
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
      project_ids TEXT,
      project_role TEXT,
      token TEXT NOT NULL UNIQUE,
      invited_by_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      expires_at TEXT NOT NULL,
      accepted_at TEXT,
      revoked_at TEXT,
      last_sent_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  addColumnSafe(sqlite, 'invitations', 'project_ids', 'TEXT');
  addColumnSafe(sqlite, 'invitations', 'project_role', 'TEXT');
  addColumnSafe(sqlite, 'invitations', 'revoked_at', 'TEXT');
  addColumnSafe(sqlite, 'invitations', 'last_sent_at', 'TEXT');

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

  // ── Sites ──
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS sites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      domain TEXT NOT NULL,
      sitemap_url TEXT,
      gsc_property TEXT,
      gsc_access_token TEXT,
      gsc_refresh_token TEXT,
      gsc_token_expires_at TEXT,
      gsc_connected_at TEXT,
      gsc_last_sync_at TEXT,
      gsc_last_sync_status TEXT NOT NULL DEFAULT 'never',
      gsc_last_error TEXT,
      crawl_last_run_at TEXT,
      crawl_last_run_status TEXT NOT NULL DEFAULT 'never',
      crawl_last_error TEXT,
      auto_crawl_enabled INTEGER NOT NULL DEFAULT 1,
      auto_gsc_enabled INTEGER NOT NULL DEFAULT 1,
      crawl_frequency_hours INTEGER NOT NULL DEFAULT 24,
      is_primary INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS sites_project_domain_unique ON sites(project_id, domain);
  `);
  addColumnSafe(sqlite, 'sites', 'sitemap_url', 'TEXT');
  addColumnSafe(sqlite, 'sites', 'gsc_property', 'TEXT');
  addColumnSafe(sqlite, 'sites', 'gsc_access_token', 'TEXT');
  addColumnSafe(sqlite, 'sites', 'gsc_refresh_token', 'TEXT');
  addColumnSafe(sqlite, 'sites', 'gsc_token_expires_at', 'TEXT');
  addColumnSafe(sqlite, 'sites', 'gsc_connected_at', 'TEXT');
  addColumnSafe(sqlite, 'sites', 'gsc_last_sync_at', 'TEXT');
  addColumnSafe(sqlite, 'sites', "gsc_last_sync_status", "TEXT NOT NULL DEFAULT 'never'");
  addColumnSafe(sqlite, 'sites', 'gsc_last_error', 'TEXT');
  addColumnSafe(sqlite, 'sites', 'crawl_last_run_at', 'TEXT');
  addColumnSafe(sqlite, 'sites', "crawl_last_run_status", "TEXT NOT NULL DEFAULT 'never'");
  addColumnSafe(sqlite, 'sites', 'crawl_last_error', 'TEXT');
  addColumnSafe(sqlite, 'sites', 'auto_crawl_enabled', 'INTEGER NOT NULL DEFAULT 1');
  addColumnSafe(sqlite, 'sites', 'auto_gsc_enabled', 'INTEGER NOT NULL DEFAULT 1');
  addColumnSafe(sqlite, 'sites', 'crawl_frequency_hours', 'INTEGER NOT NULL DEFAULT 24');

  // ── Pages & Crawl snapshots/issues ──
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS pages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      site_id INTEGER REFERENCES sites(id) ON DELETE SET NULL,
      url TEXT NOT NULL,
      normalized_url TEXT NOT NULL DEFAULT '',
      url_hash TEXT,
      title TEXT,
      canonical_url TEXT,
      http_status INTEGER,
      is_indexable INTEGER DEFAULT 1,
      is_verified INTEGER DEFAULT 0,
      discovery_source TEXT NOT NULL DEFAULT 'inventory',
      eligibility_state TEXT NOT NULL DEFAULT 'eligible',
      exclude_reason TEXT,
      response_time_ms INTEGER,
      content_hash TEXT,
      first_seen_at TEXT,
      last_seen_at TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      last_crawled_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS pages_project_url_unique ON pages(project_id, url);
    CREATE UNIQUE INDEX IF NOT EXISTS pages_project_normalized_url_unique ON pages(project_id, normalized_url);

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
  addColumnSafe(sqlite, 'pages', 'site_id', "INTEGER REFERENCES sites(id) ON DELETE SET NULL");
  addColumnSafe(sqlite, 'pages', 'normalized_url', "TEXT NOT NULL DEFAULT ''");
  addColumnSafe(sqlite, 'pages', 'url_hash', "TEXT");
  addColumnSafe(sqlite, 'pages', 'discovery_source', "TEXT NOT NULL DEFAULT 'inventory'");
  addColumnSafe(sqlite, 'pages', 'eligibility_state', "TEXT NOT NULL DEFAULT 'eligible'");
  addColumnSafe(sqlite, 'pages', 'exclude_reason', "TEXT");
  addColumnSafe(sqlite, 'pages', 'first_seen_at', "TEXT");
  addColumnSafe(sqlite, 'pages', 'last_seen_at', "TEXT");
  addColumnSafe(sqlite, 'pages', 'is_active', "INTEGER NOT NULL DEFAULT 1");
  sqlite.exec(`
    UPDATE pages
    SET normalized_url = lower(trim(url))
    WHERE normalized_url IS NULL OR normalized_url = '';
  `);
  sqlite.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS pages_project_normalized_url_unique ON pages(project_id, normalized_url);
  `);

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS site_discovery_urls (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      site_id INTEGER REFERENCES sites(id) ON DELETE SET NULL,
      page_id INTEGER REFERENCES pages(id) ON DELETE SET NULL,
      url TEXT NOT NULL,
      normalized_url TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'inventory',
      is_candidate INTEGER NOT NULL DEFAULT 0,
      exclude_reason TEXT,
      canonical_target TEXT,
      http_status INTEGER,
      robots TEXT,
      metadata TEXT,
      seen_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS site_discovery_urls_unique ON site_discovery_urls(project_id, normalized_url);
  `);

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS crawl_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      site_id INTEGER REFERENCES sites(id) ON DELETE SET NULL,
      run_type TEXT NOT NULL DEFAULT 'manual',
      status TEXT NOT NULL DEFAULT 'queued',
      total_urls INTEGER NOT NULL DEFAULT 0,
      processed_urls INTEGER NOT NULL DEFAULT 0,
      success_urls INTEGER NOT NULL DEFAULT 0,
      failed_urls INTEGER NOT NULL DEFAULT 0,
      started_at TEXT,
      finished_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS crawl_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER NOT NULL REFERENCES crawl_runs(id) ON DELETE CASCADE,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      site_id INTEGER REFERENCES sites(id) ON DELETE SET NULL,
      page_id INTEGER REFERENCES pages(id) ON DELETE SET NULL,
      url TEXT NOT NULL,
      normalized_url TEXT NOT NULL,
      priority INTEGER NOT NULL DEFAULT 50,
      state TEXT NOT NULL DEFAULT 'queued',
      attempts INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 3,
      next_attempt_at TEXT,
      lease_until TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS crawl_queue_run_normalized_unique ON crawl_queue(run_id, normalized_url);
  `);
  addColumnSafe(sqlite, 'page_snapshots', 'run_id', 'INTEGER REFERENCES crawl_runs(id) ON DELETE SET NULL');

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS document_page_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      page_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
      relation_type TEXT NOT NULL DEFAULT 'primary',
      is_primary INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS document_page_links_unique
      ON document_page_links(document_id, page_id, relation_type);

    CREATE TABLE IF NOT EXISTS task_page_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      page_id INTEGER REFERENCES pages(id) ON DELETE SET NULL,
      keyword_id INTEGER REFERENCES keywords(id) ON DELETE SET NULL,
      link_type TEXT NOT NULL DEFAULT 'related',
      annotation_date TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS task_page_links_unique
      ON task_page_links(task_id, page_id, link_type);

    CREATE TABLE IF NOT EXISTS gsc_page_daily_metrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      site_id INTEGER REFERENCES sites(id) ON DELETE SET NULL,
      page_id INTEGER REFERENCES pages(id) ON DELETE SET NULL,
      date TEXT NOT NULL,
      url TEXT NOT NULL,
      normalized_url TEXT NOT NULL,
      clicks REAL NOT NULL DEFAULT 0,
      impressions REAL NOT NULL DEFAULT 0,
      ctr REAL NOT NULL DEFAULT 0,
      position REAL NOT NULL DEFAULT 0,
      source TEXT NOT NULL DEFAULT 'gsc',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS gsc_metrics_unique_project_date_url
      ON gsc_page_daily_metrics(project_id, date, normalized_url);

    CREATE TABLE IF NOT EXISTS page_keyword_mappings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      page_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
      keyword_id INTEGER NOT NULL REFERENCES keywords(id) ON DELETE CASCADE,
      mapping_type TEXT NOT NULL DEFAULT 'secondary',
      cluster_key TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS page_keyword_mappings_unique
      ON page_keyword_mappings(page_id, keyword_id, mapping_type);
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
