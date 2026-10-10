# Database migrations

The SQL files in this folder are the source of truth for the database schema.
They are hand-written, and `db/schema.ts` mirrors them for Drizzle's types.

## Rules

- **Add a new file for every change.** Name it `YYYYMMDD_short_description.sql`.
  Files are applied in date order.
- **Never edit a file that has already been applied.** Fix forward with a new
  file instead.
- **Keep `db/schema.ts` in sync** in the same commit: columns, indexes and
  CHECK constraints. Otherwise Drizzle's types drift from the real database.
- **Never run `drizzle-kit push` against the hosted database.** It diffs the
  schema file against the database and can drop things it doesn't know about.
- Prefer re-runnable SQL (`IF NOT EXISTS`, or guarded `DO $$ … $$` blocks).

## Applying a migration

```bash
npm run db:apply -- supabase/migrations/<file>.sql
```

This runs the file in one transaction against `DATABASE_URL` from `.env.local`.
Either the whole file applies or nothing does. Then verify the change, for
example by checking `pg_constraint` or `pg_indexes`, or with `\d <table>` in psql.

## Applied to the hosted database

| File | Applied |
|---|---|
| `20260418_add_max_results.sql` … `20260702_add_gemini_provider.sql` | before 2026-10 |
| `20261008_add_usage_counters.sql` | 2026-10-08 |
| `20261009_add_user_created_indexes.sql` | 2026-10-08 |
| `20261010_job_results_source_job_id_not_null.sql` | 2026-10-08 |
| `20261010_searches_status_check.sql` | 2026-10-08 |
| `20261012_job_results_feedback.sql` | 2026-10-10 |

The base tables (`profiles`, `user_api_keys`, `cvs`, `searches`, `job_results`)
predate this folder. RLS policies are in `supabase/policies.sql`.
