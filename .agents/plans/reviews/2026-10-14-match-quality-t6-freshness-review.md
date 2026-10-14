# Code Review: Match quality T6: freshness
**Date**: 2026-10-14
**Status**: Approved (2026-10-14), no changes requested. The Glassdoor `fromAge` check with a real Apify run is still open as a manual step; the suggestions and notes are left for follow-up tasks.
**Plan**: `.agents/plans/2026-10-14-match-quality-t6-freshness.md`
**Branch**: `feature/match-quality-t6-freshness`

## Summary
The change is small and follows the plan:
- `isFresh` runs first in `rankJobs`;
- Adzuna, JSearch and Glassdoor get date params;
- the card shows "Posted N days ago".

These checks pass:
- lint: 0 errors, plus 1 warning in `components/search-form.tsx` that was already there and isn't touched here;
- `tsc`;
- `npm test`: 290 of 290;
- `next build`.

Nothing blocks a merge. The main open point is that Glassdoor's `fromAge` hasn't been checked against a real actor run.

**Deviations from the plan:**
- `postedAgoLabel` takes `now` with a default of `Date.now()`:
  - the card calls it with no `now`, because the `react-hooks/purity` lint rule rejects `Date.now()` written directly in render;
  - the page is a server component that renders once per request, so the request time is the right "now";
  - the tests pass an explicit `now`.
- JSearch has a new `describe` block in `tests/unit/job-sources-country.test.ts`; the file had no JSearch tests before. The `afterEach` there now also calls `vi.unstubAllEnvs()`.
- The existing `onPool` assertions in `match-pipeline.test.ts` gained the third argument: `(45, 40, 0)` and `(2, 2, 0)`.
- `next build` rewrote `next-env.d.ts` again. It was restored and isn't part of the diff.

## Issues Found

### Critical (must fix before merging)
None.

### Important (should fix)
- [Bug risk] `lib/job-sources/apify.ts:222` (`buildGlassdoorSearchUrl`), the `fromAge` param:
  - the actor's docs say filters in a search URL are applied, but they don't name `fromAge`, and it hasn't been tested on a real run;
  - if the actor or Glassdoor reads the value differently, Glassdoor could return fewer or no jobs. Old jobs would still be dropped by `isFresh`, so the risk is losing Glassdoor jobs, not getting stale ones.
  - **Fix or check:** run one Glassdoor search with an Apify key before merging, and compare the job count with and without `fromAge`. If it drops to 0, remove the two lines.
  - The actor also has a native `postedWithinDays` input, but its exact values aren't documented. That's why the URL param was chosen.

### Suggestions (nice to have)
- [Test coverage] `lib/job-sources/apify.ts`: `buildGlassdoorSearchUrl` is private, so only `glassdoorFromAge` is unit-tested, not the URL it builds.
  - Exporting the builder and asserting `fromAge=30` would cover it.
  - It's left out to keep the diff small.
- [Improvement] `tests/eval/matching.eval.ts`:
  - the eval's `onPool` ignores the new `stale` argument;
  - printing the stale count dropped per case would show the filter working: 4 per case with the current fixtures;
  - the `stale` column in the top N is already expected to go to 0.
- [Note] **Indeed jobs are never filtered.**
  - The actor returns relative text ("Today", "3 days ago"), which `parseDate` turns into null, so every Indeed job counts as undated and is kept.
  - Parsing that text belongs in a separate small task (it's listed in the plan as out of scope).
- [Note] **Agentic results rely on the model's `postedAt`.** A wrong date from the model could drop a good job, or keep an old one. This is the same trust level as before, and `untrusted()` handling is unchanged.
- [Note] **Apify input drift:** our actor inputs use field names that differ from the current published schemas:
  - LinkedIn: we send `urls`/`count`, the schema has `startUrls`/`rows`;
  - Indeed: we send `maxItems`, the schema has `maxItemsPerSearch`;
  - Glassdoor: we send `maxResults`, the schema has `maxItems`.

  This wasn't touched here and is worth a separate check.
- [Note] **Every job stale:** the pool is empty and the search completes with 0 results, and the log shows `stale` equal to `fetched`. That's the intended outcome. The UI's empty state is the same as for no results.
- [Nitpick] `jobMaxAgeDays()` reads `process.env` on each call: once per source request and once per `rankJobs`. That's negligible, and it keeps `vi.stubEnv` working in tests.

## Checklist
- [x] No SQL injection risks: no queries changed
- [x] No mass assignment vulnerabilities: no new write paths
- [x] No exposed secrets or hardcoded credentials
- [x] No N+1 query problems: no queries changed
- [x] Missing indexes on frequently queried columns checked: not applicable
- [x] Error handling covers edge cases:
  - null date, invalid Date, future date and exactly `maxDays` old are all handled;
  - an invalid env value falls back to the default, and `0` turns the filter off.
- [x] Validation rules are complete: `JOB_MAX_AGE_DAYS` is validated the same way as the usage limits
- [x] Authorization checks are in place: unchanged; the page query is still filtered by user
- [x] No unhandled promise rejections
- [x] No memory leaks in useEffect: none touched (server component)
- [x] Large collections use chunking, not ->all(): not applicable
- [x] Tests cover the main scenarios:
  - `freshness.test.ts`;
  - `rankJobs` drop, pool sizing and window 0;
  - Adzuna and JSearch URLs.
- [x] No existing features were removed or broken: every source param, pre-rank, `selectTop` and progress behaves as before; LinkedIn's 7 days are unchanged
- [x] No unrelated files were modified (`next-env.d.ts` was restored)
