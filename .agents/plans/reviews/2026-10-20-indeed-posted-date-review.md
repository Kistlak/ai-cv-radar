# Code Review: Fix Indeed posting dates (always empty)
**Date**: 2026-10-20
**Status**: Approved (2026-10-20), no changes requested. The suggestion and notes are left for follow-up tasks; the real Indeed run is still open as a manual step.
**Plan**: `.agents/plans/2026-10-15-indeed-posted-date.md`

## Summary
A small, correct fix. Indeed jobs now take their date from the actor's ISO `postingDateParsed`, and fall back to `postedAt` as before. The reproduction test failed before the fix and passes after it. No critical issues.

## Issues Found

### Critical (must fix before merging)
- None.

### Important (should fix)
- None in the code.

### Suggestions (nice to have)
- [Improvement] `lib/job-sources/apify.ts:189`: if the actor drops or renames `postingDateParsed` in a later build, every Indeed date goes back to null without any warning, which is this same bug again. A count of dateless Indeed items in the existing `job_source.apify_items` log line would make that visible. Not done, to keep the diff minimal.
- [Note] Behaviour change: Indeed jobs older than `JOB_MAX_AGE_DAYS` (30) are now dropped by the T6 freshness filter. This is intended, but a search that leans on Indeed can return fewer, fresher results than before.
- [Note] The unit test uses a fake `apify-client`, so it proves the mapping, not that the live actor sends `postingDateParsed`. That rests on the actor's dataset schema (build 0.0.117). A real Indeed search to confirm "Posted N days ago" shows on Indeed cards is still the manual step from the plan.
- [Note] Indeed rows already stored keep `posted_at = NULL` (no backfill; out of scope per the plan).

## Checks run
- `npx vitest run tests/unit/apify-indeed.test.ts` before the fix: 1 failed, 2 passed (expected `2026-10-12T09:00:00.000Z`, received `undefined`).
- After the fix: `npm run lint` passes with 0 errors and 1 warning; the warning is the existing `react-hooks/incompatible-library` one on React Hook Form's `watch()`, not in this diff. `npm run typecheck` is clean. `npm test`: 26 files, 300 tests passed.

## Checklist
- [x] No SQL injection risks (no queries touched)
- [x] No mass assignment vulnerabilities (n/a)
- [x] No exposed secrets or hardcoded credentials
- [x] No N+1 query problems (n/a)
- [x] Missing indexes on frequently queried columns checked (n/a, no DB change)
- [x] Error handling covers edge cases (missing and invalid ISO value both give null, tested)
- [x] Validation rules are complete (`parseDate` rejects invalid dates)
- [x] Authorization checks are in place (n/a)
- [x] No unhandled promise rejections (n/a)
- [x] No memory leaks in useEffect (n/a)
- [x] Large collections use chunking, not ->all() (n/a)
- [x] Tests cover the main scenarios
- [x] No existing features were removed or broken (LinkedIn and Glassdoor mapping untouched; full suite passes)
- [x] No unrelated files were modified
