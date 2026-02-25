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
} from 'drizzle-orm/pg-core';

export const documentStatusEnum = pgEnum('document_status', [
  'draft',
  'in_progress',
  'review',
  'published',
]);

export const contentTypeEnum = pgEnum('content_type', [
  'blog_post',
  'product_review',
  'how_to_guide',
  'listicle',
  'comparison',
  'news_article',
]);

export const documents = pgTable('documents', {
  id: serial('id').primaryKey(),
  title: varchar('title', { length: 500 }).notNull().default('Untitled'),
  content: jsonb('content'),
  plainText: text('plain_text'),
  status: documentStatusEnum('status').notNull().default('draft'),
  contentType: contentTypeEnum('content_type').notNull().default('blog_post'),
  targetKeyword: varchar('target_keyword', { length: 300 }),
  wordCount: integer('word_count').default(0),
  aiDetectionScore: real('ai_detection_score'),
  aiRiskLevel: varchar('ai_risk_level', { length: 20 }),
  semanticScore: real('semantic_score'),
  contentQualityScore: real('content_quality_score'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const serpCache = pgTable('serp_cache', {
  id: serial('id').primaryKey(),
  keyword: varchar('keyword', { length: 300 }).notNull().unique(),
  entities: jsonb('entities').notNull(),
  lsiKeywords: jsonb('lsi_keywords').notNull(),
  topUrls: jsonb('top_urls').notNull(),
  fetchedAt: timestamp('fetched_at').defaultNow().notNull(),
});

export const analysisSnapshots = pgTable('analysis_snapshots', {
  id: serial('id').primaryKey(),
  documentId: integer('document_id')
    .notNull()
    .references(() => documents.id, { onDelete: 'cascade' }),
  analysisType: varchar('analysis_type', { length: 50 }).notNull(),
  resultData: jsonb('result_data').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
