-- searches.status is free text; the app only ever writes these four values
-- (SEARCH_STATUSES in db/schema.ts). Fails, and rolls back, if any existing row
-- holds something else. Safe to re-run.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'searches_status_check' AND conrelid = 'public.searches'::regclass
  ) THEN
    ALTER TABLE "searches"
      ADD CONSTRAINT "searches_status_check"
      CHECK ("status" IN ('running', 'complete', 'failed', 'cancelled'));
  END IF;
END $$;
