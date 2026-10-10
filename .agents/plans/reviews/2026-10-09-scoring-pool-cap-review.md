# Code Review: Scoring pool cap (pre-rank before AI scoring)
**Date**: 2026-10-09
**Status**: Superseded: folded into PRD-match-quality Task 8. The `.net` boundary fix and CV terms were done there on 2026-10-10 (`2026-10-10-match-quality-t8-prerank-cv-terms.md`).
**Plan**: `.agents/plans/2026-10-09-scoring-pool-cap.md`

## Summary
A small, contained change that follows the plan with no deviations: one new pure module, a 13-line insertion in `runSearch`, and 12 unit tests. "All" searches and small fetches behave as before. One minor matching bug (terms that start with punctuation) and one quality trade-off (agentic jobs can be cut) are worth deciding on. **Lint, typecheck, unit tests and `next build` have not been run yet.** At the owner's request they'll run at the end, together with the next tasks.

## Issues Found

### Critical (must fix before merging)
None.

### Important (should fix)
- **[Bug] `lib/score-pool.ts:42` — terms that start with punctuation never match after a letter.**
  - The look-behind `(?<![\p{L}\p{N}])` is applied to every term, including ones that start with punctuation. So `.net` never matches "ASP.NET" (the `.` follows `p`), although it does match ".NET Developer".
  - Terms such as `c#`, `c++` and `node.js` are fine, because they start and end with the boundary check on their letters.
  - **Suggested fix:** add the look-behind only when the term starts with a letter or digit, and the look-ahead only when it ends with one. Add a test for "ASP.NET Core Developer" against the query `.net`.

### Suggestions (nice to have)
- **[Improvement] `lib/run-search.ts:243` — agentic jobs go through the same keyword pre-rank as the cheap sources.**
  - Claude already chose these jobs for the CV. A good one with a non-keyword title (for example "Software Engineer II") can be cut before scoring.
  - **Option:** always score the agentic jobs and fill the rest of the pool from the cheap sources. This needs the two lists kept apart until scoring, which is a larger change than this task. Left as a follow-up unless you want it now.
- **[Improvement] `lib/score-pool.ts:52` — the pre-rank uses query terms only, not the CV.**
  - When a user types a narrow query, jobs that match the CV's other skills but not the query rank low.
  - Adding the CV's top skills (from `cvs.structured`) as low-weight terms would help. Out of scope for this fix.
- **[Test coverage] `lib/run-search.ts:240-245` — the wiring itself isn't unit-tested.**
  - `runSearch` talks to the DB and has no unit harness. The pure functions are fully covered, and the wiring is 5 lines.
  - **Manual check:** run a search with a count of 10 with real keys and confirm `run_search.scoring_pool` logs `pool: 40`.
- **[Nitpick] `lib/score-pool.ts:15` — the stop-word list includes `lead` and `mid`.**
  - A query like "Tech Lead" then ranks only on "tech". That's acceptable, since seniority words match most postings, but it's tunable if results look off.

## Checklist
- [x] No SQL injection risks (no new queries)
- [x] No mass assignment vulnerabilities (n/a)
- [x] No exposed secrets or hardcoded credentials
- [x] No N+1 query problems (no new DB access)
- [x] Missing indexes on frequently queried columns checked (n/a)
- [x] Error handling covers edge cases (empty terms → input order; pure functions can't throw on valid input; regex input is escaped)
- [x] Validation rules are complete (`maxResults` is already validated 1–50 by the API)
- [x] Authorization checks are in place (unchanged)
- [x] No unhandled promise rejections (no new async)
- [x] No memory leaks in useEffect (n/a)
- [x] Large collections use chunking (n/a; about 250 jobs × about 10 regexes in memory)
- [x] Tests cover the main scenarios (12 unit tests; wiring checked manually, see above)
- [x] No existing features were removed or broken ("All" and small fetches unchanged; `scoreJobs` untouched. Lint, typecheck and tests are still to be run)
- [x] No unrelated files were modified
