# Search Correctness & Reliability (review items 5–7)

**Status**: Completed (code), 2026-10-08. Manual DB checks pending. Review approved: "fix all".

**Branch**: `fix/search-reliability` (based on `fix/extension-privacy-and-usage-limits`, where the previous two tasks were committed first).

**Deviations (all from the review's "fix all"):**
- `failStaleSearches` is best-effort: errors are logged (`stale_searches.reap_failed`) and swallowed, so read paths never fail on it.
- `GET /api/search` (polled every 2s) runs the reaper only when the fetched search is `running` and past the cut-off (new `isStale()` helper), then re-reads it. The dashboard and search page still call it unconditionally (once per page load).
- New optional `timeoutMs` on `AiCompletionOptions` (`lib/ai/types.ts`), implemented as an abort signal in `lib/ai/anthropic.ts` and `lib/ai/gemini.ts` (it covers SDK retries too). Only the search pipeline passes it: scoring 45s per batch, query derivation 30s. The other AI routes are unchanged.
- `scoreJobs` takes an optional `deadline`. `runSearch` passes `t0 + 230s`. Batches not started by then get 30 / "Score unavailable" without a model call, so results are still saved before 300s.
- `SOURCE_TIMEOUT_MS` is now one shared constant in `lib/job-sources/types.ts`.
- **Not changed (reasoned):**
  - Poller lifetime still counts from page mount. Counting from the server `createdAt` would let a fast client clock stop polling before the reaper runs, leaving the page stuck on "running".
  - A reaped run finishing late still overwrites `failed` with `complete`. That's unreachable (6 min > 300s), and results winning is the better outcome.

## Outcome (2026-10-08)
- Unit tests 31/31 (19 new), `tsc` clean, lint 0 errors (1 pre-existing warning in `search-form.tsx`).
- **Still to do:** run the manual DB checks in the Testing Strategy section, then commit and push on your go-ahead.
**Date**: 2026-10-08
**Source**: `.agents/plans/reviews/2026-10-07-full-project-review.md`, Critical items 5, 6 and 7
**PRD**: none. One pipeline (search), one task; no handover expected.

## Task Summary
Three problems make a search wrong or stuck:
1. **Wrong CV.** `POST /api/search` records *any* CV of the user (no ordering, no `isActive`), and `runSearch` then scores against the user's *latest* CV, not the one it recorded. If a CV is uploaded mid-search, the results don't match `search.cvId`.
2. **One bad score kills the whole search.** Scores from the model are cast with `as ScoreResult[]`. A `"85"` or `85.5` reaches the integer insert and throws, so the search fails and every result is lost.
3. **Searches stuck in `running` forever.** Job-source fetches and non-agentic Apify runs have no timeout, and scoring runs batches one at a time. Together these can exceed `maxDuration = 300`. Vercel then kills the function, nothing marks the search `failed`, and the poller polls every 2s forever.

## Affected Files
| File | Change |
|---|---|
| `app/api/search/route.ts` | Pick the user's active, newest CV for `cvId`; call the stale-search reaper in `GET` |
| `lib/run-search.ts` | Load the CV by `search.cvId` (scoped to `userId`) |
| `lib/score-jobs.ts` | Validate model output with zod (coerce, round and clamp scores); run batches in parallel, 3 at a time |
| `lib/job-sources/remotive.ts`, `adzuna.ts`, `jsearch.ts` | `AbortSignal.timeout(...)` on `fetch` |
| `lib/job-sources/apify.ts` | `waitSecs` + `timeout` options on the three `actor.call(...)` calls |
| `lib/stale-searches.ts` (new) | `failStaleSearches(userId)`: marks the user's `running` searches older than the cut-off as `failed` |
| `app/(app)/search/[id]/page.tsx`, `app/(app)/dashboard/page.tsx` | Call `failStaleSearches(user.id)` before reading searches |
| `components/search-poller.tsx` | Stop polling after a maximum lifetime and refresh the page |
| `tests/unit/score-jobs.test.ts`, `tests/unit/stale-searches.test.ts` (new) | Unit tests |
| `lib/ai/types.ts`, `lib/ai/anthropic.ts`, `lib/ai/gemini.ts`, `lib/derive-query.ts`, `lib/job-sources/types.ts` | Added by the review fixes (see Deviations) |

## Current Behavior to Preserve
- **Search route:** 401 without a user; 400 on a bad body; 400 "Upload a CV before searching" with no CV; 400 without an AI key; the concurrency 429 and the fallback quota 429 in that order; 202 with `searchId`; `after()` runs `runSearch`. `GET` keeps 400 without `id` and 404 for another user's search.
- **`runSearch`:** a typed query is used as-is; a blank query derives 3 queries and saves the first; the agentic path runs only with `AGENT_ENABLED` + Apify token + Anthropic key + an Apify source; the agentic 210s budget and abort; cancellation checks before scoring, after scoring and after persisting; zero jobs → `complete`; `maxResults` keeps the top N; `onConflictDoNothing` insert; errors → `failed` with the message unless cancelled; `logger.flush()` always runs; progress updates and log events are unchanged.
- **`scoreJobs`:** returns one scored job per input job, **in input order**; the batch size stays 10; a batch whose call or parse fails gets score 30 and reason "Score unavailable"; a job missing from the model output gets 30 and `''`; the prompt text is unchanged.
- **Job sources:** `safeCall` still turns any failure (now including a timeout) into `[]` for that source; Apify still returns `[]` when a run is not `SUCCEEDED`; field mapping is unchanged.
- **Poller:** polls every 2s, shows progress, stops and refreshes when the status leaves `running`, ignores network errors, and keeps the Cancel button.
- **Pages:** the search page's cancelled/failed/complete views and the dashboard list render as today.
- **Usage limits:** `hasTooManyRunningSearches` and its 10-minute window are untouched.

## Out of Scope
- Every other "latest CV" lookup (`cv` page, `dashboard`, `general-cv-helpers`, `job-ai-helpers`, download routes). They already order by `createdAt desc`, and the upload route deactivates older CVs, so latest == active today. A shared `getActiveCv` helper is a separate cleanup.
- Real cancellation of in-flight work, and `pause_turn` handling in `agentic-search.ts` (Important items).
- Adzuna country and contract→remote, zod for the *other* AI JSON parsers, prompt caching, and moving `runSearch` to a queue.
- Raw `console.log` → `logger` in the job sources.
- The `RUNNING_SEARCH_WINDOW_MS` value in `lib/usage-limits.ts`.

## Approach

### 1. Right CV (item 5)
- `app/api/search/route.ts:48`: select with `and(eq(cvs.userId, user.id), eq(cvs.isActive, true))`, `orderBy(desc(cvs.createdAt))`, `limit(1)`. Keep the same 400 message when nothing matches.
  - Risk: a user whose only CVs predate `is_active` handling would get the 400. The column defaults to `true` and the upload route sets older ones to `false`, so every user keeps exactly one active CV. I'll confirm with a quick DB count before deploying (see Testing).
- `lib/run-search.ts:43-49`: `where(and(eq(cvs.id, search.cvId), eq(cvs.userId, userId)))`. `cv_id` is `NOT NULL` with `ON DELETE CASCADE`, so no fallback is needed. Keep the "No CV found for user" error for the impossible case.

### 2. Validated scores (item 6)
In `lib/score-jobs.ts`:
- Add a zod item schema: `index` coerced to an integer; `score` via `z.coerce.number()`, then `Math.round` and clamp to 0–100; `reason` a string, defaulting to `''`.
- Extract a pure, exported `parseScores(text: string): ScoreResult[]`. It keeps the current regex extraction, `JSON.parse`, then `safeParse`s **each item**. Bad items are dropped, so the job falls back to score 30, instead of the whole batch failing. If the top level isn't an array, it throws, so the existing "Score unavailable" fallback applies.
- `scoreBatch` calls `parseScores` instead of the cast.

### 3. No stranded searches (item 7)
1. **Fetch timeouts:** `fetch(url, { signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS) })` in Remotive, Adzuna and JSearch (keeping JSearch's headers). `SOURCE_TIMEOUT_MS = 20_000`, a constant in each file, matching how the codebase keeps constants local.
2. **Apify (non-agentic path):** pass `{ waitSecs: 150, timeout: 150 }` as the second argument of each `actor.call`. `timeout` makes Apify itself stop the run (so it stops billing). `waitSecs` stops the client waiting. A run that isn't `SUCCEEDED` already returns `[]`.
3. **Parallel scoring:** run batches with a concurrency of 3 using a small in-file helper (no new dependency). Results are written back by batch index, so the output order is unchanged.
4. **Stale-run reaper:** new `lib/stale-searches.ts`:
   - `STALE_SEARCH_MS = 6 * 60 * 1000` (the 300s `maxDuration` plus margin).
   - `failStaleSearches(userId)`: one `UPDATE searches SET status='failed', error='Search timed out. Please try again.', completed_at=now() WHERE user_id=$1 AND status='running' AND created_at < now() - 6 min`. The `status='running'` condition means it can't overwrite a search that just completed or was cancelled.
   - Called from `GET /api/search` (the poller), the search detail page and the dashboard, before they read.
5. **Poller lifetime:** in `components/search-poller.tsx`, record the start time. After `MAX_POLL_MS = 7 * 60 * 1000`, clear the interval and `router.refresh()`. The page then re-renders, the reaper has marked the search `failed`, and the "Search failed" card shows. The interval is still cleared on unmount.

## Database Changes
None. The existing columns (`status`, `error`, `completed_at`, `created_at`) are enough. An index on `searches(user_id, created_at)` is a separate review item.

## API Endpoints
No new routes. `GET /api/search?id=` may now return a search whose status was just changed from `running` to `failed` by the reaper.

## Edge Cases & Risks
- **A long but healthy run marked failed:** the 300s `maxDuration` kills any run past 5 min anyway, so 6 min is safe. If `runSearch` finishes after being reaped, its final `UPDATE … status='complete'` would overwrite `failed`. That's acceptable (the user gets results). I won't add guards to those writes, to keep the diff small.
- **Clock skew:** the reaper compares against `now()` in the database, not the server clock.
- **Concurrent scoring:** 3 parallel requests per search could hit provider rate limits on low-tier keys. A failed batch falls back to 30, as today. I'll make the concurrency a constant, easy to lower.
- **Apify `timeout`:** an actor stopped at 150s may have partial items but status `TIMED-OUT`. We return `[]`, as today for any non-success.
- **Score coercion:** `"85%"` fails `z.coerce.number()` → that job gets 30. Fine.

## Testing Strategy
**Unit (Vitest, `tests/unit/`):**
- `parseScores`:
  - a valid array;
  - string scores (`"85"`) and decimals (`85.5` → 86);
  - out-of-range scores (`150` → 100, `-5` → 0);
  - a missing `reason`;
  - one bad item among good ones (only it is dropped);
  - prose around the JSON;
  - no array present (throws).
- `scoreJobs` with a fake `AiClient`:
  - output order is preserved with 25 jobs (3 batches);
  - a batch that throws gets 30 / "Score unavailable";
  - no more than 3 batches are in flight at once.
- Stale cut-off: export a pure `staleCutoff(now)` and test the 6-minute arithmetic. The DB update itself is tested manually.

**Checks:** `tsc`, lint, and the full `npm test`.

**Manual (dev DB):**
1. Before deploy: `select user_id from cvs group by user_id having bool_or(is_active) = false;` should return no rows.
2. Start a search, upload a new CV mid-run, and confirm results are scored against the original (log `cvId`).
3. Set a running search's `created_at` back 10 minutes, then open the dashboard. It should show `failed` with "Search timed out".
4. Leave a search page open past the poller limit. It should stop polling and show the failed card.

## Open Questions
1. **Branching:** the two finished tasks (extension hardening, rate limits) are still uncommitted on `master`. Should I commit them to their own feature branch first, so this task's diff stays separate?
2. **Numbers:** OK with 20s source timeouts, 150s Apify runs, scoring concurrency 3, a 6-minute stale cut-off and a 7-minute poller limit?
