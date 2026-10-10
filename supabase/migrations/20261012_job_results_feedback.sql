-- Thumbs up/down feedback on job results (match-quality Task 2). Nullable
-- columns with no default, so this is instant and doesn't rewrite rows; code
-- that doesn't know about them keeps working. Safe to re-run.
ALTER TABLE "job_results"
  ADD COLUMN IF NOT EXISTS "feedback" smallint,
  ADD COLUMN IF NOT EXISTS "feedback_reason" text,
  ADD COLUMN IF NOT EXISTS "feedback_at" timestamptz;

-- feedback is 1 (good match) or -1 (not a match). A reason is optional and
-- only allowed with -1; the values match FEEDBACK_REASONS in lib/job-feedback.ts.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'job_results_feedback_check' AND conrelid = 'public.job_results'::regclass
  ) THEN
    ALTER TABLE "job_results"
      ADD CONSTRAINT "job_results_feedback_check"
      CHECK ("feedback" IN (-1, 1));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'job_results_feedback_reason_check' AND conrelid = 'public.job_results'::regclass
  ) THEN
    ALTER TABLE "job_results"
      ADD CONSTRAINT "job_results_feedback_reason_check"
      CHECK (
        "feedback_reason" IS NULL OR (
          "feedback" = -1 AND "feedback_reason" IN
            ('wrong_field', 'wrong_level', 'wrong_location', 'missing_requirement', 'expired', 'other')
        )
      );
  END IF;
END $$;
