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
