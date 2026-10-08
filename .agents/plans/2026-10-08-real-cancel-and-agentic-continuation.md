# Real Cancellation & Agentic Continuation (review Important items 1–2)

**Status**: Completed (code), 2026-10-08. Manual checks with real keys pending. Review approved with changes (the two Important items fixed; suggestions not applied).

**Deviations:**
- `runAgenticSearch` takes an optional second `client` parameter (defaults to `new Anthropic(...)`) so the loop is unit-testable.
- The Apify helper is an exported `runActor(client, actorId, input, signal)`. Shared signal helpers are `sourceSignal()` in `lib/job-sources/types.ts` and `completionSignal()` in `lib/ai/types.ts`.
- From the review:
  - A `finalize_jobs` call cut off by `max_tokens` now goes through the recovery request first. After the recovery, a partial list is accepted rather than none.
  - `safeCall` in `lib/job-sources/index.ts` (not in the original plan) no longer logs `AbortError` (cancel) as a source failure. Timeouts (`TimeoutError`) and real errors are still logged.

## Outcome (2026-10-08)
- Unit tests 54/54 (23 new), `tsc` clean, lint 0 errors (1 pre-existing warning).
- **Still to do:** the manual checks in the Testing Strategy section (real keys), then commit and push on your go-ahead.
**Date**: 2026-10-08
**Source**: `.agents/plans/reviews/2026-10-07-full-project-review.md`, Important items "Cancel only flips the status" and "`agentic-search.ts` single `messages.create` call"
**Builds on**: `.agents/plans/2026-10-08-search-reliability.md` (branch `fix/search-reliability`). This task branches from there as `fix/search-cancel-and-agentic`.
**PRD**: none. One pipeline (search), one task.

