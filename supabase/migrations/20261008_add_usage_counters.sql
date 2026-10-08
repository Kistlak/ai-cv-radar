-- Per-user daily usage counters for operator-paid FALLBACK_* keys.
-- One row per user + action + UTC day. Incremented atomically by lib/usage-limits.ts.
CREATE TABLE IF NOT EXISTS "usage_counters" (
  "user_id" uuid NOT NULL REFERENCES "profiles"("id") ON DELETE CASCADE,
  "action" text NOT NULL,
  "day" date NOT NULL,
  "count" integer NOT NULL DEFAULT 0,
  CONSTRAINT "usage_counters_user_id_action_day_pk" PRIMARY KEY ("user_id", "action", "day")
);

-- RLS on with no policies: the app connects as postgres (bypasses RLS); this
-- blocks the anon key from reading or editing counters via the REST API.
ALTER TABLE "usage_counters" ENABLE ROW LEVEL SECURITY;
