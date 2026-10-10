# Code Review: Retry Gemini calls after a per-minute rate limit (429)
**Date**: 2026-10-11
**Status**: Approved (2026-10-11, as is)
**Plan**: `.agents/plans/2026-10-11-gemini-rate-limit-retry.md`

## Summary
Implemented as planned under the bug protocol:
- a pure parser and an abortable sleep in `lib/ai/gemini-retry.ts`;
- a bounded retry loop in `createGeminiClient().complete`.

**Tests first:** the 2 retry tests failed on the old code (the 429 was thrown at once) and pass now. The "must not retry" tests passed before and after.

**Checks:** typecheck clean · lint 0 errors · `npm test` 226/226 (10 new) · `next build` OK.

**Not yet verified live:** the day-3 eval run will show the effect on real free-tier limits. No critical issues found.

## Issues Found

### Critical (must fix before merging)
None.

### Important (should fix)
None.

### Suggestions (nice to have)
- **[Improvement] `lib/ai/gemini.ts:47` — parallel batches that get a 429 together retry almost together.**
  - Jitter is only 0–1 s, so 3 scoring batches rejected in the same second retry within about a second of each other, and can trip the per-minute limit again. The second retry usually lands after the window resets, so this is bounded.
  - If the eval still shows per-minute failures, the next step is lower Gemini scoring concurrency (out of scope here) or a wider jitter.
- **[Limitation] `lib/score-jobs.ts` `BATCH_TIMEOUT_MS = 45 s`:** a delay longer than the time left fails at once, by design, instead of waiting for nothing. So a 30–60 s per-minute delay late in a batch still becomes a fallback score. That's expected and covered by a test.
- **[Nitpick] `lib/ai/gemini.ts:41` — `let response` is untyped.** TypeScript infers it from the assignment and typecheck passes. An explicit `GenerateContentResponse` type would read more clearly.
- **[Note] Logging:** `gemini.rate_limited` is a `warn` on every retry, and once when giving up (`retrying: false`, with `perDay`). Together with `score_jobs.batch_failed`, the logs now show whether failures are per-minute or per-day.

## Checklist
- [x] No SQL injection risks (no DB code)
- [x] No mass assignment vulnerabilities (n/a)
- [x] No exposed secrets or hardcoded credentials (error bodies are parsed, not logged in full; the key is never logged)
- [x] No N+1 query problems (n/a)
- [x] Missing indexes on frequently queried columns checked (n/a)
- [x] Error handling covers edge cases (per-day, non-429, empty response, timeout too short, cancel during wait; all tested)
- [x] Validation rules are complete (delays clamped to 1–60 s; unknown format defaults to 10 s)
- [x] Authorization checks are in place (n/a)
- [x] No unhandled promise rejections (the abortable sleep rejects through the awaited loop; the listener is removed)
- [x] No memory leaks in useEffect (n/a)
- [x] Large collections use chunking (n/a)
- [x] Tests cover the main scenarios (retry once, twice, give up after 3; no retry for per-day / 400 / empty; timeout; cancel; parser forms)
- [x] No existing features were removed or broken (the model, thinking, JSON mode, abort and empty-response behaviour are unchanged; the 3 existing client tests pass)
- [x] No unrelated files were modified. The uncommitted eval-runner tweaks and T1 review notes in the working tree belong to the match-quality work and **won't be committed in this PR**
