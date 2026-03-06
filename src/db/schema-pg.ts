import {
  pgTable,
  serial,
  text,
  timestamp,
  jsonb,
  integer,
  real,
  varchar,
  pgEnum,
  boolean,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

// ── Enums ──────────────────────────────────────────────────────────

export const documentStatusEnum = pgEnum('document_status', [
  'draft',
  'in_progress',
  'review',
  'accepted',
  'published',
  'publish',
  'live',
]);

// ── Users ─────────────────────────────────────────────────────────

export const users = pgTable('users', {
  id: text('id').primaryKey(), // Supabase auth user UUID
  name: varchar('name', { length: 200 }),
  email: varchar('email', { length: 300 }).notNull().unique(),
  image: text('image'),
  role: varchar('role', { length: 30 }).notNull().default('writer'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// ── Documents ──────────────────────────────────────────────────────

export const documents = pgTable('documents', {
  id: serial('id').primaryKey(),
  projectId: integer('project_id').references(() => projects.id, { onDelete: 'set null' }),
  authorId: text('author_id').references(() => users.id, { onDelete: 'set null' }),
  title: varchar('title', { length: 500 }).notNull().default('Untitled'),
  content: jsonb('content'),
  plainText: text('plain_text'),
  status: documentStatusEnum('status').notNull().default('draft'),
  contentType: varchar('content_type', { length: 50 }).notNull().default('blog_post'),
  targetKeyword: varchar('target_keyword', { length: 300 }),
  wordCount: integer('word_count').default(0),
  aiDetectionScore: real('ai_detection_score'),
  aiRiskLevel: varchar('ai_risk_level', { length: 20 }),
  semanticScore: real('semantic_score'),
  contentQualityScore: real('content_quality_score'),
  researchSnapshot: jsonb('research_snapshot'),
  outlineSnapshot: jsonb('outline_snapshot'),
  prewriteChecklist: jsonb('prewrite_checklist'),
  agentQuestions: jsonb('agent_questions'),
  previewToken: text('preview_token'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// ── SERP Cache ─────────────────────────────────────────────────────

export const serpCache = pgTable('serp_cache', {
  id: serial('id').primaryKey(),
  keyword: varchar('keyword', { length: 300 }).notNull().unique(),
  entities: jsonb('entities').notNull(),
  lsiKeywords: jsonb('lsi_keywords').notNull(),
  topUrls: jsonb('top_urls').notNull(),
  fetchedAt: timestamp('fetched_at').defaultNow().notNull(),
});

// ── Analysis Snapshots ─────────────────────────────────────────────

export const analysisSnapshots = pgTable('analysis_snapshots', {
  id: serial('id').primaryKey(),
  documentId: integer('document_id')
    .notNull()
    .references(() => documents.id, { onDelete: 'cascade' }),
  analysisType: varchar('analysis_type', { length: 50 }).notNull(),
  resultData: jsonb('result_data').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// ── Projects ───────────────────────────────────────────────────────

export const projects = pgTable('projects', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 200 }).notNull(),
  description: text('description'),
  defaultContentFormat: varchar('default_content_format', { length: 50 }).default('blog_post'),
  brandVoice: text('brand_voice'),
  settings: jsonb('settings'),
  createdById: text('created_by_id').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const projectMembers = pgTable('project_members', {
  id: serial('id').primaryKey(),
  projectId: integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: varchar('role', { length: 30 }).default('writer'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('project_members_unique').on(table.projectId, table.userId),
]);

export const userPresence = pgTable('user_presence', {
  id: serial('id').primaryKey(),
  projectId: integer('project_id').notNull().default(0),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  isOnline: boolean('is_online').notNull().default(false),
  lastSeenAt: timestamp('last_seen_at'),
  onlineSeconds: integer('online_seconds').notNull().default(0),
  activeSeconds: integer('active_seconds').notNull().default(0),
  heartbeatCount: integer('heartbeat_count').notNull().default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('user_presence_unique_project_user').on(table.projectId, table.userId),
  index('user_presence_project_idx').on(table.projectId),
  index('user_presence_user_idx').on(table.userId),
]);

// ── Skills ─────────────────────────────────────────────────────────

export const skills = pgTable('skills', {
  id: serial('id').primaryKey(),
  projectId: integer('project_id').references(() => projects.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 300 }).notNull(),
  description: text('description'),
  content: text('content').notNull(),
  isGlobal: integer('is_global').default(0),
  createdById: text('created_by_id').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// ── Project Agent Profiles ────────────────────────────────────────

export const projectAgentProfiles = pgTable('project_agent_profiles', {
  id: serial('id').primaryKey(),
  projectId: integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  role: varchar('role', { length: 60 }).notNull(),
  displayName: varchar('display_name', { length: 200 }).notNull(),
  emoji: varchar('emoji', { length: 16 }),
  avatarUrl: text('avatar_url'),
  shortDescription: text('short_description'),
  mission: text('mission'),
  isEnabled: boolean('is_enabled').notNull().default(true),
  fileBundle: jsonb('file_bundle'),
  skillIds: jsonb('skill_ids'),
  modelOverrides: jsonb('model_overrides'),
  heartbeatMeta: jsonb('heartbeat_meta'),
  createdById: text('created_by_id').references(() => users.id, { onDelete: 'set null' }),
  updatedById: text('updated_by_id').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('project_agent_profiles_unique_project_role').on(table.projectId, table.role),
]);

export const agentSharedProfiles = pgTable('agent_shared_profiles', {
  id: serial('id').primaryKey(),
  key: varchar('key', { length: 120 }).notNull().unique(),
  content: text('content').notNull().default(''),
  updatedById: text('updated_by_id').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// ── Skill Parts ──────────────────────────────────────────────────

export const skillParts = pgTable('skill_parts', {
  id: serial('id').primaryKey(),
  skillId: integer('skill_id').notNull().references(() => skills.id, { onDelete: 'cascade' }),
  partType: varchar('part_type', { length: 50 }).notNull().default('custom'),
  label: varchar('label', { length: 200 }).notNull(),
  content: text('content').notNull().default(''),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// ── Document Comments ─────────────────────────────────────────────

export const documentComments = pgTable('document_comments', {
  id: serial('id').primaryKey(),
  documentId: integer('document_id').notNull().references(() => documents.id, { onDelete: 'cascade' }),
  previewToken: text('preview_token').notNull(),
  authorName: varchar('author_name', { length: 200 }).notNull(),
  content: text('content').notNull(),
  quotedText: text('quoted_text'),
  selectionFrom: integer('selection_from'),
  selectionTo: integer('selection_to'),
  isResolved: integer('is_resolved').default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// ── AI Providers & Model Config ────────────────────────────────────

export const aiProviders = pgTable('ai_providers', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 50 }).notNull(),
  displayName: varchar('display_name', { length: 100 }),
  apiKey: text('api_key').notNull(),
  isActive: boolean('is_active').default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const aiModelConfig = pgTable('ai_model_config', {
  id: serial('id').primaryKey(),
  action: varchar('action', { length: 50 }).notNull().unique(),
  providerId: integer('provider_id').notNull().references(() => aiProviders.id, { onDelete: 'cascade' }),
  model: varchar('model', { length: 100 }).notNull(),
  maxTokens: integer('max_tokens').default(4096),
  temperature: real('temperature').default(1.0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// ── Invitations ──────────────────────────────────────────────────

export const invitations = pgTable('invitations', {
  id: serial('id').primaryKey(),
  email: varchar('email', { length: 300 }),
  role: varchar('role', { length: 30 }).notNull().default('writer'),
  projectIds: jsonb('project_ids'),
  projectRole: varchar('project_role', { length: 30 }),
  token: text('token').notNull().unique(),
  invitedById: text('invited_by_id').references(() => users.id, { onDelete: 'set null' }),
  expiresAt: timestamp('expires_at').notNull(),
  acceptedAt: timestamp('accepted_at'),
  revokedAt: timestamp('revoked_at'),
  lastSentAt: timestamp('last_sent_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// ── Keywords ───────────────────────────────────────────────────────

export const keywords = pgTable('keywords', {
  id: serial('id').primaryKey(),
  projectId: integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  keyword: varchar('keyword', { length: 500 }).notNull(),
  intent: varchar('intent', { length: 50 }).notNull().default('informational'),
  status: varchar('status', { length: 50 }).notNull().default('new'),
  priority: varchar('priority', { length: 30 }).notNull().default('medium'),
  ownerId: text('owner_id').references(() => users.id, { onDelete: 'set null' }),
  volume: integer('volume'),
  difficulty: integer('difficulty'),
  targetUrl: text('target_url'),
  notes: text('notes'),
  lastTaskId: text('last_task_id'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('keywords_project_keyword_unique').on(table.projectId, table.keyword),
]);

export const keywordClusters = pgTable('keyword_clusters', {
  id: serial('id').primaryKey(),
  projectId: integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 300 }).notNull(),
  mainKeywordId: integer('main_keyword_id').references(() => keywords.id, { onDelete: 'set null' }),
  status: varchar('status', { length: 30 }).notNull().default('active'),
  notes: text('notes'),
  createdById: text('created_by_id').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('keyword_clusters_project_name_unique').on(table.projectId, table.name),
]);

export const keywordClusterMembers = pgTable('keyword_cluster_members', {
  id: serial('id').primaryKey(),
  clusterId: integer('cluster_id').notNull().references(() => keywordClusters.id, { onDelete: 'cascade' }),
  keywordId: integer('keyword_id').notNull().references(() => keywords.id, { onDelete: 'cascade' }),
  role: varchar('role', { length: 24 }).notNull().default('secondary'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('keyword_cluster_members_unique').on(table.clusterId, table.keywordId),
]);

// ── Sites ─────────────────────────────────────────────────────────

export const sites = pgTable('sites', {
  id: serial('id').primaryKey(),
  projectId: integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  domain: text('domain').notNull(),
  sitemapUrl: text('sitemap_url'),
  gscProperty: text('gsc_property'),
  gscAccessToken: text('gsc_access_token'),
  gscRefreshToken: text('gsc_refresh_token'),
  gscTokenExpiresAt: timestamp('gsc_token_expires_at'),
  gscConnectedAt: timestamp('gsc_connected_at'),
  gscLastSyncAt: timestamp('gsc_last_sync_at'),
  gscLastSyncStatus: varchar('gsc_last_sync_status', { length: 24 }).notNull().default('never'),
  gscLastError: text('gsc_last_error'),
  crawlLastRunAt: timestamp('crawl_last_run_at'),
  crawlLastRunStatus: varchar('crawl_last_run_status', { length: 24 }).notNull().default('never'),
  crawlLastError: text('crawl_last_error'),
  autoCrawlEnabled: boolean('auto_crawl_enabled').notNull().default(true),
  autoGscEnabled: boolean('auto_gsc_enabled').notNull().default(true),
  crawlFrequencyHours: integer('crawl_frequency_hours').notNull().default(24),
  isPrimary: integer('is_primary').notNull().default(1),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('sites_project_domain_unique').on(table.projectId, table.domain),
]);

export const gscPageDailyMetrics = pgTable('gsc_page_daily_metrics', {
  id: serial('id').primaryKey(),
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
  source: varchar('source', { length: 24 }).notNull().default('gsc'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('gsc_metrics_unique_project_date_url').on(table.projectId, table.date, table.normalizedUrl),
]);

// ── Pages & Crawls ────────────────────────────────────────────────

export const pages = pgTable('pages', {
  id: serial('id').primaryKey(),
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
  discoverySource: varchar('discovery_source', { length: 32 }).notNull().default('inventory'),
  eligibilityState: varchar('eligibility_state', { length: 24 }).notNull().default('eligible'),
  excludeReason: varchar('exclude_reason', { length: 120 }),
  responseTimeMs: integer('response_time_ms'),
  contentHash: text('content_hash'),
  firstSeenAt: timestamp('first_seen_at'),
  lastSeenAt: timestamp('last_seen_at'),
  isActive: integer('is_active').notNull().default(1),
  lastCrawledAt: timestamp('last_crawled_at'),
  latestRawArtifactId: integer('latest_raw_artifact_id'),
  latestCleanArtifactId: integer('latest_clean_artifact_id'),
  latestGradeArtifactId: integer('latest_grade_artifact_id'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('pages_project_url_unique').on(table.projectId, table.url),
  uniqueIndex('pages_project_normalized_url_unique').on(table.projectId, table.normalizedUrl),
]);

export const siteDiscoveryUrls = pgTable('site_discovery_urls', {
  id: serial('id').primaryKey(),
  projectId: integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  siteId: integer('site_id').references(() => sites.id, { onDelete: 'set null' }),
  pageId: integer('page_id').references(() => pages.id, { onDelete: 'set null' }),
  url: text('url').notNull(),
  normalizedUrl: text('normalized_url').notNull(),
  source: varchar('source', { length: 24 }).notNull().default('inventory'),
  isCandidate: integer('is_candidate').notNull().default(0),
  excludeReason: varchar('exclude_reason', { length: 120 }),
  canonicalTarget: text('canonical_target'),
  httpStatus: integer('http_status'),
  robots: text('robots'),
  metadata: jsonb('metadata'),
  seenAt: timestamp('seen_at').defaultNow().notNull(),
  lastSeenAt: timestamp('last_seen_at').defaultNow().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('site_discovery_urls_unique').on(table.projectId, table.normalizedUrl),
]);

export const crawlRuns = pgTable('crawl_runs', {
  id: serial('id').primaryKey(),
  projectId: integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  siteId: integer('site_id').references(() => sites.id, { onDelete: 'set null' }),
  runType: varchar('run_type', { length: 40 }).notNull().default('manual'),
  status: varchar('status', { length: 40 }).notNull().default('queued'),
  totalUrls: integer('total_urls').notNull().default(0),
  processedUrls: integer('processed_urls').notNull().default(0),
  successUrls: integer('success_urls').notNull().default(0),
  failedUrls: integer('failed_urls').notNull().default(0),
  startedAt: timestamp('started_at'),
  finishedAt: timestamp('finished_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const crawlQueue = pgTable('crawl_queue', {
  id: serial('id').primaryKey(),
  runId: integer('run_id').notNull().references(() => crawlRuns.id, { onDelete: 'cascade' }),
  projectId: integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  siteId: integer('site_id').references(() => sites.id, { onDelete: 'set null' }),
  pageId: integer('page_id').references(() => pages.id, { onDelete: 'set null' }),
  url: text('url').notNull(),
  normalizedUrl: text('normalized_url').notNull(),
  priority: integer('priority').notNull().default(50),
  state: varchar('state', { length: 40 }).notNull().default('queued'),
  attempts: integer('attempts').notNull().default(0),
  maxAttempts: integer('max_attempts').notNull().default(3),
  nextAttemptAt: timestamp('next_attempt_at'),
  leaseUntil: timestamp('lease_until'),
  lastError: text('last_error'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('crawl_queue_run_normalized_unique').on(table.runId, table.normalizedUrl),
]);

export const pageSnapshots = pgTable('page_snapshots', {
  id: serial('id').primaryKey(),
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
  snapshotData: jsonb('snapshot_data'),
  rawArtifactId: integer('raw_artifact_id'),
  cleanArtifactId: integer('clean_artifact_id'),
  gradeArtifactId: integer('grade_artifact_id'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const pageArtifacts = pgTable('page_artifacts', {
  id: serial('id').primaryKey(),
  projectId: integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  pageId: integer('page_id').notNull().references(() => pages.id, { onDelete: 'cascade' }),
  runId: integer('run_id').references(() => crawlRuns.id, { onDelete: 'set null' }),
  snapshotId: integer('snapshot_id').notNull().references(() => pageSnapshots.id, { onDelete: 'cascade' }),
  artifactType: varchar('artifact_type', { length: 32 }).notNull(),
  status: varchar('status', { length: 32 }).notNull().default('queued'),
  version: integer('version').notNull().default(1),
  objectKey: text('object_key'),
  checksum: text('checksum'),
  sizeBytes: integer('size_bytes'),
  mimeType: varchar('mime_type', { length: 120 }),
  gradeScore: real('grade_score'),
  metadata: jsonb('metadata'),
  lastError: text('last_error'),
  attempts: integer('attempts').notNull().default(0),
  maxAttempts: integer('max_attempts').notNull().default(3),
  nextAttemptAt: timestamp('next_attempt_at'),
  readyAt: timestamp('ready_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  index('page_artifacts_project_page_idx').on(table.projectId, table.pageId, table.createdAt),
  index('page_artifacts_snapshot_type_idx').on(table.snapshotId, table.artifactType, table.version),
  index('page_artifacts_status_idx').on(table.status, table.nextAttemptAt),
]);

export const pageArtifactJobs = pgTable('page_artifact_jobs', {
  id: serial('id').primaryKey(),
  projectId: integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  pageId: integer('page_id').notNull().references(() => pages.id, { onDelete: 'cascade' }),
  runId: integer('run_id').references(() => crawlRuns.id, { onDelete: 'set null' }),
  snapshotId: integer('snapshot_id').notNull().references(() => pageSnapshots.id, { onDelete: 'cascade' }),
  action: varchar('action', { length: 32 }).notNull().default('process'),
  state: varchar('state', { length: 32 }).notNull().default('queued'),
  attempts: integer('attempts').notNull().default(0),
  maxAttempts: integer('max_attempts').notNull().default(3),
  nextAttemptAt: timestamp('next_attempt_at'),
  leaseUntil: timestamp('lease_until'),
  lastError: text('last_error'),
  payload: jsonb('payload'),
  startedAt: timestamp('started_at'),
  finishedAt: timestamp('finished_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  index('page_artifact_jobs_state_idx').on(table.state, table.nextAttemptAt, table.createdAt),
  index('page_artifact_jobs_snapshot_action_state_idx').on(table.snapshotId, table.action, table.state),
]);

export const pageIssues = pgTable('page_issues', {
  id: serial('id').primaryKey(),
  pageId: integer('page_id').notNull().references(() => pages.id, { onDelete: 'cascade' }),
  snapshotId: integer('snapshot_id').references(() => pageSnapshots.id, { onDelete: 'set null' }),
  issueType: varchar('issue_type', { length: 120 }).notNull(),
  severity: varchar('severity', { length: 20 }).notNull().default('medium'),
  message: text('message').notNull(),
  isOpen: integer('is_open').default(1),
  metadata: jsonb('metadata'),
  firstSeenAt: timestamp('first_seen_at').defaultNow().notNull(),
  lastSeenAt: timestamp('last_seen_at').defaultNow().notNull(),
  resolvedAt: timestamp('resolved_at'),
});

export const documentPageLinks = pgTable('document_page_links', {
  id: serial('id').primaryKey(),
  documentId: integer('document_id').notNull().references(() => documents.id, { onDelete: 'cascade' }),
  pageId: integer('page_id').notNull().references(() => pages.id, { onDelete: 'cascade' }),
  relationType: varchar('relation_type', { length: 40 }).notNull().default('primary'),
  isPrimary: integer('is_primary').notNull().default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('document_page_links_unique').on(table.documentId, table.pageId, table.relationType),
]);

export const taskPageLinks = pgTable('task_page_links', {
  id: serial('id').primaryKey(),
  taskId: text('task_id').notNull(),
  projectId: integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  pageId: integer('page_id').references(() => pages.id, { onDelete: 'set null' }),
  keywordId: integer('keyword_id').references(() => keywords.id, { onDelete: 'set null' }),
  linkType: varchar('link_type', { length: 40 }).notNull().default('related'),
  annotationDate: timestamp('annotation_date'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('task_page_links_unique').on(table.taskId, table.pageId, table.linkType),
]);

export const pageKeywordMappings = pgTable('page_keyword_mappings', {
  id: serial('id').primaryKey(),
  projectId: integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  pageId: integer('page_id').notNull().references(() => pages.id, { onDelete: 'cascade' }),
  keywordId: integer('keyword_id').notNull().references(() => keywords.id, { onDelete: 'cascade' }),
  mappingType: varchar('mapping_type', { length: 24 }).notNull().default('secondary'),
  clusterKey: text('cluster_key'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('page_keyword_mappings_unique').on(table.pageId, table.keywordId, table.mappingType),
]);

// ── Observability ─────────────────────────────────────────────────

export const auditLogs = pgTable('audit_logs', {
  id: serial('id').primaryKey(),
  userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
  action: varchar('action', { length: 120 }).notNull(),
  resourceType: varchar('resource_type', { length: 60 }).notNull(),
  resourceId: text('resource_id'),
  projectId: integer('project_id').references(() => projects.id, { onDelete: 'set null' }),
  severity: varchar('severity', { length: 20 }).notNull().default('info'),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const alertEvents = pgTable('alert_events', {
  id: serial('id').primaryKey(),
  source: varchar('source', { length: 80 }).notNull(),
  eventType: varchar('event_type', { length: 120 }).notNull(),
  severity: varchar('severity', { length: 20 }).notNull().default('warning'),
  message: text('message').notNull(),
  projectId: integer('project_id').references(() => projects.id, { onDelete: 'set null' }),
  resourceId: text('resource_id'),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  resolvedAt: timestamp('resolved_at'),
});
