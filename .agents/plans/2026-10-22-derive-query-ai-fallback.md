# Plan: Keep a blank-query search going when the AI can't build queries

**Status**: Completed, 2026-10-22. Review approved with "fix all": `.agents/plans/reviews/2026-10-22-derive-query-ai-fallback-review.md`
**Date**: 2026-10-22
**Type**: Bug fix (bug-fix protocol). Not an Asana task. No PRD.
**Branch**: `fix/derive-query-ai-fallback`, from `origin/master` at `7716711` (includes #39 location picker).
**Related**: the follow-up listed in `.agents/plans/2026-10-21-gemini-503-retry.md` (Out of Scope: "A fallback in `deriveQueriesFromCv`").

## Task Summary
With the **Query** field blank, a search fails outright whenever the AI is overloaded or slow. For example, it failed on 2026-10-22 with "The AI provider is busy right now", after the 503 retries.

**The fix:** when the AI call that builds queries from the CV fails for a **temporary** reason, carry on with the fallback query that already exists: the CV's most recent job title, or "jobs" if there isn't one. That's the same fallback used today when the AI's answer can't be parsed.
- The job sources still run.
- If the AI is still down at scoring, the jobs come back **unscored** (Task 7 behaviour) instead of the search failing.

## Root cause (stated before fixing, per the bug protocol)
- `deriveQueriesFromCv` (`lib/derive-query.ts`) calls `ai.complete(...)` **outside** its `try`. The `try` only covers parsing the answer.
- So an error from the call itself goes up to `runSearch`'s catch, and the search is saved as `failed`, before any job source has run. That covers 503/529 after the retries, a timeout and a network error.
- Scoring doesn't have this problem: `scoreBatch` catches its errors and the jobs end up unscored.
- **Not confirmed from logs:** that the 2026-10-22 failure was at this step. It's the only uncaught AI call before the job sources, and the search failed with the busy message, so it's the likely one. The `run_search.failed` log line would confirm it.

## Affected Files
- **`lib/search-errors.ts`:** a new `isTransientAiError(err)`, next to `searchErrorMessage`, which already knows the same error classes. It's true for:
  - **timeouts:** the same set `searchErrorMessage` maps to `AI_TIMEOUT_MESSAGE`: `TimeoutError`, `AbortError`, Anthropic `APIUserAbortError` and `APIConnectionTimeoutError`. The Anthropic SDK reports our own timeout signal as `APIUserAbortError`. A real user cancel is told apart by the caller's `signal.aborted`, which is checked first.
  - **overloaded:** Gemini `ApiError` + `isOverloaded`, Anthropic `APIError` 529;
  - **server errors:** Gemini `ApiError` / Anthropic `APIError` with status ≥ 500;
  - **network failures:** Anthropic `APIConnectionError`, or a `TypeError` "fetch failed".
- **`lib/derive-query.ts`:** wrap the `ai.complete` call:
  - **cancelled by the user** (`signal?.aborted`): rethrow, so the search stays `cancelled` as today;
  - **`isTransientAiError(err)`:** log `derive_query.ai_unavailable` (`warn`, with the error) and return `fallback`;
  - **anything else:** rethrow, as today (e.g. a bad API key, 400 or 401, or a per-day quota 429), so the real problem is still shown.
- **Tests:**
  - `tests/unit/derive-query.test.ts`: new cases; the existing 4 stay;
  - `tests/unit/job-sources-country.test.ts`, the `searchErrorMessage` block: `isTransientAiError` cases.
- **Docs:** this plan and its review.

## Current Behavior to Preserve
**`deriveQueriesFromCv`:**
1. The prompt, `tier: 'fast'`, `maxTokens: 300`, `timeoutMs: 30_000`, and passing `signal`.
2. Parsing: the first JSON array; strings only; trimmed; 100-character cap; `count` cap.
3. An unusable answer (no array, an empty array or non-strings) → `[fallbackRole]` or `['jobs']`.
4. `deriveQueryFromCv` (single query) is unchanged.

**`runSearch`:** a user-typed query skips this step entirely. Progress stages, the persisted primary query, cancel handling and `searchErrorMessage` are all unchanged.

**Non-temporary AI errors still fail the search** with their own message: a missing or invalid key, 4xx, a per-day quota.

## Out of Scope
- **Switching provider** (Gemini → Anthropic) on failure.
- **Telling the user in the UI** that a fallback query was used. The search shows the role it searched for, as it does when the AI's answer is unusable today.
- **Retrying 500/504 inside the Gemini client** (decided in the 503 task: 503 only).
- **Scoring:** it already degrades to unscored.

## Approach
1. **Reproduce.** Add failing tests first, and run them after asking:
   - `ai.complete` rejects with a Gemini 503 `ApiError` → expect `[role]`. Today it rejects.
   - The same with a `TimeoutError` → expect `[role]`.
2. **Confirm** the root cause with you, then fix.
3. **`isTransientAiError`** in `search-errors.ts`. It reuses the existing checks; no new SDK knowledge is needed except the ≥ 500 status and the connection-error classes.
4. **`deriveQueriesFromCv`:**
   ```
   let text: string
   try {
     text = await ai.complete({...unchanged})
   } catch (err) {
     if (signal?.aborted || !isTransientAiError(err)) throw err
     logger.warn({ event: 'derive_query.ai_unavailable', provider: ai.provider, err })
     return fallback
   }
   // parsing as today
   ```
5. **Checks:** lint, typecheck and `npm test`, after asking.

## Database Changes
None.

## API Endpoints
None.

## Edge Cases & Risks
- **User cancel during this step:** the caller's signal is aborted, so we rethrow. The search keeps its `cancelled` status, as today. Tested.
- **A timeout from our own 30 s cap** surfaces as `TimeoutError` / an abort while the **caller's** signal isn't aborted. That counts as temporary, so we fall back. Tested.
- **A search that "works" with a weaker query:** the role title (or "jobs") is broader than three AI-picked queries. That's accepted: some results beat a failed search, and the user can retry or type a query.
- **"jobs" when the CV has no role:** a very broad search. This is the existing fallback (Task 3), unchanged.
- **The AI is also down for scoring:** jobs are shown unscored with "Not scored" (Task 7). That's slower too, since every scoring batch tries 3 times, but it stays inside the 300 s search budget.
- **Real configuration problems** (bad key, 401/403, a per-day quota 429) still fail loudly with their own message, so they aren't hidden behind unscored results.

## Testing Strategy
**`derive-query.test.ts`:**
- **Falls back to the role on a temporary error:**
  - Gemini 503 `ApiError`;
  - Anthropic 529 `APIError`;
  - Gemini 500;
  - `TimeoutError`;
  - `TypeError('fetch failed')`.
- **Falls back to 'jobs' without a role** on a temporary error.
- **Rethrows** when the caller's signal is aborted, even for a temporary-looking error.
- **Rethrows non-temporary errors:** Gemini 400, Anthropic 401, a per-day-quota 429.
- **Existing parse and fallback tests are unchanged.**

**`isTransientAiError`:**
- true for the cases above;
- false for 400, 401 and 429, a plain `Error`, and a non-Error.

**Regression:** the full `npm test`, lint and typecheck.

**Manual:** with Gemini busy (or a bad model name, to force an error) and a blank query, the search completes with role-based results, possibly unscored, and the log shows `derive_query.ai_unavailable`.

## Questions for you
1. **Per-minute rate limits (429)** that still fail after the client's retries: treat them as temporary, so the search continues? Or as a hard failure, as now?
   - Recommended: **hard failure**, as now. The client already waits and retries them, and if they persist, scoring would hit the same limit. A per-day quota stays a hard failure either way.

## Outcome (2026-10-22)
- **Answer** (approved with "ok"): a per-minute 429 stays a hard failure.
- **Reproduced:** 8 of the new `derive-query` tests failed before the fix (every temporary error was rethrown).
- **Fixed as planned**, with one deviation: a `.catch` on the existing `ai.complete(...)` instead of a `try`/`catch` block, so the prompt template isn't re-indented. Same behaviour.
- **Review "fix all":**
  - **End-to-end test:** `tests/unit/run-search-ai-fallback.test.ts` runs `runSearch` with mocked db, keys, AI and sources, and the real `rankJobs`.
    - Gemini 503 → it searches for the CV role, saves the job unscored, flags `queryFallback` and completes.
    - Anthropic 401 → it fails before any source runs.
  - **Network errors:** `isTransientAiError` also accepts a `TypeError` whose `cause.code` is a socket or DNS code (`ECONNRESET`, `UND_ERR_SOCKET`, …).
  - **Note for the user**, with no migration:
    - `deriveQueriesFromCv` takes an optional `onAiUnavailable` callback;
    - `runSearch` stores `queryFallback: true` in `searches.progress` (existing JSON column);
    - the results page shows "The AI was busy when this search started, so we searched for "{query}" from your CV instead…".
  - **Files beyond the plan's list:** `lib/run-search.ts`, `lib/search-progress.ts`, `app/(app)/search/[id]/page.tsx`.
- **Checks:**
  - `npm run lint`: 0 errors, 1 existing warning;
  - `npm run typecheck`: clean;
  - `npm test`: 31 files, 378 tests passed;
  - `next build`: OK.
- **Still open:** a manual check with Gemini actually busy (or a bad model name, to force an error).
