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
} from 'drizzle-orm/pg-core'

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
  apifyToken: text('apify_token'),
  adzunaAppId: text('adzuna_app_id'),
  adzunaAppKey: text('adzuna_app_key'),
  rapidapiKey: text('rapidapi_key'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

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
})

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
  status: text('status').notNull().default('running'),
  error: text('error'),
  progress: jsonb('progress'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
})

export const jobResults = pgTable(
  'job_results',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    searchId: uuid('search_id')
      .notNull()
      .references(() => searches.id, { onDelete: 'cascade' }),
    source: text('source').notNull(),
    sourceJobId: text('source_job_id'),
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

export type Profile = typeof profiles.$inferSelect
export type UserApiKeys = typeof userApiKeys.$inferSelect
export type CV = typeof cvs.$inferSelect
export type Search = typeof searches.$inferSelect
export type JobResult = typeof jobResults.$inferSelect
