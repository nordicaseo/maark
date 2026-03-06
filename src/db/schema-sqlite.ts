import {
  sqliteTable,
  text,
  integer,
  real,
  index,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

// ── Users ─────────────────────────────────────────────────────────

export const users = sqliteTable('users', {
  id: text('id').primaryKey(), // Supabase auth user UUID
  name: text('name'),
  email: text('email').notNull().unique(),
  image: text('image'),
  role: text('role').notNull().default('writer'),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()),
});

// ── Documents ──────────────────────────────────────────────────────

export const documents = sqliteTable('documents', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  projectId: integer('project_id').references(() => projects.id, { onDelete: 'set null' }),
  authorId: text('author_id').references(() => users.id, { onDelete: 'set null' }),
  title: text('title').notNull().default('Untitled'),
  content: text('content', { mode: 'json' }),
  plainText: text('plain_text'),
  status: text('status').notNull().default('draft'),
  contentType: text('content_type').notNull().default('blog_post'),
  targetKeyword: text('target_keyword'),
  wordCount: integer('word_count').default(0),
  aiDetectionScore: real('ai_detection_score'),
  aiRiskLevel: text('ai_risk_level'),
  semanticScore: real('semantic_score'),
  contentQualityScore: real('content_quality_score'),
  researchSnapshot: text('research_snapshot', { mode: 'json' }),
  outlineSnapshot: text('outline_snapshot', { mode: 'json' }),
  prewriteChecklist: text('prewrite_checklist', { mode: 'json' }),
  agentQuestions: text('agent_questions', { mode: 'json' }),
  previewToken: text('preview_token'),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()),
});

// ── SERP Cache ─────────────────────────────────────────────────────

export const serpCache = sqliteTable('serp_cache', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  keyword: text('keyword').notNull().unique(),
  entities: text('entities', { mode: 'json' }).notNull(),
  lsiKeywords: text('lsi_keywords', { mode: 'json' }).notNull(),
  topUrls: text('top_urls', { mode: 'json' }).notNull(),
  fetchedAt: text('fetched_at').notNull().$defaultFn(() => new Date().toISOString()),
});

// ── Analysis Snapshots ─────────────────────────────────────────────

export const analysisSnapshots = sqliteTable('analysis_snapshots', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  documentId: integer('document_id').notNull().references(() => documents.id, { onDelete: 'cascade' }),
  analysisType: text('analysis_type').notNull(),
  resultData: text('result_data', { mode: 'json' }).notNull(),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
});

// ── Projects ───────────────────────────────────────────────────────

export const projects = sqliteTable('projects', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  description: text('description'),
  defaultContentFormat: text('default_content_format').default('blog_post'),
  brandVoice: text('brand_voice'),
  settings: text('settings', { mode: 'json' }),
  createdById: text('created_by_id').references(() => users.id, { onDelete: 'set null' }),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()),
});

export const projectMembers = sqliteTable('project_members', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  projectId: integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: text('role').default('writer'),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => [
  uniqueIndex('project_members_unique').on(table.projectId, table.userId),
]);

export const userPresence = sqliteTable('user_presence', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  projectId: integer('project_id').notNull().default(0),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  isOnline: integer('is_online').notNull().default(0),
  lastSeenAt: text('last_seen_at'),
  onlineSeconds: integer('online_seconds').notNull().default(0),
  activeSeconds: integer('active_seconds').notNull().default(0),
  heartbeatCount: integer('heartbeat_count').notNull().default(0),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => [
  uniqueIndex('user_presence_unique_project_user').on(table.projectId, table.userId),
  index('user_presence_project_idx').on(table.projectId),
  index('user_presence_user_idx').on(table.userId),
]);

// ── Skills ─────────────────────────────────────────────────────────

export const skills = sqliteTable('skills', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  projectId: integer('project_id').references(() => projects.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),
  content: text('content').notNull(),
  isGlobal: integer('is_global').default(0),
  createdById: text('created_by_id').references(() => users.id, { onDelete: 'set null' }),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()),
});

// ── Project Agent Profiles ────────────────────────────────────────

export const projectAgentProfiles = sqliteTable('project_agent_profiles', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  projectId: integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  role: text('role').notNull(),
  displayName: text('display_name').notNull(),
  emoji: text('emoji'),
  avatarUrl: text('avatar_url'),
  shortDescription: text('short_description'),
  mission: text('mission'),
  isEnabled: integer('is_enabled').notNull().default(1),
  fileBundle: text('file_bundle', { mode: 'json' }),
  skillIds: text('skill_ids', { mode: 'json' }),
  modelOverrides: text('model_overrides', { mode: 'json' }),
  heartbeatMeta: text('heartbeat_meta', { mode: 'json' }),
  createdById: text('created_by_id').references(() => users.id, { onDelete: 'set null' }),
  updatedById: text('updated_by_id').references(() => users.id, { onDelete: 'set null' }),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => [
  uniqueIndex('project_agent_profiles_unique_project_role').on(table.projectId, table.role),
]);

