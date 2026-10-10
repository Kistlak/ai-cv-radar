# Code Review: Match quality T8: CV-aware pre-rank and the `.net` boundary fix
**Date**: 2026-10-10
**Status**: Approved (2026-10-10, as is). Suggestions not applied; AI eval pending.
**Plan**: `.agents/plans/2026-10-10-match-quality-t8-prerank-cv-terms.md`

## Summary
A small change that follows the plan with no deviations.
- **Code:** one pure module changed (`lib/score-pool.ts`), plus a one-field pass-through in `rankJobs`, `runSearch` and the eval runner.
- **Tests:** 9 new unit tests.
- **Checks:** lint (no new warnings), `tsc`, `npm test` (235/235) and `next build` all pass.
- **Offline recall:** the real implementation gives the same numbers as the prototype in the plan: 80/80 good jobs kept at the eval's pool of 40, and 75/80 good with 47 bad at a pool of 30 (it was 60/80 good with 66 bad).

No critical issues. The AI eval is still to run.

## Issues Found

### Critical (must fix before merging)
None.

### Important (should fix)
None.

### Suggestions (nice to have)
- **[Improvement] `lib/score-pool.ts:35` — language and level words from the skills list become terms.**
  - For example, "English (C1)" and "Portuguese (native)" give `english`, `c1`, `native`; "Accessibility (WCAG 2.1 AA)" gives `2.1` and `aa`.
  - They add at most 1 point in a description, or 2 in a title, and the offline numbers show fewer bad jobs in the pool, not more.
  - **Option:** add a few stop words (`native`, `fluent`, `basic`, `c1`, `c2`, `b2`) if real searches look noisy. Left as is, because the eval doesn't show a problem and the list is easy to tune.
- **[Edge case] `lib/score-pool.ts:63` — a term made only of punctuation now matches anywhere.**
  - Because the boundary is only checked on a letter or digit side, a term like `&&` or `--` would match anywhere. The old code needed a non-letter on both sides.
  - Such terms are very unlikely in a query or CV (the tokenizer splits on spaces, commas, slashes and brackets).
  - **Fix if wanted:** skip terms with no letter or digit in `extractTerms` (one condition).
- **[Behavior] `lib/score-pool.ts:82` — a query made only of stop words now ranks by the CV.**
  - Before, a query such as "Senior remote developer" returned the input order. Now the CV terms rank the jobs when a profile is present.
  - This is intended, and better than the input order. When there's no CV profile it's unchanged.
- **[Test coverage] `lib/run-search.ts:243` — the `safeParse` fallback for a malformed `structured` isn't unit-tested.**
  - `runSearch` has no unit harness (as noted in the scoring-pool review).
  - The behaviour it falls back to (`cvProfile: null` gives a query-only order) is covered in `score-pool.test.ts`.
- **[Eval] The AI eval (`EVAL_LABEL=t8`) hasn't run yet.**
  - It needs the baseline finished first, then about 32 Gemini requests (2 days on the free tier).
  - The fixtures cut only 8 of 48 jobs at N=10, so expect a small AI-eval change. Real searches with about 250 jobs are where this matters.

## Eval (offline pre-rank recall, no AI)
| | Pool 40 of 48 (eval N=10) | Pool 30 |
|---|---|---|
| Before (query terms only) | 74/80 good, 92 bad | 60/80 good, 66 bad |
| After (this change) | 80/80 good, 89 bad | 75/80 good, 47 bad |

- **Recovered at pool 40:** `designer-pt-13`, `designer-pt-32`, `nurse-gb-12`, `nurse-gb-31`, `sales-us-20`, `sales-us-40` (all `synonym-title` traps).
- **Still lost at pool 30:** `nurse-gb-26`, `nurse-gb-31`, `sales-us-40`, `software-lk-27`, `teacher-au-29`.

## Checklist
- [x] No SQL injection risks (no new queries)
- [x] No mass assignment vulnerabilities (n/a)
- [x] No exposed secrets or hardcoded credentials
- [x] No N+1 query problems (`cvs.structured` was already loaded)
- [x] Missing indexes on frequently queried columns checked (n/a)
- [x] Error handling covers edge cases (invalid profile → `null` → query-only; empty CV → same as before; the term cap bounds the work)
- [x] Validation rules are complete (the profile is zod-validated with `CvStructuredSchema` before use)
- [x] Authorization checks are in place (unchanged; the CV is still loaded by `id` + `userId`)
- [x] No unhandled promise rejections (no new async)
- [x] No memory leaks in useEffect (n/a)
- [x] Large collections use chunking (n/a; about 250 jobs × at most about 90 regexes, in memory)
- [x] Tests cover the main scenarios (9 new unit tests: boundary fix, 3,000-character window, CV weights, no double counting, no-CV parity, cap, pipeline pass-through)
- [x] No existing features were removed or broken (all 226 existing tests pass; "All" and small fetches untouched)
- [x] No unrelated files were modified
