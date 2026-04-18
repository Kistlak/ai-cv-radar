-- Adds the per-search job-count limit. Null = no cap (agent uses its own ceiling).
ALTER TABLE "searches" ADD COLUMN IF NOT EXISTS "max_results" integer;
