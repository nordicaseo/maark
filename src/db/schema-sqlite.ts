import {
  sqliteTable,
  text,
  integer,
  real,
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

// ── Invitations ──────────────────────────────────────────────────

export const invitations = sqliteTable('invitations', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  email: text('email'),
  role: text('role').notNull().default('writer'),
  token: text('token').notNull().unique(),
  invitedById: text('invited_by_id').references(() => users.id, { onDelete: 'set null' }),
  expiresAt: text('expires_at').notNull(),
  acceptedAt: text('accepted_at'),
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

// ── Pages & Crawls ────────────────────────────────────────────────

export const pages = sqliteTable('pages', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  projectId: integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  url: text('url').notNull(),
  title: text('title'),
  canonicalUrl: text('canonical_url'),
  httpStatus: integer('http_status'),
  isIndexable: integer('is_indexable').default(1),
  isVerified: integer('is_verified').default(0),
  responseTimeMs: integer('response_time_ms'),
  contentHash: text('content_hash'),
  lastCrawledAt: text('last_crawled_at'),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => [
  uniqueIndex('pages_project_url_unique').on(table.projectId, table.url),
]);

export const pageSnapshots = sqliteTable('page_snapshots', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  pageId: integer('page_id').notNull().references(() => pages.id, { onDelete: 'cascade' }),
  httpStatus: integer('http_status'),
  canonicalUrl: text('canonical_url'),
  metaRobots: text('meta_robots'),
  isIndexable: integer('is_indexable').default(1),
  isVerified: integer('is_verified').default(0),
  responseTimeMs: integer('response_time_ms'),
  seoScore: real('seo_score'),
  issuesCount: integer('issues_count').default(0),
  snapshotData: text('snapshot_data', { mode: 'json' }),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
});

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
