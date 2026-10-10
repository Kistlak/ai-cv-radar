# Plan: Retry Gemini calls after a per-minute rate limit (429)

**Status**: Completed (code), 2026-10-11. Review approved as is. Live check pending (T1 day-3 eval).
**Date**: 2026-10-11
**Type**: Bug fix (bug fix protocol). Not an Asana task.
**Branch**: `fix/gemini-rate-limit-retry`, from `master`. It's a small standalone PR like #14, so it can ship to production on its own.
**Related**: `PRD-match-quality.md` (found by the T1 baseline, day 2; recorded in the T1 review).

## Task Summary
On the Gemini free tier, a single search can go over Google's **per-minute** request limit:
- `scoreJobs` sends 3 scoring batches at once (`SCORING_CONCURRENCY = 3`);
- plus one call to derive the queries when the search box is blank.

Gemini then answers **429 RESOURCE_EXHAUSTED** and says how long to wait. The app doesn't retry, so `scoreBatch` turns those batches into the fallback **30 / "Score unavailable"**. The same happens to any other Gemini call (CV parse, deep-dive, cover letter, tailored CV) when the user is quick.

**Fix:** when Gemini answers 429 for a per-minute limit, wait the delay it asks for (plus a little jitter) and try again, at most twice, and never past the call's own timeout or cancel signal.
- A **per-day** limit isn't retried; it can't succeed for hours. It fails straight away with a clear message.

## Root cause (stated before fixing, per the bug protocol)
- **Observed:** in T1 baseline day 2, 6 batches failed with `429`, and a call made just afterwards succeeded. So it was the per-minute limit, not the daily one.
- **Why it isn't retried:**
  - `lib/ai/gemini.ts` calls `generateContent` once.
  - The SDK's own retry (`httpOptions.retryOptions`) is off by default. When on, it uses fixed 1/2/4/8 s back-off that ignores Gemini's `retryDelay`, and it also retries per-day 429s. So it isn't a fit.
- **Effect:** `scoreBatch` catches the error and gives every job in the batch the fallback score.

**To confirm while reproducing:** the exact 429 body. I expect the message to include `quotaId` (for example `GenerateRequestsPerMinutePerProjectPerModel-FreeTier` vs `…PerDay…`) and either a `RetryInfo` detail with `retryDelay` (for example `"37s"`) or the text "Please retry in 37.1s". The parser handles all three forms, and the tests use real-shaped bodies.

## Affected Files
- `lib/ai/gemini.ts`: wrap the `generateContent` call in a small retry loop.
- `lib/ai/gemini-retry.ts` (new): the pure helpers `parseRateLimit(err)` (returns `{ perDay, retryAfterMs }` or `null`) and an abortable `sleep`.
- `tests/unit/gemini-client.test.ts`: new failing tests first (below). The existing 3 tests stay.
- `tests/unit/gemini-retry.test.ts` (new): parser tests on real-shaped 429 bodies.

## Current Behavior to Preserve (`createGeminiClient().complete`)
1. Model choice per tier (`gemini-3.8-flash` defaults; `GEMINI_*_MODEL` overrides).
2. `thinkingConfig: { thinkingLevel: LOW }`.
3. `maxOutputTokens`, `systemInstruction`, `responseMimeType` (JSON mode), with the same config as today.
4. `abortSignal` from `completionSignal({ signal, timeoutMs })`: cancel and timeout still end the call, now including any retry wait.
5. `throw new Error('Gemini: empty response')` on an empty response, which is **not** retried.
6. Any other error (400, 401, 404, 5xx, network) is thrown as today, **not** retried. That's unchanged behaviour; only the per-minute 429 is new.

`scoreBatch`, `scoreJobs` and the other callers are **not changed**. They benefit automatically.

## Out of Scope
- Lowering `SCORING_CONCURRENCY` for Gemini, or a client-side rate limiter. A possible follow-up if retries alone aren't enough (see Risks).
- Retrying 5xx or network errors.
- Anthropic. Its SDK already retries 429 with `retry-after` (`maxRetries` defaults to 2).
- Changing the fallback score or the "Not scored" display (Task 7).
- Telling the user in the UI that their free quota is used up (Task 7 / Settings text).

## Approach
1. **`parseRateLimit(err)`.** It returns `null` unless `err` is an `ApiError` with `status === 429` (or a message containing `RESOURCE_EXHAUSTED`).
   - `perDay`: the message contains `PerDay` in a quota id.
   - `retryAfterMs`, from the first match of:
     - `"retryDelay": "37s"`;
     - "retry in 37.1s" (or `ms`);
     - a default of 10 s.
   - The result is clamped to between 1 s and 60 s.
2. **The retry loop in `complete()`, at most 2 retries (3 attempts):**
   ```
   for attempt in 0..2:
     try: return await generate()
     catch err:
       rl = parseRateLimit(err)
       if !rl or rl.perDay or attempt == 2: throw err
       wait = rl.retryAfterMs + jitter(0–1000 ms)
       if the call's deadline (timeoutMs) would pass before wait ends: throw err   // fail now, don't wait for nothing
       await sleep(wait, abortSignal)   // cancel/timeout ends the wait with the abort error
   ```
   - The deadline is `start + timeoutMs` when `timeoutMs` is set.
   - The existing combined `abortSignal` still covers the whole call, waits included.
3. **Log** `gemini.rate_limited { attempt, waitMs, perDay }` at `warn` on each retry. For per-day limits, log once and throw.

## Database Changes
None.

## API Endpoints
None.

## Edge Cases & Risks
- **Scoring batches have a 45 s cap** (`BATCH_TIMEOUT_MS`). If Gemini asks for longer than the time left, we fail at once (same as today) instead of waiting for nothing. So the fix helps when the delay is short, which is typical when only one or two requests went over. It may not fully solve a search with many batches.
  - The follow-up would be lower concurrency for Gemini (out of scope). The eval's `unscored` count after the fix will tell.
- **Searches get a little slower when rate-limited:** up to about 2 × (delay + 1 s) per call, still inside each call's timeout and the search's 300 s budget, because the waits respect the timeout.
- **Per-day quota:** no retry, so there's no extra wait. Same failure as today, but logged clearly.
- **Cancel during a wait:** the abortable `sleep` rejects with the abort error, so cancelled searches stop as before.
- **Unknown 429 format:** the default is a 10 s wait, at most twice. That's bounded.

## Testing Strategy (failing tests first)
1. **Reproduce** (`tests/unit/gemini-client.test.ts`, SDK mocked, fake timers). These fail on today's code:
   - the first call rejects with a per-minute 429 (`retryDelay "2s"`) and the second resolves, so `complete()` returns the text and `generateContent` is called twice;
   - two 429s and then success means 3 calls; three 429s mean it throws after the 3rd.
2. **Must not retry** (these pass today and must keep passing):
   - a per-day 429 is thrown after 1 call;
   - a 400 or 404 is thrown after 1 call;
   - an empty response throws 'Gemini: empty response' after 1 call.
3. **Bounds:**
   - with `timeoutMs` shorter than the requested delay, it throws without waiting;
   - aborting the signal during the wait rejects promptly.
4. **Parser** (`tests/unit/gemini-retry.test.ts`): `retryDelay` JSON, "retry in 37.1s", the per-day quota id, a non-429 → `null`, and the clamping.
5. **Checks:** lint, typecheck, `npm test`, `next build`.
6. **Live check (costs a few free-tier requests, with your OK):** run the T1 day-3 cases with the fix in place. Fewer or no `score_jobs.batch_failed` per-minute failures means it works. The eval then also stops depending on the 65 s case delay.
