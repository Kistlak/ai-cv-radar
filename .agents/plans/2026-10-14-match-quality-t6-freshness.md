# Plan: Match quality T6: freshness (drop old postings, ask sources for recent jobs, "Posted N days ago")

**Status**: Completed (code), 2026-10-14. Approved with my recommendations on both questions: LinkedIn kept at 7 days, Glassdoor `fromAge` added. Review approved with no changes. Deviations: `postedAgoLabel` defaults `now` to `Date.now()` (the `react-hooks/purity` lint rule rejects `Date.now()` in render), and JSearch got its own test block. Lint, `tsc`, `npm test` (290/290) and `next build` pass. Pending: one real Glassdoor run to confirm `fromAge` (review, Important).
**Date**: 2026-10-14
**Branch**: `feature/match-quality-t6-freshness` (new, from `origin/master` at `131038c`, after T7's PR #31)
**PRD**: `.agents/prd/PRD-match-quality.md` (Task 6, requirement F6, goal G4, design §6.6)

## Task Summary
No source is asked for recent jobs, except LinkedIn (hardcoded to 7 days), and nothing drops a job by its posting date. Users get expired jobs and dead links.

After this task:
- **Sources ask for recent jobs** where the API supports it:
  - Adzuna: `max_days_old`;
  - JSearch: `date_posted`;
  - Glassdoor: the `fromAge` URL param (see question 2).
- **Old jobs are dropped after fetching.** `rankJobs` drops jobs whose `postedAt` is older than `JOB_MAX_AGE_DAYS` (default 30) before the pre-rank and scoring. It keeps undated jobs.
- **Cards show "Posted N days ago"** instead of a bare date. The full date stays in the tooltip.

Because old jobs are dropped before the scoring pool, the pool's slots go to fresh jobs and fewer AI calls are spent on dead postings.

## Affected Files
- **`lib/freshness.ts`** (new). It holds pure functions only:
  - `jobMaxAgeDays(env = process.env)` reads `JOB_MAX_AGE_DAYS`:
    - it must be an integer ≥ 0, otherwise the default of 30 applies;
    - `0` disables the filter;
    - it follows the same pattern as `readLimit` in `lib/usage-limits.ts`.
  - `isFresh(job, now, maxDays)` returns true when:
    - `postedAt` is null, or an invalid Date; or
    - `maxDays` is 0; or
    - the age is at most `maxDays` days.

    Future dates count as fresh.
  - `postedAgoLabel(postedAt, now)` returns:
    - "Posted today" when the age is under 1 day, or the date is in the future;
    - "Posted 1 day ago";
    - "Posted N days ago" otherwise.
  - `jsearchDatePosted(maxDays)` maps to the smallest JSearch bucket that covers `maxDays`:
    - ≤1 → `today`;
    - ≤3 → `3days`;
    - ≤7 → `week`;
    - ≤30 → `month`;
    - otherwise, or 0, nothing is sent.
  - `glassdoorFromAge(maxDays)` maps to the smallest of 1, 3, 7, 14 or 30 that is ≥ `maxDays`. When `maxDays` is above 30, or 0, nothing is sent.
- **`lib/match-pipeline.ts`:**
  - `RankContext` gets optional `now?: number` and `maxAgeDays?: number`. Their defaults are `Date.now()` and `jobMaxAgeDays()`, and tests set them.
  - `rankJobs` filters with `isFresh` first, then runs the pre-rank, pool, scoring and `selectTop` on the fresh jobs.
  - `onPool(fetched, pool, stale)` gets a third argument, `stale`, which is the number dropped. Existing two-argument callers still compile.
- **`lib/run-search.ts`:** the `run_search.scoring_pool` log adds `stale`. That's a one-line change in the existing `onPool` callback.
- **`lib/job-sources/adzuna.ts`:** sets `max_days_old` when `jobMaxAgeDays()` is greater than 0.
- **`lib/job-sources/jsearch.ts`:** sets `date_posted` from `jsearchDatePosted()` when it returns a value.
- **`lib/job-sources/apify.ts`:** `buildGlassdoorSearchUrl` sets `fromAge` from `glassdoorFromAge()` when it returns a value. This depends on question 2.
- **`app/(app)/search/[id]/page.tsx`:** the card's date span shows `postedAgoLabel(new Date(job.postedAt), Date.now())`, with `title={toLocaleDateString()}`.
- **`.env.local.example`:** a commented `# JOB_MAX_AGE_DAYS=30`, with a one-line explanation under its own heading.
- **Tests:**
  - `tests/unit/freshness.test.ts` (new): covers every function above.
  - `tests/unit/match-pipeline.test.ts`:
    - stale jobs are dropped before the pool;
    - undated jobs are kept;
    - `maxAgeDays: 0` keeps everything;
    - `onPool` gets the stale count.
  - `tests/unit/job-sources-country.test.ts`: the Adzuna URL has `max_days_old`, and the JSearch URL has `date_posted`. These use the existing `fetch` stubs.
- **Docs:** this plan, its review, and the PRD's Task 6 row.

There's no DB migration: `job_results.posted_at` already exists.

## Current Behavior to Preserve
**`rankJobs`:**
- the pre-rank and pool size (`max(4N, 30)` when N is set; "All" scores everything);
- `onPool` is called once, before any scoring call;
- the CV profile and candidate context;
- `scored` holds every job sent to scoring;
- `selectTop`, with unscored jobs last (T7).

  The `fetched` argument of `onPool` stays the input count, before freshness.

**Sources:**
- every existing query param and actor input is unchanged: query, location, remote, country, page and result counts;
- LinkedIn's `f_TPR=r604800` (7 days) is kept as it is (question 1);
- the Indeed actor input is unchanged, because the actor has no age input.

**Undated jobs:**
- Remotive, Indeed and agentic jobs with no or unparseable dates are kept;
- jobs whose date is the Invalid Date are treated as undated. Adzuna, JSearch and Remotive don't validate the date they parse.

**Run-search:**
- the zero-jobs early exit;
- cancel and deadline handling;
- progress (`totalJobs` is still the pool size);
- `postedAt` is stored as it is.

**Results card:**
- when `postedAt` is null, no date is shown;
- the source label, the feedback thumbs, and the layout.

**Eval:**
- `tests/eval/matching.eval.ts` calls `rankJobs` with no new fields, so it gets the default of 30 days, the same as users. No change is needed.
- The fixtures already use relative `postedDaysAgo`:
  - all 32 `stale` jobs are 45–88 days old;
  - every other job is 20 days old or younger.

  So the filter should remove exactly the stale set, and the eval's `stale` column should go to 0.

## Out of Scope
- **Parsing Indeed's relative dates** ("Today", "3 days ago") into Dates. Today they become null, so they're kept. This would be a separate small task.
- **The agentic search prompt.** It asks for "recent" postings without a window. `isFresh` still filters its results, because they go through `rankJobs`.
- **Changing LinkedIn's 7-day window** (question 1).
- **The Apify actor input drift.** The current published schemas use different field names from our inputs:
  - LinkedIn: `startUrls`/`rows`, but we send `urls`/`count`;
  - Indeed: `maxItemsPerSearch`, but we send `maxItems`;
  - Glassdoor: `maxItems`, but we send `maxResults`.

  This might mean our result caps are ignored. It isn't part of this task, so I'm noting it for a follow-up check.
- **Backfilling or hiding old stored rows.** Past searches stay as they were.
- **Validating `new Date()` at the sources.** `isFresh` handles invalid dates, so the sources don't need to change.

## Approach
1. Write `lib/freshness.ts` and its unit tests.
2. Add the `isFresh` filter in `rankJobs`, the new `RankContext` fields, and the `onPool` stale argument. Update `match-pipeline.test.ts`.
3. Add the `stale` count to the `run_search.scoring_pool` log in `run-search.ts`.
4. Add the source params: Adzuna `max_days_old`, JSearch `date_posted`, and Glassdoor `fromAge`. Add URL assertions to the existing source tests.
5. Card: show "Posted N days ago", with the date as the tooltip.
6. Add `JOB_MAX_AGE_DAYS` to `.env.local.example`.
7. Run lint, typecheck, `npm test` and `next build`, after asking you first.
8. Optional, if you want it: run the eval on a few cases to confirm `stale` in the top N drops to 0. It uses Gemini quota.

**Deviation from PRD §6.6:** the PRD says JSearch should get `month` when the window is at least 30 days, and `week` otherwise. I map to the **smallest bucket that still covers the window** instead:
- with 45 days, sending `month` would drop the 31–45-day jobs we'd keep, so nothing is sent;
- with 3 days, `3days` is tighter than `week`.

The post-filter makes the result correct either way. The mapping only decides how many results the source spends on old jobs.

## Database Changes
None.

## API Endpoints
None. The outbound source requests gain query params:
- Adzuna `max_days_old=30`;
- JSearch `date_posted=month`;
- Glassdoor `fromAge=30`.

## Edge Cases & Risks
- **Every job is stale:** the pool is empty and `scoreJobs([])` returns `[]`, so the search completes with 0 results. The log shows `stale = fetched`.
- **Jobs posted later today, or a timezone skew:** a future `postedAt` counts as fresh and shows "Posted today".
- **Invalid `JOB_MAX_AGE_DAYS`** (for example `abc`, `-5` or `2.5`): the default of 30 applies, the same as `usage-limits`.
- **Glassdoor ignores or mishandles `fromAge`:**
  - the actor's docs say URL filters are read, but don't name `fromAge`;
  - the post-filter still drops old jobs, so the worst case is fewer fresh Glassdoor jobs;
  - see question 2.
- **The filter removes good jobs:** undated jobs are kept, the window is configurable, and `0` turns it off.
- **Smaller pools:** with fewer jobs, a result count of N may show fewer than N jobs when a source returns mostly old postings. That's the intended trade-off (G4).

## Testing Strategy
- **`isFresh`:**
  - a null date is kept, and so is the Invalid Date;
  - exactly `maxDays` old is kept;
  - `maxDays` plus 1 ms is dropped;
  - a future date is kept;
  - `maxDays = 0` keeps everything.
- **`jobMaxAgeDays`:**
  - unset or empty gives 30;
  - `'14'` gives 14;
  - `'0'` gives 0;
  - `'-1'`, `'2.5'` and `'x'` give 30.
- **`postedAgoLabel`:** 0 h, 23 h, 1 day, 5 days, and a future date.
- **`jsearchDatePosted` / `glassdoorFromAge`:** every bucket edge (1, 2, 3, 7, 8, 14, 30, 31 and 0).
- **`rankJobs`:**
  - stale jobs never reach the AI client (the mock records which jobs it was sent);
  - `onPool` gets `(fetched, pool, stale)`;
  - the pool size is computed from the fresh count.
- **Sources:** the Adzuna and JSearch URLs carry the new params, and omit them when the window is 0 (`vi.stubEnv`).
- **Manual:** run a real search and check:
  - the cards say "Posted N days ago";
  - the log line has `stale`;
  - no result is older than 30 days.

## Questions for you
1. **LinkedIn window:** LinkedIn is hardcoded to the last 7 days today. Should I leave it as it is (recommended, smaller diff), or widen it to 30 days to match `JOB_MAX_AGE_DAYS`?
2. **Glassdoor `fromAge`:** the actor's docs confirm that URL filters are read, but don't name `fromAge`. Should I add it anyway (recommended; the post-filter is the safety net), or skip Glassdoor and rely only on the post-filter?
