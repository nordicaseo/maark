import {
  sqliteTable,
  text,
  integer,
  real,
} from 'drizzle-orm/sqlite-core';

export const documents = sqliteTable('documents', {
  id: integer('id').primaryKey({ autoIncrement: true }),
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
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()),
});

export const serpCache = sqliteTable('serp_cache', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  keyword: text('keyword').notNull().unique(),
  entities: text('entities', { mode: 'json' }).notNull(),
  lsiKeywords: text('lsi_keywords', { mode: 'json' }).notNull(),
  topUrls: text('top_urls', { mode: 'json' }).notNull(),
  fetchedAt: text('fetched_at').notNull().$defaultFn(() => new Date().toISOString()),
});

export const analysisSnapshots = sqliteTable('analysis_snapshots', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  documentId: integer('document_id').notNull().references(() => documents.id, { onDelete: 'cascade' }),
  analysisType: text('analysis_type').notNull(),
  resultData: text('result_data', { mode: 'json' }).notNull(),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
});
