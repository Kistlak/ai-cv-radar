# Code Review: Search correctness & reliability (review items 5–7)
**Date**: 2026-10-08
**Status**: Approved with Changes (2026-10-08, "fix all"). See Resolution below.
**Plan**: `.agents/plans/2026-10-08-search-reliability.md`
**Branch**: `fix/search-reliability` (based on `fix/extension-privacy-and-usage-limits`)

## Summary
The diff is small (10 files, +101/−20, plus a new helper and two test files) and follows the plan without deviations. Unit tests pass 26/26, `tsc` is clean, and lint shows 0 errors (1 pre-existing warning in `search-form.tsx`). The main open points are that the new reaper isn't fault-tolerant on read paths, and the manual DB checks still need running.

## Issues Found

### Critical (must fix before merging)
- None found.

### Important (should fix)
- [Error Handling] `lib/stale-searches.ts:14`, called from `app/(app)/dashboard/page.tsx`, `app/(app)/search/[id]/page.tsx` and `app/api/search/route.ts` (GET): if the reaper's UPDATE throws (DB hiccup, lock timeout), the dashboard, the search page and every poll now fail, even though they only needed a read. Before this change those reads didn't depend on a write. **Fix:** wrap the call in `failStaleSearches` in `try/catch` and `logger.warn`. Cleanup is best-effort and the next read retries it.
- [Performance] `app/api/search/route.ts` (GET): the reaper runs an UPDATE on **every 2s poll**. It's cheap today (a filter on `user_id`, few rows), but `searches` has no index on `user_id` (already an open review item). **Fix (later):** a partial index `searches(user_id) WHERE status = 'running'` makes it near-free; or only run the reaper in GET when the fetched search is `running` and older than the cut-off.
- [Reliability] `lib/run-search.ts` (unchanged code): in the agentic path, the fetch phase can take up to 210s (the agentic budget), and scoring comes after it. With roughly 250 jobs that's about 9 rounds of 3 parallel batches, which can still approach the 300s `maxDuration`. The reaper now guarantees such a run ends up `failed` instead of stuck, but the user loses the results. **Fix (follow-up):** lower `AGENTIC_TIMEOUT_MS` to about 180s, or put a deadline on scoring and save what's done.

### Suggestions (nice to have)
- [Improvement] `lib/score-jobs.ts`, `lib/derive-query.ts`: the `ai.complete` calls themselves have no timeout, so a hung provider request still holds the run until Vercel kills it (the reaper then cleans up). A per-call `AbortSignal.timeout` in `lib/ai/*` would close the last gap. This is out of scope here because it touches the provider layer.
- [Note] `lib/stale-searches.ts` vs `lib/run-search.ts`: if a reaped run somehow finishes later, its final `status='complete'` overwrites `failed`. This was accepted in the plan (the user gets results). Unreachable in practice, since 6 min > 300s.
- [Nitpick] `SOURCE_TIMEOUT_MS = 20_000` is duplicated in `remotive.ts`, `adzuna.ts` and `jsearch.ts`. This is deliberate (each file stays self-contained, as planned). Move it into `types.ts` or a shared constant if a fourth source is added.
- [Nitpick] `components/search-poller.tsx`: the 7-minute limit counts from page mount, not search creation, so a page opened late polls longer than needed. This is harmless, because the GET poll itself runs the reaper and sees `failed` at 6 minutes.

## Resolution (2026-10-08)
| Item | Outcome |
|---|---|
| Important: reaper not fault-tolerant | **Fixed.** try/catch + `logger.warn` in `failStaleSearches` (unit-tested) |
| Important: UPDATE on every poll | **Fixed.** GET runs the reaper only for a `running` search past the cut-off (`isStale`). The index is still the separate review item |
| Important: agentic + scoring can reach 300s | **Fixed.** Scoring start deadline at `t0 + 230s`; later batches get the fallback score; plus the per-batch timeout below |
| Suggestion: no timeout on `ai.complete` | **Fixed.** Optional `timeoutMs` (abort signal) in both providers; used by scoring (45s) and query derivation (30s) only |
| Note: late `complete` overwrites `failed` | **No change needed.** Unreachable (6 min > 300s); results winning is the better outcome |
| Nitpick: duplicated `SOURCE_TIMEOUT_MS` | **Fixed.** Shared in `lib/job-sources/types.ts` |
| Nitpick: poller counts from mount | **No change.** Using the server `createdAt` adds clock-skew risk (polling could stop before the reaper runs and leave the page stuck); GET already reaps at 6 min |

Re-checked: unit tests 31/31, `tsc` clean, lint 0 errors.

## Manual checks still to run (dev DB)
1. `select user_id from cvs group by user_id having bool_or(is_active) = false;` → no rows. Otherwise those users get "Upload a CV before searching".
2. Upload a new CV while a search runs, and confirm the results were scored against `search.cv_id`.
3. Set a running search's `created_at` back 10 minutes, open the dashboard, and confirm it shows `failed` / "Search timed out. Please try again."
4. Confirm the reaper SQL (`now() - $1::int * interval '1 millisecond'`) runs against Postgres. Check 3 covers this.

## Checklist
- [x] No SQL injection risks (Drizzle builder; the interval value is a bound parameter)
- [x] No mass assignment vulnerabilities
- [x] No exposed secrets or hardcoded credentials
- [x] No N+1 query problems
- [ ] Missing indexes on frequently queried columns checked: `searches.user_id` is still unindexed (pre-existing; see Performance)
- [x] Error handling covers edge cases (the reaper is wrapped; scoring has a deadline and per-call timeouts)
- [x] Validation rules are complete (model scores now validated, coerced and clamped)
- [x] Authorization checks are in place (reaper scoped to `user.id`; CV load scoped to `userId` + `search.cvId`)
- [x] No unhandled promise rejections (Node/Next.js)
- [x] No memory leaks in useEffect (interval cleared on stop, on timeout and on unmount)
- [x] Large collections use chunking: N/A
- [x] Tests cover the main scenarios (14 new unit tests; DB behavior is in the manual checks)
- [x] No existing features were removed or broken (the 12 existing tests pass; behaviors in the plan's "preserve" list are kept)
- [x] No unrelated files were modified
