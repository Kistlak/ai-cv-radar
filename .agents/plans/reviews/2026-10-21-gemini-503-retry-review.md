# Code Review: Retry Gemini calls when the model is overloaded (503)
**Date**: 2026-10-21
**Status**: Approved with Changes (2026-10-21): "fix all". All three suggestions fixed, and the constant renamed to `MAX_RETRIES`. The other notes need no code change (derive-query fallback is a separate follow-up).
**Plan**: `.agents/plans/2026-10-21-gemini-503-retry.md` (503 only; busy message for Anthropic 529 too)

## Summary
A small, contained change that follows the plan. A Gemini 503 now gets two backed-off retries (2 s, 4 s, plus jitter) within the existing retry cap, deadline and cancel handling. A failed search shows a readable "busy" message instead of the JSON body. The new tests failed before the fix (6 of 49 in the three files) and pass after it. No critical or important issues.

## Issues Found

### Critical (must fix before merging)
- None.

### Important (should fix)
- None.

### Suggestions (nice to have)
- [Improvement] `lib/ai/gemini.ts` (`OVERLOAD_BACKOFF_MS[attempt]`): the array has one entry per retry, so it's tied to `MAX_RATE_LIMIT_RETRIES = 2`.
  - If someone raises the cap to 3, `OVERLOAD_BACKOFF_MS[2]` is `undefined`, `waitMs` is `NaN` and the retry fires with no wait.
  - Fix: use `OVERLOAD_BACKOFF_MS[Math.min(attempt, OVERLOAD_BACKOFF_MS.length - 1)]`, or a comment tying the two together.
- [Nitpick] `lib/ai/gemini.ts`: the overload branch has two identical "give up" log-and-throw blocks (cap reached, wait wouldn't fit the deadline). They could merge into one condition, at the cost of computing the wait first.
- [Improvement] `lib/search-errors.ts`: `searchErrorMessage` applies `isOverloaded` to every error, and its fallback matches the text `"UNAVAILABLE"` (with quotes) anywhere in a message.
  - A non-AI error whose message happened to contain that JSON value would be shown as "The AI provider is busy". That's unlikely: our other errors are plain sentences.
  - Fix: restrict the check to `ApiError` / Anthropic `APIError` instances.
- [Note] `MAX_RATE_LIMIT_RETRIES` now covers overloads too. It keeps its name to keep the diff small, as the plan said; the comment above it explains. Renaming it to `MAX_RETRIES` would be a one-line follow-up.
- [Note] If Gemini stays overloaded past the retries, a blank-query search still fails, at `deriveQueriesFromCv`, now with the busy message. Carrying on with a fallback query is the separate follow-up listed in the plan.
- [Note] Each Gemini call can take up to about 8 s longer (2 + 4 s back-off, plus jitter) before failing during an outage. That's inside the 30 s derive-query and 45 s scoring-batch timeouts.

## Checks run
- New tests before the fix: 6 failed, 43 passed (`gemini-client`, `gemini-retry`, `job-sources-country`).
  - The 503 was thrown after 1 call.
  - `isOverloaded` didn't exist.
  - The search message was the raw JSON.
- After the fix: those three files pass, 49/49.
- `npm run lint`: 0 errors, 1 existing warning (React Hook Form `watch()`), not in this diff.
- `npm run typecheck`: clean.
- `npm test`: 28 files, 335 tests passed.

## Checklist
- [x] No SQL injection risks (no queries touched)
- [x] No mass assignment vulnerabilities (n/a)
- [x] No exposed secrets or hardcoded credentials
- [x] No N+1 query problems (n/a)
- [x] Missing indexes on frequently queried columns checked (n/a, no DB change)
- [x] Error handling covers edge cases (cap, deadline, cancel during the wait, mixed 429 then 503, 500 not retried)
- [x] Validation rules are complete (n/a)
- [x] Authorization checks are in place (n/a)
- [x] No unhandled promise rejections (the abortable `sleep` rejects into the caller's catch, as before)
- [x] No memory leaks in useEffect (n/a)
- [x] Large collections use chunking, not ->all() (n/a)
- [x] Tests cover the main scenarios
- [x] No existing features were removed or broken (429 tests unchanged and passing; full suite passes)
- [x] No unrelated files were modified
