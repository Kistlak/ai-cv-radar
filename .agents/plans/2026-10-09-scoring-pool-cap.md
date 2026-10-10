# Plan: Cap the scoring pool when the user picks a result count

**Status**: Implemented (base), 2026-10-09. Approved by the owner ("go ahead with the most suitable option"). Completed as part of PRD-match-quality Task 8.
**Date**: 2026-10-09
**Branch**: started on `fix/hardening-and-cleanup`, moved uncommitted to `feature/match-quality` (2026-10-09)
**PRD**: `.agents/prd/PRD-match-quality.md` (Task 8). It started as a standalone cost fix from the 2026-10-09 enhancement list.

## Task Summary
The search form offers a job count of 2, 5, 10 or All (default 10). Today `runSearch` sends **every** fetched job to the AI for scoring, about 250 jobs or 25 batches, and only then keeps the top N (`lib/run-search.ts`, after `scoreJobs`).

When the user chose a count, the fix is:
1. Rank the deduped jobs cheaply, with no AI, by how well their title and description match the search queries.
2. Send only the best `max(N × 4, 30)` jobs to the AI.
3. Keep the top N after scoring, as before.

With the default count of 10, that's 40 jobs instead of about 250: 4 batches instead of about 25, and about 85% fewer scoring calls. Fewer batches also means fewer jobs miss the 230 s scoring deadline and get the placeholder score of 30. "All" behaves exactly as it does today.

## Affected Files
- `lib/score-pool.ts` (new): the pure functions `scoringPoolSize(maxResults)` and `preRankJobs(jobs, queries)`.
- `lib/run-search.ts`: call them between dedupe and `scoreJobs`, and add one log event.
- `tests/unit/score-pool.test.ts` (new): unit tests.

## Current Behavior to Preserve (`runSearch`)
- **Queries:** a user query is used as given; a blank query derives 3 queries, and the primary one is saved on the search.
- **Fetching:** the agentic path and the cheap sources run in parallel, then jobs are deduped.
- **Apply URLs:** `toHttpUrl` filtering and the `sourceJobId` fallback.
- **Cancellation:** the cancel watcher and the checks before scoring, after scoring and before the final status.
- **Zero jobs:** `complete` immediately.
- **Scoring:** `scoreJobs` gets the same arguments (deadline, cancel signal). Its batching, concurrency, timeouts and fallback score are untouched.
- **After scoring:** keep the top N by `matchScore`, or all jobs when `maxResults` is null.
- **Saving:** `onConflictDoNothing` on insert; progress stages and their fields; error handling and `logger.flush()`.
- **"All" (`maxResults` null):** identical to today, with no pre-ranking and no cap.
- **Small fetches:** when the fetch returns no more jobs than the pool size, every job is scored as today.

## Out of Scope
- `scoreJobs` and the scoring prompt.
- Per-source fetch limits and the agentic prompt.
- The placeholder score on deadline. Only made rarer by this change.
- Embedding-based ranking (a separate idea).
- The search form options.
- The `progress.totalJobs` meaning: it will show the pool size, which is the number actually being scored. See Risks.

## Approach
1. **`scoringPoolSize(maxResults: number | null): number | null`**
   - Returns `null` (no cap) when `maxResults` is null.
   - Otherwise returns `Math.max(maxResults * POOL_MULTIPLIER, MIN_POOL)`, with `POOL_MULTIPLIER = 4` and `MIN_POOL = 30`.
   - So 2 → 30, 5 → 30, 10 → 40, 50 (the API maximum) → 200.
2. **`preRankJobs(jobs, queries): RawJob[]`** is stable, pure and has no AI calls.
   - **Terms:** lower-cased words from all queries, of 2+ characters, deduped, with a small stop-word list removed (`and`, `or`, `the`, `remote`, `developer`, `engineer`, `senior`, `junior`, `jr`, `sr`, …). The role words are dropped because they match almost every job.
   - **Score per job:**
     - 3 points for each term found in the title,
     - 1 point for each term found in the first 1,000 characters of the description (HTML stripped).
     - Terms are matched on word boundaries, so "go" doesn't match "good", and terms such as `c#`, `.net`, `node.js` are escaped.
   - Sorted by score, highest first. Ties keep the original order, so the result is deterministic.
   - If no terms remain (for example, every query word is a stop word), the input order is returned unchanged.
3. **`run-search.ts`**, after the `rawJobs` filtering and the zero-jobs check:
   ```ts
   const poolSize = scoringPoolSize(search.maxResults)
   const toScore =
     poolSize && rawJobs.length > poolSize ? preRankJobs(rawJobs, queries).slice(0, poolSize) : rawJobs
   ```
   - Log `run_search.scoring_pool` with `{ searchId, fetched: rawJobs.length, pool: toScore.length }`.
   - Pass `toScore` to `scoreJobs` and use `toScore.length` for `totalJobs` in the scoring progress.
   - Everything after that is unchanged.

## Database Changes
None.

## API Endpoints
None changed.

## Edge Cases & Risks
- **A good job is cut by the pre-rank.**
  - Example: a strong match whose title uses a synonym, such as "Software Engineer" for a "Laravel developer" query, with the key word only deep in the description.
  - Mitigations:
    - The pool is 4× the requested count.
    - Description matches count.
    - Blank-query searches use all 3 derived queries as terms.
  - "All" still scores everything. Accepted trade-off. The multiplier is a constant that's easy to tune.
- **The agentic (Apify) jobs were already chosen by Claude for the CV.** They go through the same pre-rank. Their titles usually match the query, so they rank well. No special treatment, to keep the change small.
- **The progress bar total changes** from "fetched" to "pool". The UI only shows it as the scoring total, so it stays consistent with the batches actually run.
- **Non-English queries or terms:** word-boundary matching uses a Unicode-aware regex (`\p{L}\p{N}`). If nothing matches, the input order is kept (the same as the first N fetched).

## Testing Strategy
- **Unit tests (`tests/unit/score-pool.test.ts`):**
  - `scoringPoolSize`: null, 2, 10 and 50.
  - `preRankJobs`:
    - a title match beats a description match, which beats no match;
    - stable order on ties;
    - stop words are ignored, and the input order is unchanged when every term is a stop word;
    - word boundaries ("go" vs "good");
    - special-character terms (`c#`, `node.js`);
    - HTML stripped from descriptions;
    - multiple queries are combined;
    - the input array isn't mutated.
- **Existing tests:** `npm test` (full suite), `npm run typecheck`, `npm run lint`, `next build`. I'll ask before running them.
- **Manual (optional, real keys):** run a search with a count of 10 and check that the `run_search.scoring_pool` log shows `pool: 40`, that the run is faster, and that the top results look as good as before.
