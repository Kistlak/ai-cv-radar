import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
  jsonb,
  integer,
  index,
  unique,
  date,
  primaryKey,
  check,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

// The only values searches.status takes. Typed via the column enum and
// enforced by the searches_status_check constraint.
export const SEARCH_STATUSES = ['running', 'complete', 'failed', 'cancelled'] as const
export type SearchStatus = (typeof SEARCH_STATUSES)[number]

export const profiles = pgTable('profiles', {
  id: uuid('id').primaryKey(),
  email: text('email').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

export const userApiKeys = pgTable('user_api_keys', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => profiles.id, { onDelete: 'cascade' }),
  anthropicKey: text('anthropic_key'),
  geminiKey: text('gemini_key'),
  preferredAiProvider: text('preferred_ai_provider').notNull().default('anthropic'),
  apifyToken: text('apify_token'),
  adzunaAppId: text('adzuna_app_id'),
  adzunaAppKey: text('adzuna_app_key'),
  rapidapiKey: text('rapidapi_key'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  // Added by 20260702_add_gemini_provider.sql; declared here so drizzle-kit
  // doesn't see it as drift and try to drop it.
  check('user_api_keys_preferred_ai_provider_check', sql`${table.preferredAiProvider} IN ('anthropic', 'gemini')`),
])

export const cvs = pgTable('cvs', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => profiles.id, { onDelete: 'cascade' }),
  filePath: text('file_path').notNull(),
  rawText: text('raw_text').notNull(),
  structured: jsonb('structured').notNull(),
  generalCv: jsonb('general_cv'),
  generalCoverLetter: text('general_cover_letter'),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('cvs_user_created_idx').on(table.userId, table.createdAt.desc()),
])

export const searches = pgTable('searches', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => profiles.id, { onDelete: 'cascade' }),
  cvId: uuid('cv_id')
    .notNull()
    .references(() => cvs.id, { onDelete: 'cascade' }),
  query: text('query').notNull(),
  location: text('location'),
  remoteOnly: boolean('remote_only').default(false).notNull(),
  sources: text('sources').array().notNull(),
  sourcesHash: text('sources_hash'),
  maxResults: integer('max_results'),
  status: text('status', { enum: SEARCH_STATUSES }).notNull().default('running'),
  error: text('error'),
  progress: jsonb('progress'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
}, (table) => [
  index('searches_user_created_idx').on(table.userId, table.createdAt.desc()),
  check('searches_status_check', sql`${table.status} IN ('running', 'complete', 'failed', 'cancelled')`),
])

export const jobResults = pgTable(
  'job_results',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    searchId: uuid('search_id')
      .notNull()
      .references(() => searches.id, { onDelete: 'cascade' }),
    source: text('source').notNull(),
    // Falls back to the apply URL when a source has no id (see run-search), so
    // the (search, source, source_job_id) dedupe always applies.
    sourceJobId: text('source_job_id').notNull(),
    title: text('title').notNull(),
    company: text('company').notNull(),
    location: text('location'),
    remote: boolean('remote').default(false).notNull(),
    salary: text('salary'),
    postedAt: timestamp('posted_at', { withTimezone: true }),
    description: text('description'),
    applyUrl: text('apply_url').notNull(),
    matchScore: integer('match_score'),
    matchReason: text('match_reason'),
    deepDive: jsonb('deep_dive'),
    coverLetter: text('cover_letter'),
    tailoredCv: jsonb('tailored_cv'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('job_results_search_score_idx').on(table.searchId, table.matchScore),
    unique('job_results_search_source_job_unique').on(
      table.searchId,
      table.source,
      table.sourceJobId
    ),
  ]
)

// Per-user daily usage of operator-paid (FALLBACK_*) keys. One row per
// user + action + UTC day; see lib/usage-limits.ts.
export const usageCounters = pgTable(
  'usage_counters',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    action: text('action').notNull(),
    day: date('day', { mode: 'string' }).notNull(),
    count: integer('count').default(0).notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.action, table.day] })]
)

export type Profile = typeof profiles.$inferSelect
export type UserApiKeys = typeof userApiKeys.$inferSelect
export type CV = typeof cvs.$inferSelect
export type Search = typeof searches.$inferSelect
export type JobResult = typeof jobResults.$inferSelect
