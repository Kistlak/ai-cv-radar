# Code Review: Keep a blank-query search going when the AI can't build queries
**Date**: 2026-10-22
**Status**: Approved with Changes (2026-10-22): "fix all". All three suggestions fixed: runSearch end-to-end test, network errors by `cause.code`, a results-page note via `progress.queryFallback` (no migration). Notes stand.
**Plan**: `.agents/plans/2026-10-22-derive-query-ai-fallback.md` (per-minute 429 stays a hard failure)

## Summary
A small, targeted fix. The AI call in `deriveQueriesFromCv` now has a `.catch`:
- On a **temporary** failure, it falls back to the same query used for an unusable answer: the CV's latest role, or "jobs".
- A **user cancel**, or a request, key or quota error, is rethrown as before.

`isTransientAiError` (`lib/search-errors.ts`) classifies the errors with the same classes `searchErrorMessage` already uses. The new tests failed before the fix (8 of 17 in `derive-query.test.ts`) and pass after it. No critical issues.

## Issues Found

### Critical (must fix before merging)
- None.

### Important (should fix)
- None.

### Suggestions (nice to have)
- [Testing] `lib/run-search.ts` has no unit test, so the end-to-end path isn't covered by a test: a blank query, the AI down, the fallback query used, the job sources run, and the jobs end up unscored rather than the search failing. The pieces are tested separately: `deriveQueriesFromCv`'s fallback, and `scoreBatch`'s unscored path from Task 7. A manual check, or a future `run-search` test with mocked sources, would close this.
- [Improvement] `lib/search-errors.ts` (`isTransientAiError`): the network case matches a `TypeError` whose message is exactly "fetch failed" (Node's undici). If the Gemini SDK wraps network errors differently, those would count as non-temporary and still fail the search, which is today's behaviour, so nothing regresses.
  - Option: also accept a `TypeError` with an undici `cause`. Left as is, to avoid guessing at shapes we haven't seen.
- [UX] When the fallback is used, nothing tells the user the AI didn't pick the queries. The search shows the role (or "jobs") as its query, as it does today when the AI's answer is unusable. A small note on the results page ("AI was busy; searched for your latest role") could be a follow-up. It would need a flag on the search row, so a migration.
- [Note] **"jobs" as the query:** a CV with no recognisable role falls back to "jobs", a very broad search. That's the existing Task 3 fallback, now also reached on AI outages.
- [Note] **Timing during an outage:** scoring batches will likely hit the same outage, and each tries 3 times (about 8 s of back-off). The search is slower but still finishes inside its 300 s budget, with jobs unscored ("Not scored").
- [Note] **Timeouts and cancel:** `APIUserAbortError` / `AbortError` count as temporary because the Anthropic SDK reports **our** 30 s timeout that way. A real cancel is told apart by `signal.aborted`, checked first, and that's tested.
- [Note] **Smaller diff:** `.catch` on the existing `ai.complete(...)` call was used instead of the plan's `try`/`catch` block, so the long prompt template isn't re-indented. The behaviour is the same.

## Checks run
- `tests/unit/derive-query.test.ts`: 17/17 after the fix. Before it: 8 failed (every temporary error rejected) and 9 passed (the existing 4, plus the cancel and non-temporary guards).
  - **Falls back** on: Gemini 503 and 500, Anthropic 529, `TimeoutError`, `APIUserAbortError`, `APIConnectionError`, "fetch failed"; and to "jobs" with no role.
  - **Rethrows** on: a user cancel, Gemini 400, Gemini 429, Anthropic 401, a plain `Error`.
- `tests/unit/job-sources-country.test.ts`: 2 new `isTransientAiError` cases. The existing `searchErrorMessage` cases are unchanged and pass.
- `npm run lint`: 0 errors, 1 existing warning (React Hook Form `watch()`).
- `npm run typecheck`: clean.
- `npm test`: 30 files, 375 tests passed.

## Checklist
- [x] No SQL injection risks (no DB changes)
- [x] No mass assignment vulnerabilities (n/a)
- [x] No exposed secrets or hardcoded credentials
- [x] No N+1 query problems (n/a)
- [x] Missing indexes on frequently queried columns checked (n/a)
- [x] Error handling covers edge cases (cancel, timeout, overload, server and network errors, and non-temporary errors)
- [x] Validation rules are complete (n/a)
- [x] Authorization checks are in place (unchanged)
- [x] No unhandled promise rejections (the `.catch` rethrows into the awaited promise, so `runSearch`'s catch still gets it)
- [x] No memory leaks in useEffect (n/a)
- [x] Large collections use chunking, not ->all() (n/a)
- [x] Tests cover the main scenarios (unit level; the end-to-end `runSearch` path is a Suggestion)
- [x] No existing features were removed or broken (the existing derive and error tests are unchanged and pass)
- [x] No unrelated files were modified
