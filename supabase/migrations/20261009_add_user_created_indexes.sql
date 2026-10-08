-- Back the per-user "newest first" lookups: dashboard and recent searches,
-- every latest/active-CV lookup, the stale-search cleanup and the concurrent
-- search check. Both tables are small, so a plain (locking) build is instant.
CREATE INDEX IF NOT EXISTS "searches_user_created_idx" ON "searches" ("user_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "cvs_user_created_idx" ON "cvs" ("user_id", "created_at" DESC);