export const agentSharedProfiles = sqliteTable('agent_shared_profiles', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  key: text('key').notNull().unique(),
  content: text('content').notNull().default(''),
  updatedById: text('updated_by_id').references(() => users.id, { onDelete: 'set null' }),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()),
});

// ── Skill Parts ──────────────────────────────────────────────────

export const skillParts = sqliteTable('skill_parts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  skillId: integer('skill_id').notNull().references(() => skills.id, { onDelete: 'cascade' }),
  partType: text('part_type').notNull().default('custom'),
  label: text('label').notNull(),
  content: text('content').notNull().default(''),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()),
});

// ── Document Comments ─────────────────────────────────────────────

export const documentComments = sqliteTable('document_comments', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  documentId: integer('document_id').notNull().references(() => documents.id, { onDelete: 'cascade' }),
  previewToken: text('preview_token').notNull(),
  authorName: text('author_name').notNull(),
  content: text('content').notNull(),
  quotedText: text('quoted_text'),
  selectionFrom: integer('selection_from'),
  selectionTo: integer('selection_to'),
  isResolved: integer('is_resolved').default(0),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
});

// ── AI Providers & Model Config ────────────────────────────────────

export const aiProviders = sqliteTable('ai_providers', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  displayName: text('display_name'),
  apiKey: text('api_key').notNull(),
  isActive: integer('is_active').default(1),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()),
});

export const aiModelConfig = sqliteTable('ai_model_config', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  action: text('action').notNull().unique(),
  providerId: integer('provider_id').notNull().references(() => aiProviders.id, { onDelete: 'cascade' }),
  model: text('model').notNull(),
  maxTokens: integer('max_tokens').default(4096),
  temperature: real('temperature').default(1.0),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()),
});

// ── Content Templates ─────────────────────────────────────────────

export const contentTemplates = sqliteTable('content_templates', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  key: text('key').notNull().unique(),
  name: text('name').notNull(),
  description: text('description'),
  contentFormats: text('content_formats', { mode: 'json' }),
  structure: text('structure', { mode: 'json' }),
  wordRange: text('word_range', { mode: 'json' }),
  outlineConstraints: text('outline_constraints', { mode: 'json' }),
  styleGuard: text('style_guard', { mode: 'json' }),
  isSystem: integer('is_system').notNull().default(1),
  isActive: integer('is_active').notNull().default(1),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()),
});

export const contentTemplateAssignments = sqliteTable('content_template_assignments', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  scope: text('scope').notNull().default('global'),
  scopeKey: text('scope_key').notNull().default('global'),
  projectId: integer('project_id').references(() => projects.id, { onDelete: 'cascade' }),
  contentFormat: text('content_format').notNull(),
  templateKey: text('template_key').notNull().references(() => contentTemplates.key, { onDelete: 'cascade' }),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => [
  uniqueIndex('content_template_assignments_scope_key_format_unique').on(
    table.scopeKey,
    table.contentFormat
  ),
]);

// ── Invitations ──────────────────────────────────────────────────

export const invitations = sqliteTable('invitations', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  email: text('email'),
  role: text('role').notNull().default('writer'),
  projectIds: text('project_ids', { mode: 'json' }),
  projectRole: text('project_role'),
  token: text('token').notNull().unique(),
  invitedById: text('invited_by_id').references(() => users.id, { onDelete: 'set null' }),
  expiresAt: text('expires_at').notNull(),
  acceptedAt: text('accepted_at'),
  revokedAt: text('revoked_at'),
  lastSentAt: text('last_sent_at'),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
});

// ── Keywords ───────────────────────────────────────────────────────

export const keywords = sqliteTable('keywords', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  projectId: integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  keyword: text('keyword').notNull(),
  intent: text('intent').notNull().default('informational'),
  status: text('status').notNull().default('new'),
  priority: text('priority').notNull().default('medium'),
  ownerId: text('owner_id').references(() => users.id, { onDelete: 'set null' }),
  volume: integer('volume'),
  difficulty: integer('difficulty'),
  targetUrl: text('target_url'),
  notes: text('notes'),
  lastTaskId: text('last_task_id'),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => [
  uniqueIndex('keywords_project_keyword_unique').on(table.projectId, table.keyword),
]);

