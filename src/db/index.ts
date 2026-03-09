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

    CREATE TABLE IF NOT EXISTS user_presence (
      id SERIAL PRIMARY KEY,
      project_id INTEGER NOT NULL DEFAULT 0,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      is_online BOOLEAN NOT NULL DEFAULT FALSE,
      last_seen_at TIMESTAMP,
      online_seconds INTEGER NOT NULL DEFAULT 0,
      active_seconds INTEGER NOT NULL DEFAULT 0,
      heartbeat_count INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS user_presence_unique_project_user
      ON user_presence(project_id, user_id);
    CREATE INDEX IF NOT EXISTS user_presence_project_idx ON user_presence(project_id);
    CREATE INDEX IF NOT EXISTS user_presence_user_idx ON user_presence(user_id);
  `);

  await sql.query(`
    ALTER TABLE user_presence ADD COLUMN IF NOT EXISTS project_id INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE user_presence ADD COLUMN IF NOT EXISTS user_id TEXT;
    ALTER TABLE user_presence ADD COLUMN IF NOT EXISTS is_online BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE user_presence ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMP;
    ALTER TABLE user_presence ADD COLUMN IF NOT EXISTS online_seconds INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE user_presence ADD COLUMN IF NOT EXISTS active_seconds INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE user_presence ADD COLUMN IF NOT EXISTS heartbeat_count INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE user_presence ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT NOW();
    ALTER TABLE user_presence ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW();
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
        avatar_url TEXT,
        short_description TEXT,
        mission TEXT,
        is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
        file_bundle JSONB,
        knowledge_parts JSONB,
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

    DO $$ BEGIN
      CREATE TABLE project_agent_lane_profiles (
        id SERIAL PRIMARY KEY,
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        role VARCHAR(60) NOT NULL,
        lane_key VARCHAR(40) NOT NULL,
        display_name VARCHAR(200) NOT NULL,
        emoji VARCHAR(16),
        avatar_url TEXT,
        short_description TEXT,
        mission TEXT,
        is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
        file_bundle JSONB,
        knowledge_parts JSONB,
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
      CREATE UNIQUE INDEX project_agent_lane_profiles_unique_project_role_lane
        ON project_agent_lane_profiles(project_id, role, lane_key);
    EXCEPTION WHEN duplicate_table OR duplicate_object THEN NULL;
    END $$;

    DO $$ BEGIN
      CREATE TABLE project_workflow_stage_routes (
        id SERIAL PRIMARY KEY,
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        content_format VARCHAR(80) NOT NULL,
        lane_key VARCHAR(40) NOT NULL DEFAULT 'blog',
        stage_slots JSONB,
        stage_enabled JSONB,
        created_by_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        updated_by_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    EXCEPTION WHEN duplicate_table THEN NULL;
    END $$;

    DO $$ BEGIN
      CREATE UNIQUE INDEX project_workflow_stage_routes_unique_project_content_format
        ON project_workflow_stage_routes(project_id, content_format);
    EXCEPTION WHEN duplicate_table OR duplicate_object THEN NULL;
    END $$;
  `);

  await sql.query(`
    ALTER TABLE project_agent_profiles
      ADD COLUMN IF NOT EXISTS avatar_url TEXT;
    ALTER TABLE project_agent_profiles
      ADD COLUMN IF NOT EXISTS short_description TEXT;
    ALTER TABLE project_agent_profiles
      ADD COLUMN IF NOT EXISTS knowledge_parts JSONB;
    ALTER TABLE project_agent_lane_profiles
      ADD COLUMN IF NOT EXISTS avatar_url TEXT;
    ALTER TABLE project_agent_lane_profiles
      ADD COLUMN IF NOT EXISTS short_description TEXT;
    ALTER TABLE project_agent_lane_profiles
      ADD COLUMN IF NOT EXISTS knowledge_parts JSONB;
    ALTER TABLE project_workflow_stage_routes
      ADD COLUMN IF NOT EXISTS lane_key VARCHAR(40) NOT NULL DEFAULT 'blog';
    ALTER TABLE project_workflow_stage_routes
      ADD COLUMN IF NOT EXISTS stage_slots JSONB;
    ALTER TABLE project_workflow_stage_routes
      ADD COLUMN IF NOT EXISTS stage_enabled JSONB;
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

  // ── Content Templates ──
  await sql.query(`
    CREATE TABLE IF NOT EXISTS content_templates (
      id SERIAL PRIMARY KEY,
      key VARCHAR(120) NOT NULL UNIQUE,
      name VARCHAR(200) NOT NULL,
      description TEXT,
      content_formats JSONB,
      structure JSONB,
      word_range JSONB,
      outline_constraints JSONB,
      style_guard JSONB,
      is_system BOOLEAN NOT NULL DEFAULT TRUE,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS content_template_assignments (
      id SERIAL PRIMARY KEY,
      scope VARCHAR(24) NOT NULL DEFAULT 'global',
      scope_key VARCHAR(64) NOT NULL DEFAULT 'global',
      project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
      content_format VARCHAR(60) NOT NULL,
      template_key VARCHAR(120) NOT NULL REFERENCES content_templates(key) ON DELETE CASCADE,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS content_template_assignments_scope_key_format_unique
      ON content_template_assignments(scope_key, content_format);

    CREATE TABLE IF NOT EXISTS workflow_profiles (
      id SERIAL PRIMARY KEY,
      key VARCHAR(120) NOT NULL UNIQUE,
      name VARCHAR(200) NOT NULL,
      description TEXT,
      stage_sequence JSONB,
      stage_enabled JSONB,
      stage_actions JSONB,
      stage_guidance JSONB,
      is_system BOOLEAN NOT NULL DEFAULT TRUE,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS workflow_profile_assignments (
      id SERIAL PRIMARY KEY,
      scope VARCHAR(24) NOT NULL DEFAULT 'global',
      scope_key VARCHAR(64) NOT NULL DEFAULT 'global',
      project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
      content_format VARCHAR(60) NOT NULL,
      profile_key VARCHAR(120) NOT NULL REFERENCES workflow_profiles(key) ON DELETE CASCADE,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS workflow_profile_assignments_scope_key_format_unique
      ON workflow_profile_assignments(scope_key, content_format);
  `);
  await sql.query(`
    ALTER TABLE content_templates ADD COLUMN IF NOT EXISTS content_formats JSONB;
    ALTER TABLE content_templates ADD COLUMN IF NOT EXISTS structure JSONB;
    ALTER TABLE content_templates ADD COLUMN IF NOT EXISTS word_range JSONB;
    ALTER TABLE content_templates ADD COLUMN IF NOT EXISTS outline_constraints JSONB;
    ALTER TABLE content_templates ADD COLUMN IF NOT EXISTS style_guard JSONB;
    ALTER TABLE content_templates ADD COLUMN IF NOT EXISTS is_system BOOLEAN NOT NULL DEFAULT TRUE;
    ALTER TABLE content_templates ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
    ALTER TABLE content_template_assignments ADD COLUMN IF NOT EXISTS scope VARCHAR(24) NOT NULL DEFAULT 'global';
    ALTER TABLE content_template_assignments ADD COLUMN IF NOT EXISTS scope_key VARCHAR(64) NOT NULL DEFAULT 'global';
    ALTER TABLE workflow_profiles ADD COLUMN IF NOT EXISTS stage_sequence JSONB;
    ALTER TABLE workflow_profiles ADD COLUMN IF NOT EXISTS stage_enabled JSONB;
    ALTER TABLE workflow_profiles ADD COLUMN IF NOT EXISTS stage_actions JSONB;
    ALTER TABLE workflow_profiles ADD COLUMN IF NOT EXISTS stage_guidance JSONB;
    ALTER TABLE workflow_profiles ADD COLUMN IF NOT EXISTS is_system BOOLEAN NOT NULL DEFAULT TRUE;
    ALTER TABLE workflow_profiles ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
    ALTER TABLE workflow_profile_assignments ADD COLUMN IF NOT EXISTS scope VARCHAR(24) NOT NULL DEFAULT 'global';
    ALTER TABLE workflow_profile_assignments ADD COLUMN IF NOT EXISTS scope_key VARCHAR(64) NOT NULL DEFAULT 'global';
  `);
  await sql.query(`
    INSERT INTO content_templates (
      key, name, description, content_formats, structure, word_range, outline_constraints, style_guard, is_system, is_active
    ) VALUES
      (
        'blog_standard',
        'Blog Standard',
        'Balanced blog template for evergreen SEO content.',
        '["blog_post"]'::jsonb,
        '{"sections":[{"heading":"Introduction","level":2},{"heading":"Main Sections","level":2},{"heading":"Conclusion","level":2}]}'::jsonb,
        '{"min":1800,"max":3000}'::jsonb,
        '{"maxH2":8,"maxH3PerH2":3}'::jsonb,
        '{"emDash":"forbid","colon":"structural_only","maxNarrativeColons":0}'::jsonb,
        TRUE,
        TRUE
      ),
      (
        'blog_how_to',
        'How-To Guide',
        'Step-by-step instructional template.',
        '["blog_how_to"]'::jsonb,
        '{"sections":[{"heading":"What You Need","level":2},{"heading":"Step-by-Step","level":2},{"heading":"Conclusion","level":2}]}'::jsonb,
        '{"min":1800,"max":3000}'::jsonb,
        '{"maxH2":9,"maxH3PerH2":3}'::jsonb,
        '{"emDash":"forbid","colon":"structural_only","maxNarrativeColons":0}'::jsonb,
        TRUE,
        TRUE
      ),
      (
        'blog_listicle',
        'Listicle / Best Of',
        'List-focused template for ranked or grouped recommendations.',
        '["blog_listicle"]'::jsonb,
        '{"sections":[{"heading":"Introduction","level":2},{"heading":"List Items","level":2},{"heading":"Wrap-Up","level":2}]}'::jsonb,
        '{"min":1700,"max":2900}'::jsonb,
        '{"maxH2":10,"maxH3PerH2":2}'::jsonb,
        '{"emDash":"forbid","colon":"structural_only","maxNarrativeColons":0}'::jsonb,
        TRUE,
        TRUE
      ),
      (
        'blog_buying_guide',
        'Buying Guide',
        'Commercial-intent buying guide template.',
        '["blog_buying_guide"]'::jsonb,
        '{"sections":[{"heading":"Buyer Criteria","level":2},{"heading":"Options","level":2},{"heading":"Recommendations","level":2}]}'::jsonb,
        '{"min":2200,"max":3200}'::jsonb,
        '{"maxH2":10,"maxH3PerH2":3}'::jsonb,
        '{"emDash":"forbid","colon":"structural_only","maxNarrativeColons":0}'::jsonb,
        TRUE,
        TRUE
      ),
      (
        'blog_review',
        'Review Article',
        'Review-driven editorial template.',
        '["blog_review"]'::jsonb,
        '{"sections":[{"heading":"Verdict","level":2},{"heading":"Pros and Cons","level":2},{"heading":"Who It Is For","level":2}]}'::jsonb,
        '{"min":1500,"max":2600}'::jsonb,
        '{"maxH2":8,"maxH3PerH2":3}'::jsonb,
        '{"emDash":"forbid","colon":"structural_only","maxNarrativeColons":0}'::jsonb,
        TRUE,
        TRUE
      ),
      (
        'product_collection',
        'Collection Page',
        'Collection/category page optimization template.',
        '["product_category"]'::jsonb,
        '{"sections":[{"heading":"Collection Overview","level":2},{"heading":"Category Highlights","level":2},{"heading":"FAQ","level":2}]}'::jsonb,
        '{"min":900,"max":1800}'::jsonb,
        '{"maxH2":6,"maxH3PerH2":2}'::jsonb,
        '{"emDash":"forbid","colon":"structural_only","maxNarrativeColons":0}'::jsonb,
        TRUE,
        TRUE
      ),
      (
        'product_landing',
        'Product / Landing Page',
        'Product detail and landing page copy template.',
        '["product_description"]'::jsonb,
        '{"sections":[{"heading":"Value Proposition","level":2},{"heading":"Key Features","level":2},{"heading":"CTA","level":2}]}'::jsonb,
        '{"min":900,"max":1600}'::jsonb,
        '{"maxH2":6,"maxH3PerH2":2}'::jsonb,
        '{"emDash":"forbid","colon":"structural_only","maxNarrativeColons":0}'::jsonb,
        TRUE,
        TRUE
      ),
      (
        'comparison',
        'Comparison',
        'Comparison article template.',
        '["comparison"]'::jsonb,
        '{"sections":[{"heading":"Comparison Criteria","level":2},{"heading":"Head-to-Head","level":2},{"heading":"Recommendation","level":2}]}'::jsonb,
        '{"min":1600,"max":2800}'::jsonb,
        '{"maxH2":8,"maxH3PerH2":3}'::jsonb,
        '{"emDash":"forbid","colon":"structural_only","maxNarrativeColons":0}'::jsonb,
        TRUE,
        TRUE
      ),
      (
        'news',
        'News Article',
        'Concise, factual news template.',
        '["news_article"]'::jsonb,
        '{"sections":[{"heading":"Lead","level":2},{"heading":"Details","level":2},{"heading":"What''s Next","level":2}]}'::jsonb,
        '{"min":600,"max":1400}'::jsonb,
        '{"maxH2":5,"maxH3PerH2":2}'::jsonb,
        '{"emDash":"forbid","colon":"structural_only","maxNarrativeColons":0}'::jsonb,
        TRUE,
        TRUE
      )
    ON CONFLICT (key) DO NOTHING;
  `);
  // V2 blog templates — relaxed word ranges & style guard for better completion rates
  await sql.query(`
    INSERT INTO content_templates (
      key, name, description, content_formats, structure, word_range, outline_constraints, style_guard, is_system, is_active
    ) VALUES
      (
        'blog_standard_v2',
        'Blog Standard v2',
        'Balanced blog template with relaxed constraints for reliable completion.',
        '["blog_post"]'::jsonb,
        '{"sections":[{"heading":"Introduction","level":2},{"heading":"Main Sections","level":2},{"heading":"Conclusion","level":2}]}'::jsonb,
        '{"min":1200,"max":2500}'::jsonb,
        '{"maxH2":6,"maxH3PerH2":3}'::jsonb,
        '{"emDash":"allow","colon":"allow","maxNarrativeColons":0}'::jsonb,
        TRUE,
        TRUE
      ),
      (
        'blog_how_to_v2',
        'How-To Guide v2',
        'Step-by-step instructional template with relaxed constraints.',
        '["blog_how_to"]'::jsonb,
        '{"sections":[{"heading":"What You Need","level":2},{"heading":"Step-by-Step","level":2},{"heading":"Conclusion","level":2}]}'::jsonb,
        '{"min":1200,"max":2500}'::jsonb,
        '{"maxH2":7,"maxH3PerH2":3}'::jsonb,
        '{"emDash":"allow","colon":"allow","maxNarrativeColons":0}'::jsonb,
        TRUE,
        TRUE
      ),
      (
        'blog_listicle_v2',
        'Listicle / Best Of v2',
        'List-focused template with relaxed constraints.',
        '["blog_listicle"]'::jsonb,
        '{"sections":[{"heading":"Introduction","level":2},{"heading":"List Items","level":2},{"heading":"Wrap-Up","level":2}]}'::jsonb,
        '{"min":1200,"max":2500}'::jsonb,
        '{"maxH2":8,"maxH3PerH2":2}'::jsonb,
        '{"emDash":"allow","colon":"allow","maxNarrativeColons":0}'::jsonb,
        TRUE,
        TRUE
      ),
      (
        'blog_buying_guide_v2',
        'Buying Guide v2',
        'Commercial-intent buying guide with relaxed constraints.',
        '["blog_buying_guide"]'::jsonb,
        '{"sections":[{"heading":"Buyer Criteria","level":2},{"heading":"Options","level":2},{"heading":"Recommendations","level":2}]}'::jsonb,
        '{"min":1400,"max":2800}'::jsonb,
        '{"maxH2":8,"maxH3PerH2":3}'::jsonb,
        '{"emDash":"allow","colon":"allow","maxNarrativeColons":0}'::jsonb,
        TRUE,
        TRUE
      ),
      (
        'blog_review_v2',
        'Review Article v2',
        'Review-driven editorial template with relaxed constraints.',
        '["blog_review"]'::jsonb,
        '{"sections":[{"heading":"Verdict","level":2},{"heading":"Pros and Cons","level":2},{"heading":"Who It Is For","level":2}]}'::jsonb,
        '{"min":1200,"max":2400}'::jsonb,
        '{"maxH2":6,"maxH3PerH2":3}'::jsonb,
        '{"emDash":"allow","colon":"allow","maxNarrativeColons":0}'::jsonb,
        TRUE,
        TRUE
      )
    ON CONFLICT (key) DO NOTHING;
  `);
  // Archive old blog templates
  await sql.query(`
    UPDATE content_templates SET is_active = FALSE
    WHERE key IN ('blog_standard', 'blog_how_to', 'blog_listicle', 'blog_buying_guide', 'blog_review')
      AND is_active = TRUE;
  `);
  // Update assignments to point to v2 templates
  await sql.query(`
    UPDATE content_template_assignments
    SET template_key = 'blog_standard_v2', updated_at = NOW()
    WHERE scope_key = 'global' AND content_format = 'blog_post';
  `);
  await sql.query(`
    UPDATE content_template_assignments
    SET template_key = 'blog_how_to_v2', updated_at = NOW()
    WHERE scope_key = 'global' AND content_format = 'blog_how_to';
  `);
  await sql.query(`
    UPDATE content_template_assignments
    SET template_key = 'blog_listicle_v2', updated_at = NOW()
    WHERE scope_key = 'global' AND content_format = 'blog_listicle';
  `);
  await sql.query(`
    UPDATE content_template_assignments
    SET template_key = 'blog_buying_guide_v2', updated_at = NOW()
    WHERE scope_key = 'global' AND content_format = 'blog_buying_guide';
  `);
  await sql.query(`
    UPDATE content_template_assignments
    SET template_key = 'blog_review_v2', updated_at = NOW()
    WHERE scope_key = 'global' AND content_format = 'blog_review';
  `);
  // Fallback insert for fresh DBs
  await sql.query(`
    INSERT INTO content_template_assignments (scope, scope_key, project_id, content_format, template_key)
    VALUES
      ('global', 'global', NULL, 'blog_post', 'blog_standard_v2'),
      ('global', 'global', NULL, 'blog_how_to', 'blog_how_to_v2'),
      ('global', 'global', NULL, 'blog_listicle', 'blog_listicle_v2'),
      ('global', 'global', NULL, 'blog_buying_guide', 'blog_buying_guide_v2'),
      ('global', 'global', NULL, 'blog_review', 'blog_review_v2'),
      ('global', 'global', NULL, 'product_category', 'product_collection'),
      ('global', 'global', NULL, 'product_description', 'product_landing'),
      ('global', 'global', NULL, 'comparison', 'comparison'),
      ('global', 'global', NULL, 'news_article', 'news')
    ON CONFLICT (scope_key, content_format) DO NOTHING;
  `);
  await sql.query(`
    INSERT INTO workflow_profiles (
      key,
      name,
      description,
      stage_sequence,
      stage_enabled,
      stage_actions,
      stage_guidance,
      is_system,
      is_active
    ) VALUES (
      'topic_production_v1',
      'Topic Production v1',
      'Default SEO topic workflow sequence.',
      '["research","seo_intel_review","outline_build","writing","editing","final_review"]'::jsonb,
      '{"research":true,"seo_intel_review":true,"outline_build":true,"writing":true,"editing":true,"final_review":true}'::jsonb,
      '{"research":"workflow_research","seo_intel_review":"workflow_serp","outline_build":"workflow_outline","writing":"workflow_writing","editing":"workflow_editing","final_review":"workflow_final_review"}'::jsonb,
      '{}'::jsonb,
      TRUE,
      TRUE
    )
    ON CONFLICT (key) DO NOTHING;

    INSERT INTO workflow_profile_assignments (scope, scope_key, project_id, content_format, profile_key)
    VALUES
      ('global', 'global', NULL, 'blog_post', 'topic_production_v1'),
      ('global', 'global', NULL, 'blog_listicle', 'topic_production_v1'),
      ('global', 'global', NULL, 'blog_buying_guide', 'topic_production_v1'),
      ('global', 'global', NULL, 'blog_how_to', 'topic_production_v1'),
      ('global', 'global', NULL, 'blog_review', 'topic_production_v1'),
      ('global', 'global', NULL, 'product_category', 'topic_production_v1'),
      ('global', 'global', NULL, 'product_description', 'topic_production_v1'),
      ('global', 'global', NULL, 'comparison', 'topic_production_v1'),
      ('global', 'global', NULL, 'news_article', 'topic_production_v1')
    ON CONFLICT (scope_key, content_format) DO NOTHING;
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

  await sql.query(`
    CREATE TABLE IF NOT EXISTS keyword_clusters (
      id SERIAL PRIMARY KEY,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name VARCHAR(300) NOT NULL,
      main_keyword_id INTEGER REFERENCES keywords(id) ON DELETE SET NULL,
      status VARCHAR(30) NOT NULL DEFAULT 'active',
      notes TEXT,
      created_by_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS keyword_clusters_project_name_unique
      ON keyword_clusters(project_id, name);

    CREATE TABLE IF NOT EXISTS keyword_cluster_members (
      id SERIAL PRIMARY KEY,
      cluster_id INTEGER NOT NULL REFERENCES keyword_clusters(id) ON DELETE CASCADE,
      keyword_id INTEGER NOT NULL REFERENCES keywords(id) ON DELETE CASCADE,
      role VARCHAR(24) NOT NULL DEFAULT 'secondary',
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS keyword_cluster_members_unique
      ON keyword_cluster_members(cluster_id, keyword_id);
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
    ALTER TABLE pages ADD COLUMN IF NOT EXISTS latest_raw_artifact_id INTEGER;
    ALTER TABLE pages ADD COLUMN IF NOT EXISTS latest_clean_artifact_id INTEGER;
    ALTER TABLE pages ADD COLUMN IF NOT EXISTS latest_grade_artifact_id INTEGER;
    ALTER TABLE page_snapshots ADD COLUMN IF NOT EXISTS raw_artifact_id INTEGER;
    ALTER TABLE page_snapshots ADD COLUMN IF NOT EXISTS clean_artifact_id INTEGER;
    ALTER TABLE page_snapshots ADD COLUMN IF NOT EXISTS grade_artifact_id INTEGER;
  `);

  await sql.query(`
    CREATE TABLE IF NOT EXISTS page_artifacts (
      id SERIAL PRIMARY KEY,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      page_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
      run_id INTEGER REFERENCES crawl_runs(id) ON DELETE SET NULL,
      snapshot_id INTEGER NOT NULL REFERENCES page_snapshots(id) ON DELETE CASCADE,
      artifact_type VARCHAR(32) NOT NULL,
      status VARCHAR(32) NOT NULL DEFAULT 'queued',
      version INTEGER NOT NULL DEFAULT 1,
      object_key TEXT,
      checksum TEXT,
      size_bytes INTEGER,
      mime_type VARCHAR(120),
      grade_score REAL,
      metadata JSONB,
      last_error TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 3,
      next_attempt_at TIMESTAMP,
      ready_at TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS page_artifacts_project_page_idx
      ON page_artifacts(project_id, page_id, created_at);
    CREATE INDEX IF NOT EXISTS page_artifacts_snapshot_type_idx
      ON page_artifacts(snapshot_id, artifact_type, version);
    CREATE INDEX IF NOT EXISTS page_artifacts_status_idx
      ON page_artifacts(status, next_attempt_at);
  `);

  await sql.query(`
    CREATE TABLE IF NOT EXISTS page_artifact_jobs (
      id SERIAL PRIMARY KEY,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      page_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
      run_id INTEGER REFERENCES crawl_runs(id) ON DELETE SET NULL,
      snapshot_id INTEGER NOT NULL REFERENCES page_snapshots(id) ON DELETE CASCADE,
      action VARCHAR(32) NOT NULL DEFAULT 'process',
      state VARCHAR(32) NOT NULL DEFAULT 'queued',
      attempts INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 3,
      next_attempt_at TIMESTAMP,
      lease_until TIMESTAMP,
      last_error TEXT,
      payload JSONB,
      started_at TIMESTAMP,
      finished_at TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS page_artifact_jobs_state_idx
      ON page_artifact_jobs(state, next_attempt_at, created_at);
    CREATE INDEX IF NOT EXISTS page_artifact_jobs_snapshot_action_state_idx
      ON page_artifact_jobs(snapshot_id, action, state);
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

function requirePgSchemaModule() {
  // Vitest can execute TypeScript sources directly, so provide a TS fallback.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('./schema-pg');
  } catch (error) {
    if (process.env.NODE_ENV === 'test') {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      return require('./schema-pg.ts');
    }
    throw error;
  }
}

function requireSqliteSchemaModule() {
  // Vitest can execute TypeScript sources directly, so provide a TS fallback.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('./schema-sqlite');
  } catch (error) {
    if (process.env.NODE_ENV === 'test') {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      return require('./schema-sqlite.ts');
    }
    throw error;
  }
}

function createDb() {
  if (isVercel) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { sql } = require('@vercel/postgres');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { drizzle } = require('drizzle-orm/vercel-postgres');
    const pgSchema = requirePgSchemaModule();

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
  const sqliteSchema = requireSqliteSchemaModule();
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

    CREATE TABLE IF NOT EXISTS user_presence (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL DEFAULT 0,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      is_online INTEGER NOT NULL DEFAULT 0,
      last_seen_at TEXT,
      online_seconds INTEGER NOT NULL DEFAULT 0,
      active_seconds INTEGER NOT NULL DEFAULT 0,
      heartbeat_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS user_presence_unique_project_user
      ON user_presence(project_id, user_id);
    CREATE INDEX IF NOT EXISTS user_presence_project_idx ON user_presence(project_id);
    CREATE INDEX IF NOT EXISTS user_presence_user_idx ON user_presence(user_id);
  `);
  addColumnSafe(sqlite, 'user_presence', 'project_id', 'INTEGER NOT NULL DEFAULT 0');
  addColumnSafe(sqlite, 'user_presence', 'user_id', 'TEXT');
  addColumnSafe(sqlite, 'user_presence', 'is_online', 'INTEGER NOT NULL DEFAULT 0');
  addColumnSafe(sqlite, 'user_presence', 'last_seen_at', 'TEXT');
  addColumnSafe(sqlite, 'user_presence', 'online_seconds', 'INTEGER NOT NULL DEFAULT 0');
  addColumnSafe(sqlite, 'user_presence', 'active_seconds', 'INTEGER NOT NULL DEFAULT 0');
  addColumnSafe(sqlite, 'user_presence', 'heartbeat_count', 'INTEGER NOT NULL DEFAULT 0');

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
      avatar_url TEXT,
      short_description TEXT,
      mission TEXT,
      is_enabled INTEGER NOT NULL DEFAULT 1,
      file_bundle TEXT,
      knowledge_parts TEXT,
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

    CREATE TABLE IF NOT EXISTS project_agent_lane_profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      lane_key TEXT NOT NULL,
      display_name TEXT NOT NULL,
      emoji TEXT,
      avatar_url TEXT,
      short_description TEXT,
      mission TEXT,
      is_enabled INTEGER NOT NULL DEFAULT 1,
      file_bundle TEXT,
      knowledge_parts TEXT,
      skill_ids TEXT,
      model_overrides TEXT,
      heartbeat_meta TEXT,
      created_by_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      updated_by_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS project_agent_lane_profiles_unique_project_role_lane
      ON project_agent_lane_profiles(project_id, role, lane_key);

    CREATE TABLE IF NOT EXISTS project_workflow_stage_routes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      content_format TEXT NOT NULL,
      lane_key TEXT NOT NULL DEFAULT 'blog',
      stage_slots TEXT,
      stage_enabled TEXT,
      created_by_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      updated_by_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS project_workflow_stage_routes_unique_project_content_format
      ON project_workflow_stage_routes(project_id, content_format);
  `);
  addColumnSafe(sqlite, 'project_agent_profiles', 'avatar_url', 'TEXT');
  addColumnSafe(sqlite, 'project_agent_profiles', 'short_description', 'TEXT');
  addColumnSafe(sqlite, 'project_agent_profiles', 'knowledge_parts', 'TEXT');
  addColumnSafe(sqlite, 'project_agent_lane_profiles', 'avatar_url', 'TEXT');
  addColumnSafe(sqlite, 'project_agent_lane_profiles', 'short_description', 'TEXT');
  addColumnSafe(sqlite, 'project_agent_lane_profiles', 'knowledge_parts', 'TEXT');
  addColumnSafe(sqlite, 'project_workflow_stage_routes', 'lane_key', "TEXT NOT NULL DEFAULT 'blog'");
  addColumnSafe(sqlite, 'project_workflow_stage_routes', 'stage_slots', 'TEXT');
  addColumnSafe(sqlite, 'project_workflow_stage_routes', 'stage_enabled', 'TEXT');

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

  // ── Content Templates ──
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS content_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      description TEXT,
      content_formats TEXT,
      structure TEXT,
      word_range TEXT,
      outline_constraints TEXT,
      style_guard TEXT,
      is_system INTEGER NOT NULL DEFAULT 1,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS content_template_assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scope TEXT NOT NULL DEFAULT 'global',
      scope_key TEXT NOT NULL DEFAULT 'global',
      project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
      content_format TEXT NOT NULL,
      template_key TEXT NOT NULL REFERENCES content_templates(key) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS content_template_assignments_scope_key_format_unique
      ON content_template_assignments(scope_key, content_format);

    CREATE TABLE IF NOT EXISTS workflow_profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      description TEXT,
      stage_sequence TEXT,
      stage_enabled TEXT,
      stage_actions TEXT,
      stage_guidance TEXT,
      is_system INTEGER NOT NULL DEFAULT 1,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS workflow_profile_assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scope TEXT NOT NULL DEFAULT 'global',
      scope_key TEXT NOT NULL DEFAULT 'global',
      project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
      content_format TEXT NOT NULL,
      profile_key TEXT NOT NULL REFERENCES workflow_profiles(key) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS workflow_profile_assignments_scope_key_format_unique
      ON workflow_profile_assignments(scope_key, content_format);
  `);
  addColumnSafe(sqlite, 'content_templates', 'content_formats', 'TEXT');
  addColumnSafe(sqlite, 'content_templates', 'structure', 'TEXT');
  addColumnSafe(sqlite, 'content_templates', 'word_range', 'TEXT');
  addColumnSafe(sqlite, 'content_templates', 'outline_constraints', 'TEXT');
  addColumnSafe(sqlite, 'content_templates', 'style_guard', 'TEXT');
  addColumnSafe(sqlite, 'content_templates', 'is_system', 'INTEGER NOT NULL DEFAULT 1');
  addColumnSafe(sqlite, 'content_templates', 'is_active', 'INTEGER NOT NULL DEFAULT 1');
  addColumnSafe(sqlite, 'content_template_assignments', 'scope', "TEXT NOT NULL DEFAULT 'global'");
  addColumnSafe(sqlite, 'content_template_assignments', 'scope_key', "TEXT NOT NULL DEFAULT 'global'");
  addColumnSafe(sqlite, 'workflow_profiles', 'stage_sequence', 'TEXT');
  addColumnSafe(sqlite, 'workflow_profiles', 'stage_enabled', 'TEXT');
  addColumnSafe(sqlite, 'workflow_profiles', 'stage_actions', 'TEXT');
  addColumnSafe(sqlite, 'workflow_profiles', 'stage_guidance', 'TEXT');
  addColumnSafe(sqlite, 'workflow_profiles', 'is_system', 'INTEGER NOT NULL DEFAULT 1');
  addColumnSafe(sqlite, 'workflow_profiles', 'is_active', 'INTEGER NOT NULL DEFAULT 1');
  addColumnSafe(sqlite, 'workflow_profile_assignments', 'scope', "TEXT NOT NULL DEFAULT 'global'");
  addColumnSafe(sqlite, 'workflow_profile_assignments', 'scope_key', "TEXT NOT NULL DEFAULT 'global'");
  sqlite.exec(`
    INSERT OR IGNORE INTO content_templates (
      key, name, description, content_formats, structure, word_range, outline_constraints, style_guard, is_system, is_active
    ) VALUES
      (
        'blog_standard',
        'Blog Standard',
        'Balanced blog template for evergreen SEO content.',
        '["blog_post"]',
        '{"sections":[{"heading":"Introduction","level":2},{"heading":"Main Sections","level":2},{"heading":"Conclusion","level":2}]}',
        '{"min":1800,"max":3000}',
        '{"maxH2":8,"maxH3PerH2":3}',
        '{"emDash":"forbid","colon":"structural_only","maxNarrativeColons":0}',
        1,
        1
      ),
      (
        'blog_how_to',
        'How-To Guide',
        'Step-by-step instructional template.',
        '["blog_how_to"]',
        '{"sections":[{"heading":"What You Need","level":2},{"heading":"Step-by-Step","level":2},{"heading":"Conclusion","level":2}]}',
        '{"min":1800,"max":3000}',
        '{"maxH2":9,"maxH3PerH2":3}',
        '{"emDash":"forbid","colon":"structural_only","maxNarrativeColons":0}',
        1,
        1
      ),
      (
        'blog_listicle',
        'Listicle / Best Of',
        'List-focused template for ranked or grouped recommendations.',
        '["blog_listicle"]',
        '{"sections":[{"heading":"Introduction","level":2},{"heading":"List Items","level":2},{"heading":"Wrap-Up","level":2}]}',
        '{"min":1700,"max":2900}',
        '{"maxH2":10,"maxH3PerH2":2}',
        '{"emDash":"forbid","colon":"structural_only","maxNarrativeColons":0}',
        1,
        1
      ),
      (
        'blog_buying_guide',
        'Buying Guide',
        'Commercial-intent buying guide template.',
        '["blog_buying_guide"]',
        '{"sections":[{"heading":"Buyer Criteria","level":2},{"heading":"Options","level":2},{"heading":"Recommendations","level":2}]}',
        '{"min":2200,"max":3200}',
        '{"maxH2":10,"maxH3PerH2":3}',
        '{"emDash":"forbid","colon":"structural_only","maxNarrativeColons":0}',
        1,
        1
      ),
      (
        'blog_review',
        'Review Article',
        'Review-driven editorial template.',
        '["blog_review"]',
        '{"sections":[{"heading":"Verdict","level":2},{"heading":"Pros and Cons","level":2},{"heading":"Who It Is For","level":2}]}',
        '{"min":1500,"max":2600}',
        '{"maxH2":8,"maxH3PerH2":3}',
        '{"emDash":"forbid","colon":"structural_only","maxNarrativeColons":0}',
        1,
        1
      ),
      (
        'product_collection',
        'Collection Page',
        'Collection/category page optimization template.',
        '["product_category"]',
        '{"sections":[{"heading":"Collection Overview","level":2},{"heading":"Category Highlights","level":2},{"heading":"FAQ","level":2}]}',
        '{"min":900,"max":1800}',
        '{"maxH2":6,"maxH3PerH2":2}',
        '{"emDash":"forbid","colon":"structural_only","maxNarrativeColons":0}',
        1,
        1
      ),
      (
        'product_landing',
        'Product / Landing Page',
        'Product detail and landing page copy template.',
        '["product_description"]',
        '{"sections":[{"heading":"Value Proposition","level":2},{"heading":"Key Features","level":2},{"heading":"CTA","level":2}]}',
        '{"min":900,"max":1600}',
        '{"maxH2":6,"maxH3PerH2":2}',
        '{"emDash":"forbid","colon":"structural_only","maxNarrativeColons":0}',
        1,
        1
      ),
      (
        'comparison',
        'Comparison',
        'Comparison article template.',
        '["comparison"]',
        '{"sections":[{"heading":"Comparison Criteria","level":2},{"heading":"Head-to-Head","level":2},{"heading":"Recommendation","level":2}]}',
        '{"min":1600,"max":2800}',
        '{"maxH2":8,"maxH3PerH2":3}',
        '{"emDash":"forbid","colon":"structural_only","maxNarrativeColons":0}',
        1,
        1
      ),
      (
        'news',
        'News Article',
        'Concise, factual news template.',
        '["news_article"]',
        '{"sections":[{"heading":"Lead","level":2},{"heading":"Details","level":2},{"heading":"Whats Next","level":2}]}',
        '{"min":600,"max":1400}',
        '{"maxH2":5,"maxH3PerH2":2}',
        '{"emDash":"forbid","colon":"structural_only","maxNarrativeColons":0}',
        1,
        1
      );
  `);
  sqlite.exec(`
    INSERT OR IGNORE INTO content_template_assignments (
      scope, scope_key, project_id, content_format, template_key
    ) VALUES
      ('global', 'global', NULL, 'blog_post', 'blog_standard'),
      ('global', 'global', NULL, 'blog_how_to', 'blog_how_to'),
      ('global', 'global', NULL, 'blog_listicle', 'blog_listicle'),
      ('global', 'global', NULL, 'blog_buying_guide', 'blog_buying_guide'),
      ('global', 'global', NULL, 'blog_review', 'blog_review'),
      ('global', 'global', NULL, 'product_category', 'product_collection'),
      ('global', 'global', NULL, 'product_description', 'product_landing'),
      ('global', 'global', NULL, 'comparison', 'comparison'),
      ('global', 'global', NULL, 'news_article', 'news');
  `);
  // V2 blog templates for SQLite (local dev)
  sqlite.exec(`
    INSERT OR IGNORE INTO content_templates (
      key, name, description, content_formats, structure, word_range, outline_constraints, style_guard, is_system, is_active
    ) VALUES
      (
        'blog_standard_v2',
        'Blog Standard v2',
        'Balanced blog template with relaxed constraints for reliable completion.',
        '["blog_post"]',
        '{"sections":[{"heading":"Introduction","level":2},{"heading":"Main Sections","level":2},{"heading":"Conclusion","level":2}]}',
        '{"min":1200,"max":2500}',
        '{"maxH2":6,"maxH3PerH2":3}',
        '{"emDash":"allow","colon":"allow","maxNarrativeColons":0}',
        1,
        1
      ),
      (
        'blog_how_to_v2',
        'How-To Guide v2',
        'Step-by-step instructional template with relaxed constraints.',
        '["blog_how_to"]',
        '{"sections":[{"heading":"What You Need","level":2},{"heading":"Step-by-Step","level":2},{"heading":"Conclusion","level":2}]}',
        '{"min":1200,"max":2500}',
        '{"maxH2":7,"maxH3PerH2":3}',
        '{"emDash":"allow","colon":"allow","maxNarrativeColons":0}',
        1,
        1
      ),
      (
        'blog_listicle_v2',
        'Listicle / Best Of v2',
        'List-focused template with relaxed constraints.',
        '["blog_listicle"]',
        '{"sections":[{"heading":"Introduction","level":2},{"heading":"List Items","level":2},{"heading":"Wrap-Up","level":2}]}',
        '{"min":1200,"max":2500}',
        '{"maxH2":8,"maxH3PerH2":2}',
        '{"emDash":"allow","colon":"allow","maxNarrativeColons":0}',
        1,
        1
      ),
      (
        'blog_buying_guide_v2',
        'Buying Guide v2',
        'Commercial-intent buying guide with relaxed constraints.',
        '["blog_buying_guide"]',
        '{"sections":[{"heading":"Buyer Criteria","level":2},{"heading":"Options","level":2},{"heading":"Recommendations","level":2}]}',
        '{"min":1400,"max":2800}',
        '{"maxH2":8,"maxH3PerH2":3}',
        '{"emDash":"allow","colon":"allow","maxNarrativeColons":0}',
        1,
        1
      ),
      (
        'blog_review_v2',
        'Review Article v2',
        'Review-driven editorial template with relaxed constraints.',
        '["blog_review"]',
        '{"sections":[{"heading":"Verdict","level":2},{"heading":"Pros and Cons","level":2},{"heading":"Who It Is For","level":2}]}',
        '{"min":1200,"max":2400}',
        '{"maxH2":6,"maxH3PerH2":3}',
        '{"emDash":"allow","colon":"allow","maxNarrativeColons":0}',
        1,
        1
      );
  `);
  sqlite.exec(`
    INSERT OR IGNORE INTO workflow_profiles (
      key,
      name,
      description,
      stage_sequence,
      stage_enabled,
      stage_actions,
      stage_guidance,
      is_system,
      is_active
    ) VALUES (
      'topic_production_v1',
      'Topic Production v1',
      'Default SEO topic workflow sequence.',
      '["research","seo_intel_review","outline_build","writing","editing","final_review"]',
      '{"research":true,"seo_intel_review":true,"outline_build":true,"writing":true,"editing":true,"final_review":true}',
      '{"research":"workflow_research","seo_intel_review":"workflow_serp","outline_build":"workflow_outline","writing":"workflow_writing","editing":"workflow_editing","final_review":"workflow_final_review"}',
      '{}',
      1,
      1
    );

    INSERT OR IGNORE INTO workflow_profile_assignments (
      scope, scope_key, project_id, content_format, profile_key
    ) VALUES
      ('global', 'global', NULL, 'blog_post', 'topic_production_v1'),
      ('global', 'global', NULL, 'blog_listicle', 'topic_production_v1'),
      ('global', 'global', NULL, 'blog_buying_guide', 'topic_production_v1'),
      ('global', 'global', NULL, 'blog_how_to', 'topic_production_v1'),
      ('global', 'global', NULL, 'blog_review', 'topic_production_v1'),
      ('global', 'global', NULL, 'product_category', 'topic_production_v1'),
      ('global', 'global', NULL, 'product_description', 'topic_production_v1'),
      ('global', 'global', NULL, 'comparison', 'topic_production_v1'),
      ('global', 'global', NULL, 'news_article', 'topic_production_v1');
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
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS keyword_clusters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      main_keyword_id INTEGER REFERENCES keywords(id) ON DELETE SET NULL,
      status TEXT NOT NULL DEFAULT 'active',
      notes TEXT,
      created_by_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS keyword_clusters_project_name_unique
      ON keyword_clusters(project_id, name);

    CREATE TABLE IF NOT EXISTS keyword_cluster_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cluster_id INTEGER NOT NULL REFERENCES keyword_clusters(id) ON DELETE CASCADE,
      keyword_id INTEGER NOT NULL REFERENCES keywords(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'secondary',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS keyword_cluster_members_unique
      ON keyword_cluster_members(cluster_id, keyword_id);
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
  addColumnSafe(sqlite, 'pages', 'latest_raw_artifact_id', 'INTEGER');
  addColumnSafe(sqlite, 'pages', 'latest_clean_artifact_id', 'INTEGER');
  addColumnSafe(sqlite, 'pages', 'latest_grade_artifact_id', 'INTEGER');
  addColumnSafe(sqlite, 'page_snapshots', 'raw_artifact_id', 'INTEGER');
  addColumnSafe(sqlite, 'page_snapshots', 'clean_artifact_id', 'INTEGER');
  addColumnSafe(sqlite, 'page_snapshots', 'grade_artifact_id', 'INTEGER');

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS page_artifacts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      page_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
      run_id INTEGER REFERENCES crawl_runs(id) ON DELETE SET NULL,
      snapshot_id INTEGER NOT NULL REFERENCES page_snapshots(id) ON DELETE CASCADE,
      artifact_type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      version INTEGER NOT NULL DEFAULT 1,
      object_key TEXT,
      checksum TEXT,
      size_bytes INTEGER,
      mime_type TEXT,
      grade_score REAL,
      metadata TEXT,
      last_error TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 3,
      next_attempt_at TEXT,
      ready_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS page_artifacts_project_page_idx
      ON page_artifacts(project_id, page_id, created_at);
    CREATE INDEX IF NOT EXISTS page_artifacts_snapshot_type_idx
      ON page_artifacts(snapshot_id, artifact_type, version);
    CREATE INDEX IF NOT EXISTS page_artifacts_status_idx
      ON page_artifacts(status, next_attempt_at);
  `);

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS page_artifact_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      page_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
      run_id INTEGER REFERENCES crawl_runs(id) ON DELETE SET NULL,
      snapshot_id INTEGER NOT NULL REFERENCES page_snapshots(id) ON DELETE CASCADE,
      action TEXT NOT NULL DEFAULT 'process',
      state TEXT NOT NULL DEFAULT 'queued',
      attempts INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 3,
      next_attempt_at TEXT,
      lease_until TEXT,
      last_error TEXT,
      payload TEXT,
      started_at TEXT,
      finished_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS page_artifact_jobs_state_idx
      ON page_artifact_jobs(state, next_attempt_at, created_at);
    CREATE INDEX IF NOT EXISTS page_artifact_jobs_snapshot_action_state_idx
      ON page_artifact_jobs(snapshot_id, action, state);
  `);

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
