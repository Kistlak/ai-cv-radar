-- Cache for the tailored CV AI feature.
-- tailored_cv: structured CV JSON (name, contact, summary, experience, etc.)
-- tailored to a specific job. Rendered to .docx on download.
ALTER TABLE "job_results" ADD COLUMN IF NOT EXISTS "tailored_cv" jsonb;
