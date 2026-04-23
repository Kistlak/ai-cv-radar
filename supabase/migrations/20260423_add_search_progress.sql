-- Live progress payload written during runSearch so the UI can show stage transitions.
ALTER TABLE "searches" ADD COLUMN IF NOT EXISTS "progress" jsonb;
