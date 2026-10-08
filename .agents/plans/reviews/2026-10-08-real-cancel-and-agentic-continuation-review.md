# Code Review: Real cancellation & agentic continuation
**Date**: 2026-10-08
**Status**: Approved with Changes (2026-10-08): both Important items fixed; Suggestions left as-is. See Resolution below.
**Plan**: `.agents/plans/2026-10-08-real-cancel-and-agentic-continuation.md`
**Branch**: `fix/search-cancel-and-agentic` (stacked on `fix/search-reliability`)

## Summary
The change follows the plan: 13 files, +249/−86, plus 2 new test files. Unit tests pass 50/50 (19 new), `tsc` is clean, and lint has 0 errors (1 pre-existing warning). One real gap remains: a `finalize_jobs` call cut off by `max_tokens` is still accepted as-is instead of triggering the recovery. The rest are smaller.

## Issues Found

### Critical (must fix before merging)
- None found.

### Important (should fix)
- [Bug] `lib/agentic-search.ts`, the finalize check in the request loop. The loop returns as soon as it sees a `finalize_jobs` block, even when `stop_reason === 'max_tokens'`. The finalize payload is the biggest output the agent writes: up to 30 jobs × descriptions of up to 1000 chars, against `AGENT_MAX_TOKENS = 16000`. If it's cut off mid-call, the input can be partial or empty, and we return few or no jobs without recovering. This gap predates this change, but the new recovery path is the natural fix. **Fix:** treat "finalize present + `max_tokens`" as truncated. Drop the finalize block via `trimUnansweredToolCalls` and use the one-time recovery prompt, which already asks for descriptions under 300 chars. Add a unit test.
- [Error Handling] `lib/job-sources/index.ts:27` (unchanged `safeCall`): on cancel, every in-flight source now logs `console.error('[x] failed: This operation was aborted')`. A user cancel then looks like up to 6 source failures in the logs. **Fix:** in `safeCall`, skip the error log when `params.signal?.aborted` (pass the label and signal, or check `err.name === 'AbortError'`). This is a small edit to an out-of-plan file, so it needs your OK.

### Suggestions (nice to have)
- [Improvement] `lib/job-sources/apify.ts` `runActor`: if the search is already cancelled before `start()`, we still start the actor and then abort it immediately, which costs a few cents. Add an `if (signal?.aborted) throw` before `start`.
- [Improvement] `lib/derive-query.ts` (from the previous branch): when the 30s timeout fires, the search fails with the raw message "This operation was aborted". A friendlier message, e.g. "AI provider timed out, please try again", would help users. That means catching `AbortError` in `runSearch` when it isn't a cancel.
- [Note] `lib/run-search.ts`: the cancel watcher adds one `SELECT status` every 3s per running search. That's negligible with at most 1 running search per user.
- [Note] Agent-launched Apify runs (through the MCP server) are not aborted on cancel. This was accepted in the plan as a known limitation.
- [Memory] `AbortSignal.any` keeps the combined signals referenced from the run-wide cancel signal until it's garbage-collected. Node 22 handles this, and there are only a few dozen per run, so no action is needed.

## Resolution (2026-10-08)
| Item | Outcome |
|---|---|
| Important: truncated `finalize_jobs` accepted | **Fixed.** Finalize + `max_tokens` → trimmed and sent to the recovery request; after recovery a partial list is accepted. 2 new tests |
| Important: cancel logged as source failures | **Fixed.** `safeCall` skips `AbortError`; `TimeoutError` and real errors are still logged. 2 new tests |
| Suggestion: abort check before `start()` | Not applied |
| Suggestion: friendlier timeout message | Not applied |
| Notes (watcher load, agent-launched runs, `AbortSignal.any`) | No change needed |

Re-checked: unit tests 54/54, `tsc` clean, lint 0 errors.

## Manual checks still to run (dev, real keys)
1. Start a search with LinkedIn selected and click Cancel within 10s. Check that:
   - The logs show `run_search.agentic_cancelled` within about 3s.
   - The function ends early.
   - In the Apify console, the non-agentic runs show ABORTED.
2. Cancel during scoring and confirm no further scoring calls appear in the logs.
3. Run a normal search end to end and confirm there's no regression; the logs show the per-request `stopReason`.

## Checklist
- [x] No SQL injection risks (no new queries; `isCancelled` uses the Drizzle builder)
- [x] No mass assignment vulnerabilities
- [x] No exposed secrets or hardcoded credentials
- [x] No N+1 query problems (the watcher makes one indexed-by-PK select per 3s)
- [x] Missing indexes checked: N/A (primary-key lookup)
- [x] Error handling covers edge cases (truncated `finalize_jobs` now recovered)
- [x] Validation rules are complete: N/A
- [x] Authorization checks are in place (unchanged; the cancel route still scopes to the user)
- [x] No unhandled promise rejections (the watcher's promise has a `.catch`; Apify `abort()` errors are swallowed)
- [x] No memory leaks in useEffect: N/A (no UI changes); the interval is cleared in `finally`
- [x] Large collections use chunking: N/A
- [x] Tests cover the main scenarios (agentic loop, signals, Apify abort; the watcher itself is covered by the manual checks)
- [x] No existing features were removed or broken (all 31 earlier tests pass; behaviors in the preserve list are kept)
- [x] No unrelated files were modified (`lib/job-sources/index.ts` was added for the approved logging fix)