export const keywordClusters = sqliteTable('keyword_clusters', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  projectId: integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  mainKeywordId: integer('main_keyword_id').references(() => keywords.id, { onDelete: 'set null' }),
  status: text('status').notNull().default('active'),
  notes: text('notes'),
  createdById: text('created_by_id').references(() => users.id, { onDelete: 'set null' }),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => [
  uniqueIndex('keyword_clusters_project_name_unique').on(table.projectId, table.name),
]);

export const keywordClusterMembers = sqliteTable('keyword_cluster_members', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  clusterId: integer('cluster_id').notNull().references(() => keywordClusters.id, { onDelete: 'cascade' }),
  keywordId: integer('keyword_id').notNull().references(() => keywords.id, { onDelete: 'cascade' }),
  role: text('role').notNull().default('secondary'),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => [
  uniqueIndex('keyword_cluster_members_unique').on(table.clusterId, table.keywordId),
]);

// ── Sites ─────────────────────────────────────────────────────────

export const sites = sqliteTable('sites', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  projectId: integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  domain: text('domain').notNull(),
  sitemapUrl: text('sitemap_url'),
  gscProperty: text('gsc_property'),
  gscAccessToken: text('gsc_access_token'),
  gscRefreshToken: text('gsc_refresh_token'),
  gscTokenExpiresAt: text('gsc_token_expires_at'),
  gscConnectedAt: text('gsc_connected_at'),
  gscLastSyncAt: text('gsc_last_sync_at'),
  gscLastSyncStatus: text('gsc_last_sync_status').notNull().default('never'),
  gscLastError: text('gsc_last_error'),
  crawlLastRunAt: text('crawl_last_run_at'),
  crawlLastRunStatus: text('crawl_last_run_status').notNull().default('never'),
  crawlLastError: text('crawl_last_error'),
  autoCrawlEnabled: integer('auto_crawl_enabled').notNull().default(1),
  autoGscEnabled: integer('auto_gsc_enabled').notNull().default(1),
  crawlFrequencyHours: integer('crawl_frequency_hours').notNull().default(24),
  isPrimary: integer('is_primary').notNull().default(1),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => [
  uniqueIndex('sites_project_domain_unique').on(table.projectId, table.domain),
]);

export const gscPageDailyMetrics = sqliteTable('gsc_page_daily_metrics', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  projectId: integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  siteId: integer('site_id').references(() => sites.id, { onDelete: 'set null' }),
  pageId: integer('page_id').references(() => pages.id, { onDelete: 'set null' }),
  date: text('date').notNull(),
  url: text('url').notNull(),
  normalizedUrl: text('normalized_url').notNull(),
  clicks: real('clicks').notNull().default(0),
  impressions: real('impressions').notNull().default(0),
  ctr: real('ctr').notNull().default(0),
  position: real('position').notNull().default(0),
  source: text('source').notNull().default('gsc'),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => [
  uniqueIndex('gsc_metrics_unique_project_date_url').on(table.projectId, table.date, table.normalizedUrl),
]);

// ── Pages & Crawls ────────────────────────────────────────────────

export const pages = sqliteTable('pages', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  projectId: integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  siteId: integer('site_id').references(() => sites.id, { onDelete: 'set null' }),
  url: text('url').notNull(),
  normalizedUrl: text('normalized_url').notNull().default(''),
  urlHash: text('url_hash'),
  title: text('title'),
  canonicalUrl: text('canonical_url'),
  httpStatus: integer('http_status'),
  isIndexable: integer('is_indexable').default(1),
  isVerified: integer('is_verified').default(0),
  discoverySource: text('discovery_source').notNull().default('inventory'),
  eligibilityState: text('eligibility_state').notNull().default('eligible'),
  excludeReason: text('exclude_reason'),
  responseTimeMs: integer('response_time_ms'),
  contentHash: text('content_hash'),
  firstSeenAt: text('first_seen_at'),
  lastSeenAt: text('last_seen_at'),
  isActive: integer('is_active').notNull().default(1),
  lastCrawledAt: text('last_crawled_at'),
  latestRawArtifactId: integer('latest_raw_artifact_id'),
  latestCleanArtifactId: integer('latest_clean_artifact_id'),
  latestGradeArtifactId: integer('latest_grade_artifact_id'),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => [
  uniqueIndex('pages_project_url_unique').on(table.projectId, table.url),
  uniqueIndex('pages_project_normalized_url_unique').on(table.projectId, table.normalizedUrl),
]);

