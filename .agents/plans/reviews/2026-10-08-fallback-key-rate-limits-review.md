# Code Review: Fallback-key rate limits & quotas (review item 4)
**Date**: 2026-10-08
**Status**: Approved with Changes (2026-10-08): the upload-ordering item was fixed; everything else was accepted as is.

**Fix applied:** in `app/api/cv/upload/route.ts`, `consumeQuota` now runs **after** text extraction and **before** the storage upload. That is earlier than this review suggested (just before the AI call), so that an over-limit request doesn't leave an orphaned PDF in storage. Unreadable PDFs no longer use quota; only a storage failure still does. Re-verified: 12/12 unit tests, `tsc` clean, lint 0 errors.
**Plan**: `.agents/plans/2026-10-08-fallback-key-rate-limits.md`

## Summary
The implementation is clean and follows the plan: one shared helper, plus a small, consistent check at each of the 7 paid entry points. Users on their own keys only hit the running-search limit. Unit tests (12), `tsc` and lint (0 errors) pass. **The migration has not been applied to the hosted DB yet** (blocked by a tool permission), so DB behavior hasn't been exercised. Until the table exists, every paid route that reaches `consumeQuota` returns 500.

## Issues Found

### Critical (must fix before merging)
- [Deploy] `supabase/migrations/20261008_add_usage_counters.sql`: This must be applied to the hosted DB **before** this code is deployed. Otherwise `consumeQuota` throws ("relation usage_counters does not exist"), and fallback users get 500s on search, upload and generation. It is not a code defect, but it blocks the merge until the migration is applied and the manual DB tests are run.

### Important (should fix)
- [Bug-ish] `app/api/cv/upload/route.ts:28-31`: The upload quota is consumed **before** PDF text extraction and the storage upload, as the plan specified. An unreadable PDF or a storage failure still uses up one of the user's 5 daily uploads, even though no AI call happened.
  **Suggested fix:** move the `consumeQuota` block to just before the AI parse call (around line 52), after extraction and storage succeed. It's a small move, but it changes the order of work inside the handler.
- [Testing] `lib/usage-limits.ts:96-133`: The DB-backed functions `consumeQuota` and `hasTooManyRunningSearches` (the atomic upsert with `setWhere`, and the 10-minute window) have **no automated tests**. They can only be verified by the manual DB checklist in the plan.
  **Suggestion:** a follow-up integration test against a disposable Postgres (e.g. Testcontainers, or a Supabase branch DB).

### Suggestions (nice to have)
- [Improvement] `lib/usage-limits.ts:31`: `APIFY_SOURCES` duplicates the same set in `lib/run-search.ts:15`, so the two can drift apart. Export it from one place. It was kept duplicated to avoid touching `run-search.ts` in this task.
- [Performance] `lib/usage-limits.ts:120-130`: The running-search count filters `searches` by `user_id` and `status`, and there is no index on `searches.user_id` (a pre-existing gap from the full review). That's fine at the current size; add `searches(user_id, created_at)` in the indexes task.
- [Note] There's a small race on the concurrency check: two requests within milliseconds can both pass. This is accepted in the plan, and the daily quota still caps cost.
- [Note] Quota is never refunded when the paid call fails (by design, documented in the code).
- [Note] Vitest was installed with `--legacy-peer-deps` because npm 10.9.3 crashes (`edgesOut`) when resolving Vitest's optional peers. Future `npm install` runs in this repo may hit the same npm bug; upgrading npm to 11 should fix it.
- [Note] CI (`.github/workflows/ci.yml`) doesn't run `npm test` yet. Add it to CI when it's ported to Bitbucket Pipelines (out of scope).
- [Nitpick] `lib/usage-limits.ts:149`: `Retry-After: 30` for the concurrency 429 is an arbitrary hint. That's fine, since searches usually finish in 30–90s.

## Behavior check
| Preserved behavior | Status |
|---|---|
| Auth 401 runs first on every route | Kept: the quota code runs after auth |
| Existing validation and error messages and codes | Unchanged |
| Cached AI results are free | Kept: checks sit after the cache return in all 5 generation routes |
| Search order: validate → CV → key → insert → `after()` | Kept: the concurrency and quota checks are inserted between key and insert |
| Users with their own keys | Only the 1-running-search limit applies (as approved) |
| `getDecryptedKeys` / `resolveProvider` | Read-only use, unchanged |
| Context helpers | `usingFallback` field added; existing destructuring unaffected |

## Checklist
- [x] No SQL injection risks (Drizzle builder; `sql` template values are parameterized)
- [x] No mass assignment vulnerabilities
- [x] No exposed secrets or hardcoded credentials
- [x] No N+1 query problems (one extra query per request at most: concurrency count + upsert)
- [ ] Missing indexes on frequently queried columns checked: `searches.user_id` (pre-existing, see Suggestions)
- [x] Error handling covers edge cases (limit 0 disables; invalid env values fall back to defaults)
- [x] Validation rules are complete
- [x] Authorization checks are in place
- [x] No unhandled promise rejections
- [x] No memory leaks in useEffect (no frontend changes)
- [x] Large collections use chunking (N/A)
- [ ] Tests cover the main scenarios: pure logic yes; DB paths are manual (see Important)
- [x] No existing features were removed or broken (lint/tsc/unit pass; DB manual tests pending)
- [x] No unrelated files were modified (`package.json` and `package-lock.json` change only for Vitest and the `test` script)
