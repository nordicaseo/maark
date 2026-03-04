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
  token: text('token').notNull().unique(),
  invitedById: text('invited_by_id').references(() => users.id, { onDelete: 'set null' }),
  expiresAt: timestamp('expires_at').notNull(),
  acceptedAt: timestamp('accepted_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
