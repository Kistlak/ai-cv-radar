-- Cache fields for the general ATS-friendly CV and general cover letter,
-- generated from the uploaded CV. Used as reusable templates for similar jobs.
ALTER TABLE "cvs" ADD COLUMN IF NOT EXISTS "general_cv" jsonb;
ALTER TABLE "cvs" ADD COLUMN IF NOT EXISTS "general_cover_letter" text;