export const siteDiscoveryUrls = sqliteTable('site_discovery_urls', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  projectId: integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  siteId: integer('site_id').references(() => sites.id, { onDelete: 'set null' }),
  pageId: integer('page_id').references(() => pages.id, { onDelete: 'set null' }),
  url: text('url').notNull(),
  normalizedUrl: text('normalized_url').notNull(),
  source: text('source').notNull().default('inventory'),
  isCandidate: integer('is_candidate').notNull().default(0),
  excludeReason: text('exclude_reason'),
  canonicalTarget: text('canonical_target'),
  httpStatus: integer('http_status'),
  robots: text('robots'),
  metadata: text('metadata', { mode: 'json' }),
  seenAt: text('seen_at').notNull().$defaultFn(() => new Date().toISOString()),
  lastSeenAt: text('last_seen_at').notNull().$defaultFn(() => new Date().toISOString()),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => [
  uniqueIndex('site_discovery_urls_unique').on(table.projectId, table.normalizedUrl),
]);

export const crawlRuns = sqliteTable('crawl_runs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  projectId: integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  siteId: integer('site_id').references(() => sites.id, { onDelete: 'set null' }),
  runType: text('run_type').notNull().default('manual'),
  status: text('status').notNull().default('queued'),
  totalUrls: integer('total_urls').notNull().default(0),
  processedUrls: integer('processed_urls').notNull().default(0),
  successUrls: integer('success_urls').notNull().default(0),
  failedUrls: integer('failed_urls').notNull().default(0),
  startedAt: text('started_at'),
  finishedAt: text('finished_at'),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()),
});

export const crawlQueue = sqliteTable('crawl_queue', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  runId: integer('run_id').notNull().references(() => crawlRuns.id, { onDelete: 'cascade' }),
  projectId: integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  siteId: integer('site_id').references(() => sites.id, { onDelete: 'set null' }),
  pageId: integer('page_id').references(() => pages.id, { onDelete: 'set null' }),
  url: text('url').notNull(),
  normalizedUrl: text('normalized_url').notNull(),
  priority: integer('priority').notNull().default(50),
  state: text('state').notNull().default('queued'),
  attempts: integer('attempts').notNull().default(0),
  maxAttempts: integer('max_attempts').notNull().default(3),
  nextAttemptAt: text('next_attempt_at'),
  leaseUntil: text('lease_until'),
  lastError: text('last_error'),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => [
  uniqueIndex('crawl_queue_run_normalized_unique').on(table.runId, table.normalizedUrl),
]);

export const pageSnapshots = sqliteTable('page_snapshots', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  pageId: integer('page_id').notNull().references(() => pages.id, { onDelete: 'cascade' }),
  runId: integer('run_id').references(() => crawlRuns.id, { onDelete: 'set null' }),
  httpStatus: integer('http_status'),
  canonicalUrl: text('canonical_url'),
  metaRobots: text('meta_robots'),
  isIndexable: integer('is_indexable').default(1),
  isVerified: integer('is_verified').default(0),
  responseTimeMs: integer('response_time_ms'),
  seoScore: real('seo_score'),
  issuesCount: integer('issues_count').default(0),
  snapshotData: text('snapshot_data', { mode: 'json' }),
  rawArtifactId: integer('raw_artifact_id'),
  cleanArtifactId: integer('clean_artifact_id'),
  gradeArtifactId: integer('grade_artifact_id'),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
});

export const pageArtifacts = sqliteTable('page_artifacts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  projectId: integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  pageId: integer('page_id').notNull().references(() => pages.id, { onDelete: 'cascade' }),
  runId: integer('run_id').references(() => crawlRuns.id, { onDelete: 'set null' }),
  snapshotId: integer('snapshot_id').notNull().references(() => pageSnapshots.id, { onDelete: 'cascade' }),
  artifactType: text('artifact_type').notNull(),
  status: text('status').notNull().default('queued'),
  version: integer('version').notNull().default(1),
  objectKey: text('object_key'),
  checksum: text('checksum'),
  sizeBytes: integer('size_bytes'),
  mimeType: text('mime_type'),
  gradeScore: real('grade_score'),
  metadata: text('metadata', { mode: 'json' }),
  lastError: text('last_error'),
  attempts: integer('attempts').notNull().default(0),
  maxAttempts: integer('max_attempts').notNull().default(3),
  nextAttemptAt: text('next_attempt_at'),
  readyAt: text('ready_at'),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => [
  index('page_artifacts_project_page_idx').on(table.projectId, table.pageId, table.createdAt),
  index('page_artifacts_snapshot_type_idx').on(table.snapshotId, table.artifactType, table.version),
  index('page_artifacts_status_idx').on(table.status, table.nextAttemptAt),
]);