## Task Summary
1. **Cancel doesn't stop anything.** `POST /api/search/[id]/cancel` only sets `status = 'cancelled'`. `runSearch` checks that between phases, so the agentic Claude + Apify call (up to 210s), the job-source fetches, Apify actor runs and scoring all keep running, and billing, after the user clicks Cancel.
2. **The agentic call can silently lose its work.** `runAgenticSearch` makes one `messages.create` call:
   - If it stops with `pause_turn` (the API pausing a long server-side tool turn; the MCP connector's tool calls run server-side), we treat it as finished. No `finalize_jobs` → `[]`.
   - If it stops with `max_tokens`, every job the agent gathered is lost → `[]`.

   The Anthropic docs (checked 2026-10-08) say a paused turn is resumed by appending the assistant `content` as-is and sending the request again, with no new user message.

## Affected Files
| File | Change |
|---|---|
| `lib/run-search.ts` | One run-wide `AbortController`; a watcher polls `isCancelled` every 3s and aborts it; pass the signal everywhere; log a cancelled run as cancelled, not failed |
| `lib/agentic-search.ts` | Loop: continue on `pause_turn` (max 3 continuations); on `max_tokens` without `finalize_jobs`, one recovery request asking it to finalize; count MCP calls across requests |
| `lib/job-sources/index.ts` | Thread an optional `signal` through `fetchAllSourcesMultiQuery` → `fetchSources` → each fetcher |
| `lib/job-sources/remotive.ts`, `adzuna.ts`, `jsearch.ts` | `AbortSignal.any([signal, AbortSignal.timeout(SOURCE_TIMEOUT_MS)])` |
| `lib/job-sources/apify.ts` | Replace `actor.call()` with `actor.start()` + `waitForFinish` in short slices; on abort, `client.run(id).abort()` so Apify stops billing |
| `lib/job-sources/types.ts` | `signal?: AbortSignal` on `SearchParams` (no new parameter on every fetcher) |
| `lib/ai/types.ts`, `lib/ai/anthropic.ts`, `lib/ai/gemini.ts` | Optional `signal` next to `timeoutMs`, combined with `AbortSignal.any` |
| `lib/score-jobs.ts` | Optional `signal`: stop starting batches once aborted and pass it to `ai.complete` |
| `lib/derive-query.ts` | Optional `signal`, passed to `ai.complete` |
| `tests/unit/agentic-search.test.ts` (new), `tests/unit/score-jobs.test.ts` | Unit tests |

## Current Behavior to Preserve
- **Cancel route:** unchanged. 401/404/409 and `status = 'cancelled'` + `completedAt`.
- **`runSearch`:** everything in the previous plan's preserve list, plus:
  - A cancelled search is never overwritten with `failed` or `complete`.
  - The three existing `isCancelled` checks stay as a backstop.
  - The agentic timeout (`AGENTIC_TIMEOUT_MS`, 210s) still aborts only the agentic call, and the run then continues with the cheap-source jobs.
- **`runAgenticSearch`:**
  - Same model, system prompt, tools, MCP server config, beta header and `finalize_jobs` schema.
  - Returns `[]` (with the `no_finalize` warning) if it never finalizes.
  - The `onEvent('mcp_calls')` progress event and the `model_returned` / `finalized` log events stay (now one `model_returned` per request).
- **Job sources:**
  - `safeCall` turns any failure into `[]`.
  - The 20s source timeout and the 150s Apify cap stay.
  - A non-`SUCCEEDED` run returns `[]`, and the field mapping is unchanged.
- **`scoreJobs`:** order, batch size, concurrency 3, the 45s per-batch timeout, the deadline, and the fallbacks are unchanged when no signal is passed.
- **Other AI routes:** callers that pass neither `timeoutMs` nor `signal` behave exactly as today.

## Out of Scope
- **Apify runs started *by the agent* through the MCP server.** Those runs belong to the Apify MCP server, not to us. Aborting the Anthropic request stops the model, but an actor it already launched runs until its own timeout. We can't reliably identify those runs. This goes into "Known limitations".
- Streaming the agentic call, prompt caching, or changing the agent model or prompt.
- Adzuna country fix, dashboard Gemini check, and the other Important items (separate tasks).
- Any UI change: the Cancel button and poller already handle `cancelled`.

## Approach

### 1. Run-wide cancellation (`lib/run-search.ts`)
- At the start of `runSearch`: `const cancel = new AbortController()`. Then `const watcher = setInterval(() => isCancelled(searchId).then((c) => c && cancel.abort()).catch(() => {}), CANCEL_POLL_MS)` with `CANCEL_POLL_MS = 3_000`. Call `clearInterval(watcher)` in `finally`.
- **Agentic:** `signal: AbortSignal.any([controller.signal, cancel.signal])`. The existing timeout controller is kept. In the `catch`, the log distinguishes `agentic_timeout` from `agentic_cancelled`.
- **Cheap sources:** pass `signal: cancel.signal` in the base params to `fetchAllSourcesMultiQuery`.
- **Scoring:** `scoreJobs(..., deadline, cancel.signal)`.
- **Query derivation:** `deriveQueriesFromCv(..., signal)`.
- Right after `Promise.all` and after scoring, the existing `isCancelled` checks return early. Add `if (cancel.signal.aborted) return` beside them, which saves a DB round trip.
- **`catch`:** if `cancel.signal.aborted`, log `run_search.cancelled` (warn) instead of `run_search.failed` (error). The status write is already skipped for cancelled runs.

### 2. Signals through the job sources
- `SearchParams` gets `signal?: AbortSignal`. `fetchSources` passes `params` through, so no signature changes.
- Remotive, Adzuna and JSearch use `signal: params.signal ? AbortSignal.any([params.signal, AbortSignal.timeout(SOURCE_TIMEOUT_MS)]) : AbortSignal.timeout(SOURCE_TIMEOUT_MS)`.
- **Apify** (`runActor` helper inside `apify.ts`, used by all three fetchers):
  1. `const run = await client.actor(id).start(input, { timeout: 150 })`.
  2. Loop: `await client.run(run.id).waitForFinish({ waitSecs: 5 })` until the run is terminal or 150s pass, checking `params.signal?.aborted` between slices.
  3. On abort: `await client.run(run.id).abort().catch(() => {})`, then throw an `AbortError`. `safeCall` turns that into `[]`.
  4. The rest (status check, dataset `listItems`, mapping) is unchanged.

### 3. Signals through the AI layer
- `AiCompletionOptions.signal?: AbortSignal`. In both providers, build one signal from whichever of `signal` / `AbortSignal.timeout(timeoutMs)` is present (`AbortSignal.any` when both), and pass it the same way as today.
- **`scoreJobs`:** an optional `signal` parameter after `deadline`. A worker stops taking batches once it's aborted (remaining batches get the fallback score, but `runSearch` returns before persisting anyway), and the signal is passed to `ai.complete`.

### 4. Agentic continuation (`lib/agentic-search.ts`)
```
messages = [user prompt]
for request in 1..MAX_REQUESTS (4):
  response = beta.messages.create({...same params, messages}, { signal })
  mcpCalls += count of mcp_tool_use blocks; log model_returned (stopReason, request #)
  if finalize_jobs block in response.content → return its jobs
  if stop_reason == 'pause_turn':
      messages.push({ role: 'assistant', content: response.content }); continue
  if stop_reason == 'max_tokens' and not yet recovered:
      messages.push({ role: 'assistant', content: response.content })
      messages.push({ role: 'user', content: 'You ran out of output space. Call finalize_jobs now with the best jobs you have already found. Keep each description under 300 characters.' })
      recovered = true; continue
  break
log no_finalize; return []
```
- **Truncated content:** if a `max_tokens` response ends in an incomplete `tool_use` or `mcp_tool_use` block, appending it can be rejected by the API. Before recovering, trim trailing `tool_use` and `mcp_tool_use` blocks that have no matching result block in the same content. If that leaves nothing, skip the recovery.
- `MAX_REQUESTS = 4` (1 + up to 3 continuations, where one may be the max_tokens recovery). The 210s abort signal bounds total time whatever the count.
- `onEvent('mcp_calls')` fires after each request with the running total, so the progress UI updates during long runs.

## Database Changes
None.

## API Endpoints
No changes. Cancelling now actually stops the work within about 3 seconds.

## Edge Cases & Risks
- **Cancel during persisting:** the insert is quick. The existing post-insert `isCancelled` check still prevents `complete`, and the inserted rows are hidden because the page shows results only for `complete`. Same as today.
- **Watcher DB load:** one `SELECT status` every 3s per running search. With at most 1 running search per user, that's negligible.
- **Watcher races `finally`:** `clearInterval` runs in `finally`, and a late tick only aborts an already-finished controller. Harmless.
- **Apify `start` + slices vs `call`:** slightly more API calls (one `waitForFinish` per 5s). `waitForFinish` returns early when the run ends, so latency is unchanged.
- **Agent-launched Apify runs keep running after cancel** (see Out of Scope). Documented, not fixed.
- **Continuations cost tokens:** each request re-sends the conversation so far. That's bounded by `MAX_REQUESTS` and the 210s budget. A `pause_turn` should be rare.
- **`AbortSignal.any`:** needs Node ≥ 20.3. Local is 22.18 and Vercel defaults to 20+/22.

## Testing Strategy
**Unit (Vitest):**
- `runAgenticSearch` with a fake Anthropic client (inject via an optional `client` parameter, or mock `@anthropic-ai/sdk`):
  - Finalizes on the first request.
  - `pause_turn` → `pause_turn` → finalize: the paused content is appended as an assistant turn, no user message is added, and the MCP count sums.
  - `max_tokens` → recovery prompt → finalize; a trailing incomplete `tool_use` is trimmed.
  - Stops after `MAX_REQUESTS`.
  - `end_turn` with no finalize returns `[]`.
  - An aborted signal rejects.
- `scoreJobs` with an aborted signal: makes no new AI calls, and the output length is still preserved.
- Source fetchers: an already-aborted `params.signal` rejects (mocked `fetch`).
- Apify `runActor`: abort mid-wait calls `run.abort()` (mocked client).

**Checks:** `tsc`, lint, and the full `npm test`.

**Manual (dev, real keys):**
1. Start a search with LinkedIn selected, click Cancel within 10s, and confirm:
   - The logs show `agentic_cancelled` within about 3s.
   - The function ends early.
   - In the Apify console, the non-agentic runs show ABORTED.
2. Cancel during scoring and confirm no more scoring calls appear in the logs.
3. Run a normal search end to end and confirm there's no regression; the logs show the per-request `stopReason`.

## Open Questions
1. **Branch:** stack this on `fix/search-reliability` (it reuses that branch's timeout plumbing), or wait until that branch is merged?
2. **Agent-launched Apify runs:** OK to leave them as a documented limitation? The alternative is to have the agent pass a run tag and abort tagged runs on cancel. That's possible only if the Apify MCP tools accept one, so it needs research first.
