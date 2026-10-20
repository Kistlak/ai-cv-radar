# Code Review: LinkedIn and Glassdoor posting dates (output mapping)
**Date**: 2026-10-20
**Status**: Approved with Changes (2026-10-20): "fix all". Both Important items fixed (LinkedIn `startUrls`/`maxRowsPerUrl`/`companyProfile`, Glassdoor `maxItems`); the notes stand. A real run is still open as a manual step.
**Plan**: `.agents/plans/2026-10-20-linkedin-glassdoor-posted-date.md` (scope B, Glassdoor salary as text)

## Summary
The mapping now matches both actors' published output, and every old field name is kept as a fallback. The new tests failed before the fix (4 of 8) and pass after it. The code itself is sound. The real risk is outside it: the actor **inputs** are still out of date. With working output mapping, that matters more than before (see Important).

## Issues Found

### Critical (must fix before merging)
- None.

### Important (should fix)
- [Performance] `lib/job-sources/apify.ts` (`fetchApifyGlassdoor`, `runActor` input `maxResults: 25`): `maxResults` isn't in the Glassdoor actor's input schema; its limit is `maxItems`, **default 200**.
  - If Glassdoor really returned 0 usable jobs until now, this fix lets up to 200 Glassdoor jobs per search through to the scoring pool (the pool cap still applies).
  - The actor bills per job ($0.40 per 1,000), and a bigger run takes longer within the 150 s actor timeout.
  - Suggested fix (input drift task): send `maxItems: 25`. One line, but it changes what the actor is asked for, so it's outside the approved scope.
- [Bug, pre-existing] LinkedIn input (`urls`, `count`, `scrapeCompany`): none of these are in the LinkedIn actor's current input schema. It takes `startUrls`/`titles`/`locations`, and `rows` (default 0 = "all available").
  - The actor may ignore our search URL and return nothing, or run unbounded. This fix can't help LinkedIn until the input is right.
  - Suggested fix: `startUrls: [searchUrl]`, `rows: 25` (or `maxRowsPerUrl`).
  - Needs a live run to confirm; it's the same input drift task.

### Suggestions (nice to have)
- [Note] Glassdoor `job_posted_date` has no timezone ("2026-08-19T00:00:00"), so it's read as server-local time. "Posted N days ago" can be one day off near midnight. Covered by a test that asserts the local reading.
- [Note] LinkedIn `link ?? applyUrl ?? jobUrl`: kept the existing order (`link` first) rather than the plan's `applyUrl ?? jobUrl ?? link`. `link` isn't in the current output, so external apply links still win. That's the smaller diff.
- [Note] Glassdoor `sourceJobId` now prefers `job_id`. This wasn't listed in the plan, but without it every id would fall back to the apply URL, which carries tracking parameters and makes dedup less stable.
- [Note] Unknown `pay_period` values get no period suffix ("$73"), not a wrong one.
- [Note] Not live-verified: the fix rests on the actors' README sample rows (LinkedIn build 0.0.226, Glassdoor 0.1.66). A real search with both sources is still needed.

## Checks run
- New tests before the fix: 4 failed, 4 passed (LinkedIn date and Easy Apply link; Glassdoor rows all skipped).
- After the fix: `tests/unit/apify-linkedin-glassdoor.test.ts` 8/8.
- `npm run lint`: 0 errors, 1 existing warning (React Hook Form `watch()`), not in this diff.
- `npm run typecheck`: clean.
- `npm test`: 27 files, 308 tests passed.

## Checklist
- [x] No SQL injection risks (no queries touched)
- [x] No mass assignment vulnerabilities (n/a)
- [x] No exposed secrets or hardcoded credentials
- [x] No N+1 query problems (n/a)
- [x] Missing indexes on frequently queried columns checked (n/a, no DB change)
- [x] Error handling covers edge cases (missing/invalid dates give null; missing salary parts handled; expired skipped)
- [x] Validation rules are complete (links still go through `toHttpUrl()` downstream, unchanged)
- [x] Authorization checks are in place (n/a)
- [x] No unhandled promise rejections (n/a)
- [x] No memory leaks in useEffect (n/a)
- [x] Large collections use chunking, not ->all() (n/a)
- [x] Tests cover the main scenarios
- [x] No existing features were removed or broken (old field names covered by tests; full suite passes)
- [x] No unrelated files were modified
