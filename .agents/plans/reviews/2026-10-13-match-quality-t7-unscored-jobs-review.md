# Code Review: Match quality T7: unscored jobs stored as "Not scored"
**Date**: 2026-10-13
**Status**: Approved with Changes ("fix all", 2026-10-13). Fixed: the screen-reader text on the badge, the `unscored` count in the log, and the `selectTop` type guard. The notes needed no action. Lint, `tsc`, `npm test` (272/272) and `next build` were re-run after the fixes and pass.
**Plan**: `.agents/plans/2026-10-13-match-quality-t7-unscored-jobs.md`
**Branch**: `feature/match-quality-t7-unscored`

## Summary
The change is small and follows the plan: a null score replaces the fake 30 from end to end, and `selectTop` keeps unscored jobs out of the top N. Lint (0 errors; 1 old warning in `components/search-form.tsx`, not touched here), `tsc`, `npm test` (272/272) and `next build` all pass. Nothing blocks a merge. A few small follow-ups are listed below.

## Issues Found

### Critical (must fix before merging)
None.

### Important (should fix)
- [Error Handling] `app/(app)/search/[id]/page.tsx` (JobCard badge): `aria-label` on a plain `<div>` with no role is ignored by most screen readers, so they read "–" ("en dash") instead of "Not scored". The `title` tooltip doesn't show on touch devices either.
  - **Fix:** add `role="img"` to the badge when it's unscored, or render `<span className="sr-only">Not scored</span>` next to the "–".
  - The reason line under the card already says "Not scored", so sighted touch users still get the message.

### Suggestions (nice to have)
- [Improvement] `lib/run-search.ts` (`run_search.scoring_completed` log): add an `unscored` count. Unscored jobs are now explicit, so this makes failing providers easy to spot in Axiom. It's left out because it's not in the PRD for T7.
- [Note] **Old rows** saved before this change still show 30 / "Score unavailable", as decided (no backfill).
- [Note] **Eval comparability:** the `unscored` metric now counts null scores only. Previously, a real score with an empty reason was also counted. Numbers from before T7 can be slightly higher, so call this out when comparing against the T1 baseline.
- [Note] **T2 analysis SQL:** `width_bucket(jr.match_score, 0, 100, 5)` returns NULL for unscored rows, so they form their own `NULL` band. That's correct, but worth knowing when reading the analysis.
- [Nitpick] `lib/match-pipeline.ts` `selectTop`:
  - `(b.matchScore ?? 0) - (a.matchScore ?? 0)` is only there for the types, because the array was already filtered to non-null scores. A type guard on the filter (`(j): j is ScoredJob & { matchScore: number }`) would remove the `?? 0`.
  - `maxResults ? … : …` treats `0` as "All". That's the same as before and `0` isn't a valid user value, so no change is needed.
- [Performance] `desc nulls last` can't use `job_results_search_score_idx` for ordering. A search has at most a few hundred rows, so the in-memory sort costs nothing measurable. No index change.

## Checklist
- [x] No SQL injection risks: the `sql` template only interpolates a column reference
- [x] No mass assignment vulnerabilities: no new write paths
- [x] No exposed secrets or hardcoded credentials
- [x] No N+1 query problems: same single query per page
- [x] Missing indexes on frequently queried columns checked: see the Performance note; not needed
- [x] Error handling covers edge cases: failed or skipped batch, deadline, cancel, skipped index, score 0
- [x] Validation rules are complete: zod score validation unchanged
- [x] Authorization checks are in place: page query still filtered by `searches.userId`
- [x] No unhandled promise rejections
- [x] No memory leaks in useEffect: none touched
- [x] Large collections use chunking: not applicable
- [x] Tests cover the main scenarios
- [x] No existing features were removed or broken. The one intended change: "All" results come back sorted; the page sorted them anyway
- [x] No unrelated files were modified