export const pageArtifactJobs = sqliteTable('page_artifact_jobs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  projectId: integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  pageId: integer('page_id').notNull().references(() => pages.id, { onDelete: 'cascade' }),
  runId: integer('run_id').references(() => crawlRuns.id, { onDelete: 'set null' }),
  snapshotId: integer('snapshot_id').notNull().references(() => pageSnapshots.id, { onDelete: 'cascade' }),
  action: text('action').notNull().default('process'),
  state: text('state').notNull().default('queued'),
  attempts: integer('attempts').notNull().default(0),
  maxAttempts: integer('max_attempts').notNull().default(3),
  nextAttemptAt: text('next_attempt_at'),
  leaseUntil: text('lease_until'),
  lastError: text('last_error'),
  payload: text('payload', { mode: 'json' }),
  startedAt: text('started_at'),
  finishedAt: text('finished_at'),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => [
  index('page_artifact_jobs_state_idx').on(table.state, table.nextAttemptAt, table.createdAt),
  index('page_artifact_jobs_snapshot_action_state_idx').on(table.snapshotId, table.action, table.state),
]);

export const pageIssues = sqliteTable('page_issues', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  pageId: integer('page_id').notNull().references(() => pages.id, { onDelete: 'cascade' }),
  snapshotId: integer('snapshot_id').references(() => pageSnapshots.id, { onDelete: 'set null' }),
  issueType: text('issue_type').notNull(),
  severity: text('severity').notNull().default('medium'),
  message: text('message').notNull(),
  isOpen: integer('is_open').default(1),
  metadata: text('metadata', { mode: 'json' }),
  firstSeenAt: text('first_seen_at').notNull().$defaultFn(() => new Date().toISOString()),
  lastSeenAt: text('last_seen_at').notNull().$defaultFn(() => new Date().toISOString()),
  resolvedAt: text('resolved_at'),
});

export const documentPageLinks = sqliteTable('document_page_links', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  documentId: integer('document_id').notNull().references(() => documents.id, { onDelete: 'cascade' }),
  pageId: integer('page_id').notNull().references(() => pages.id, { onDelete: 'cascade' }),
  relationType: text('relation_type').notNull().default('primary'),
  isPrimary: integer('is_primary').notNull().default(0),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => [
  uniqueIndex('document_page_links_unique').on(table.documentId, table.pageId, table.relationType),
]);

export const taskPageLinks = sqliteTable('task_page_links', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  taskId: text('task_id').notNull(),
  projectId: integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  pageId: integer('page_id').references(() => pages.id, { onDelete: 'set null' }),
  keywordId: integer('keyword_id').references(() => keywords.id, { onDelete: 'set null' }),
  linkType: text('link_type').notNull().default('related'),
  annotationDate: text('annotation_date'),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => [
  uniqueIndex('task_page_links_unique').on(table.taskId, table.pageId, table.linkType),
]);

export const pageKeywordMappings = sqliteTable('page_keyword_mappings', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  projectId: integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  pageId: integer('page_id').notNull().references(() => pages.id, { onDelete: 'cascade' }),
  keywordId: integer('keyword_id').notNull().references(() => keywords.id, { onDelete: 'cascade' }),
  mappingType: text('mapping_type').notNull().default('secondary'),
  clusterKey: text('cluster_key'),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => [
  uniqueIndex('page_keyword_mappings_unique').on(table.pageId, table.keywordId, table.mappingType),
]);

// ── Observability ─────────────────────────────────────────────────

export const auditLogs = sqliteTable('audit_logs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
  action: text('action').notNull(),
  resourceType: text('resource_type').notNull(),
  resourceId: text('resource_id'),
  projectId: integer('project_id').references(() => projects.id, { onDelete: 'set null' }),
  severity: text('severity').notNull().default('info'),
  metadata: text('metadata', { mode: 'json' }),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
});

export const alertEvents = sqliteTable('alert_events', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  source: text('source').notNull(),
  eventType: text('event_type').notNull(),
  severity: text('severity').notNull().default('warning'),
  message: text('message').notNull(),
  projectId: integer('project_id').references(() => projects.id, { onDelete: 'set null' }),
  resourceId: text('resource_id'),
  metadata: text('metadata', { mode: 'json' }),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  resolvedAt: text('resolved_at'),
});
