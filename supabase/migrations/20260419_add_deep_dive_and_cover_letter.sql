-- Cache fields for per-job AI features.
-- deep_dive: structured fit analysis (JSON: summary, strengths, gaps, emphasis).
-- cover_letter: generated draft letter text. Both nullable; generated on demand.
ALTER TABLE "job_results" ADD COLUMN IF NOT EXISTS "deep_dive" jsonb;
ALTER TABLE "job_results" ADD COLUMN IF NOT EXISTS "cover_letter" text;
