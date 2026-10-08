-- A NULL source_job_id defeats the (search_id, source, source_job_id) unique
-- constraint, since Postgres treats NULLs as distinct, so duplicates slip in.
-- run-search now falls back to the apply URL; backfill existing rows the same
-- way (apply_url is NOT NULL), then require it.
UPDATE "job_results"
SET "source_job_id" = "apply_url"
WHERE "source_job_id" IS NULL OR "source_job_id" IN ('', 'undefined');

ALTER TABLE "job_results" ALTER COLUMN "source_job_id" SET NOT NULL;
