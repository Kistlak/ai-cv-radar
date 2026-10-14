# Plan: Match quality T9: rerank the top candidates with the smart model

**Status**: Completed (code), 2026-10-15. Decisions: rerank off by default (`RERANK_ENABLED`), the 200 s fast-pass deadline only when it is on. Review approved; the `RERANK_TOP_K` cap at 20 (review, Important) was added afterwards in a follow-up commit (313/313 tests). Deviations: `RerankSummary.ms` for the log, no `rerank_skipped` log for `disabled`, the eval model label carries the rerank setting. Lint, `tsc`, `npm test` (312/312) and `next build` pass. Pending: the eval (rerank off vs on, then the smart-model comparison) before turning it on, and one manual search with it on.
**Date**: 2026-10-15
**Branch**: `feature/match-quality-t9-rerank` (new, from `origin/master` at `4ab2ca8`; T5 and T6 are merged)
**PRD**: `.agents/prd/PRD-match-quality.md` (Task 9, requirement F9, goal G6, design §6.8 and §6.9)

## Task Summary
Today every job is scored once by the **fast** tier:
- Anthropic: Haiku;
- Gemini: `gemini-3.8-flash`;
- batches of 10, with 1,500 characters of job text each.

The top N comes straight from those scores.

After this task, a **rerank** step runs after the fast pass:
- it takes the top `K` candidates, by default `min(20, max(2N, 10))`, or 20 for "All";
- it re-scores them on the **smart** tier, in batches of 5 run in parallel, with **3,000 characters** of job text and the same rubric and safeguards;
- the smart score and reason replace the fast ones;
- the final top N is chosen again from the merged scores.

The rerank is **best-effort**:
- It only starts before its deadline, and each batch is capped at 30 s.
- A failed batch, or a job the model skipped, keeps its fast score.
- It never makes a search fail. A skip is logged with the reason.
- It can be turned off with `RERANK_ENABLED`, and `RERANK_TOP_K` overrides `K`.

**On Gemini**, both tiers default to `gemini-3.8-flash` (`lib/ai/gemini.ts`). So until the model comparison runs, a Gemini rerank re-checks with the same model, but with twice the job text and smaller batches. Picking a stronger smart model is done afterwards through the eval, with `GEMINI_SMART_MODEL` / `ANTHROPIC_SMART_MODEL`. It needs no code change.

## Affected Files
- **`lib/rerank.ts`** (new):
  - **`rerankConfig(env = process.env)`** returns `{ enabled, topK }`:
    - `RERANK_ENABLED` is `true`/`false`, with the default decided by question 1;
    - `RERANK_TOP_K` is an integer ≥ 1, otherwise null, meaning the default formula is used;
    - it follows the `readLimit` pattern (`lib/usage-limits.ts`).
  - **`rerankTopK(maxResults, override)`** is a pure function. It returns `override ?? (maxResults === null ? 20 : min(20, max(2 * maxResults, 10)))`.
  - **`rerankTop(jobs, cvText, query, ai, opts)`**, where `opts` is `{ deadline?, signal?, candidate? }`:
    - batches of 5, all started together (at most 4 when K is 20);
    - `tier: 'smart'`, `maxTokens: 1500`, `timeoutMs: 30_000`;
    - the prompt is `buildPrompt(..., descriptionChars = 3000)`, and replies are parsed with the existing `parseScores` (zod-validated, clamped 0–100);
    - a batch is skipped if the signal is aborted or the deadline has passed when it would start;
    - returns `{ jobs, reranked, failed }`, where `jobs` has the same order and length as the input;
    - a failed batch logs `rerank.batch_failed`, the same shape as `score_jobs.batch_failed`.
- **`lib/score-jobs.ts`:** `buildPrompt` gets an optional 5th parameter, `descriptionChars = DESCRIPTION_CHARS` (1,500). Nothing else changes, and the fast pass calls it as before.
- **`lib/match-pipeline.ts`:**
  - `RankContext` gets `rerank?: boolean`, defaulting to `rerankConfig().enabled`, and `rerankDeadline?: number` (epoch ms).
  - After `scoreJobs`, when the rerank is on:
    - the candidates are `selectTop(scored, K)`, so unscored jobs are only included when there aren't enough scored ones, and the rerank can give them a score;
    - `rerankTop` runs on the candidates;
    - the results are merged back into `scored` by job;
    - then `top = selectTop(merged, maxResults)`.
  - `RankResult` gets `rerank: { status: 'done' | 'skipped', reason?: 'disabled' | 'deadline' | 'cancelled' | 'no-jobs', candidates: number, reranked: number, failed: number }`.
- **`lib/run-search.ts`:**
  - the fast-pass start deadline is 200 s from `t0` when the rerank is on, and stays 230 s when it's off (question 2);
  - the rerank start deadline is 245 s from `t0`;
  - logs `run_search.rerank_completed` (candidates, reranked, failed, ms) or `run_search.rerank_skipped` (reason);
  - no new progress stage: the UI keeps showing "scoring" until persisting (see Out of Scope).
- **`.env.local.example`:** `# RERANK_ENABLED=…` and `# RERANK_TOP_K=`, with a short comment, next to the AI model overrides.
- **`tests/eval/matching.eval.ts`:** the report header also prints the smart model and whether the rerank was on. The ranking logic is unchanged, because the eval calls `rankJobs` and so gets the rerank automatically. `RERANK_ENABLED=false npm run eval:matching` gives the "no rerank" run.
- **Tests:**
  - `tests/unit/rerank.test.ts` (new);
  - additions to `tests/unit/match-pipeline.test.ts`.
- **Docs:** this plan, its review, and the PRD's Task 9 row.

There's no DB migration and no API change.

## Current Behavior to Preserve
**Fast pass (`scoreJobs`):**
- batch size 10, concurrency 3, the 45 s batch cap and 1,500 characters;
- the deadline and cancel handling;
- the `score_jobs.batch_failed` log;
- null for unscored jobs, with the `NOT_SCORED` reason.

**`buildPrompt`:** identical output when called without the new parameter. The existing prompt assertions stay unchanged.

**`rankJobs`:**
- the freshness filter (T6), pre-rank, pool, `onPool` and the CV profile (T4/T8);
- `selectTop`, with unscored jobs last (T7);
- `scored` holds every job sent to scoring.

**Rerank off:** results are identical to today. That includes the 230 s fast deadline under question 2's recommendation.

**`runSearch`:**
- cancel handling before and after scoring;
- progress stages;
- what's persisted: `top`, with scores and reasons;
- the zero-jobs exit;
- the agentic timeout (210 s).

**Safeguards:** `untrusted()`, `<job_posting>` tags and `UNTRUSTED_JOB_RULE` are used in the rerank too, through the same `buildPrompt`.

## Out of Scope
- **A "Re-checking top matches" progress stage.** It would touch `SearchStage`, the poller UI and its order. It could be a small follow-up.
- **Changing default models.** The smart model is picked through the eval (PRD Q5), by env. `gemini-3.8-flash` stays the default for both Gemini tiers until the eval shows a better option.
- **A rerank-specific prompt or rubric.** The PRD says to use the same rubric.
- **Changing the fast batch cap from 45 s to 40 s** (PRD §6.8). It's kept at 45 s:
  - with the fast pass starting by 200 s, the worst case ends at 245 s, which is exactly when the rerank stops starting. So a slow fast pass simply skips the rerank, and the 300 s limit holds either way;
  - this avoids touching `scoreJobs`' timeout.
- **New quotas.** The rerank is covered by the existing search quota (PRD §6.9).
- **The Apify input drift and Indeed's relative dates.** These are follow-ups from T6.

## Approach
1. Add the `buildPrompt` `descriptionChars` parameter, with tests that the default output is unchanged and that 3,000 characters are used when passed.
2. Write `lib/rerank.ts` (`rerankConfig`, `rerankTopK`, `rerankTop`) and its unit tests, using a fake `AiClient`.
3. Add the rerank step and the `rerank` result to `rankJobs`, with tests.
4. In `run-search`: the deadlines, `rerankDeadline` and the two log events.
5. Add the env example and the eval report header.
6. Run lint, typecheck, `npm test` and `next build`, after asking you.
7. **Eval, optional and with your go-ahead, since it uses your key's quota.** Run it with the rerank off and then on, on the same cases, and record nDCG@10, good in the top 10, and stale/ineligible in the review.
   - The model comparison (flash smart tier vs a pro model through `GEMINI_SMART_MODEL`) is a further pair of runs.
   - On the Gemini free tier, the rerank adds about 4 requests per case, so plan around 8 per case.

## Database Changes
None.

## API Endpoints
None. Each search with the rerank on makes up to 4 more AI calls (smart tier).

## Edge Cases & Risks
- **Time budget:**
  - the fast pass starts by 200 s and, with the 45 s cap, ends by 245 s at worst;
  - the rerank starts only before 245 s and, with the 30 s cap, ends by 275 s;
  - persisting fits in the time left before 300 s;
  - an agentic run that goes long simply means `rerank_skipped` with the reason `deadline`.
- **Rate limits** (the Gemini free tier counts requests per minute):
  - 4 parallel smart calls come right after the fast pass;
  - `gemini-retry` retries a 429 within the call's timeout, and anything left over keeps its fast scores;
  - `RERANK_TOP_K` can lower the load, or `RERANK_ENABLED=false` turns it off.
- **Cost** (PRD Q2, accepted): about $0.10–0.20 per search on Anthropic Sonnet, and a fraction of that on Gemini Flash. On fallback keys it's inside the same search quota.
- **The model skips or rejects a job:** that job keeps its fast score and reason, and the miss is counted in `failed`.
- **Cancel during the rerank:** the signal aborts the calls, and runSearch's existing after-scoring check returns without persisting, as today.
- **Prompt injection with 3,000 characters:** the same `untrusted()`/tag defences apply, and scores are validated and clamped. This is listed in the PRD risks table.
- **Scores shift between fast and smart:** only the top K are rescored, so a job outside K keeps its fast score.
  - A strong job the fast pass placed just below K can't be lifted. That's by design (cost).
  - The top-N re-selection still compares fast scores with smart scores, but only the top K can reach the top N whenever K ≥ N. The default formula ensures K ≥ N up to N = 20. Above that, the extra places are filled with fast scores, as before.

## Testing Strategy
- **`rerankTopK`:**
  - N = 3 → 10;
  - N = 5 → 10;
  - N = 10 → 20;
  - N = 25 → 20;
  - "All" (null) → 20;
  - an override wins.
- **`rerankConfig`:**
  - the default, and `false`/`true`;
  - an invalid `RERANK_ENABLED` uses the default;
  - `RERANK_TOP_K` of `'5'` gives 5; `'0'`, `'x'` and `'2.5'` give null.
- **`rerankTop`:**
  - batches of 5 on the `smart` tier, with a 30 s timeout;
  - the prompt contains 3,000 characters of description;
  - replaced scores and reasons;
  - a failed batch, or a skipped index, keeps the fast score;
  - the deadline already passed or the signal aborted means no calls, everything unchanged;
  - the output order is preserved.
- **`buildPrompt`:** unchanged output by default; a longer description when `descriptionChars` is passed.
- **`rankJobs`:**
  - the rerank can promote a job, so the final top N follows the smart scores;
  - only the top K are sent to the smart tier;
  - `rerank: false` makes no smart calls and returns `status: 'skipped', reason: 'disabled'`;
  - a past `rerankDeadline` gives `reason: 'deadline'`;
  - an unscored job in the candidates can get a smart score;
  - "All" persists the merged scores.
- **Manual:** one real search with the rerank on. Check the logs for `rerank_completed` and the timings, and that the cards show the smart reasons.

## Decisions (2026-10-15)
1. **`RERANK_ENABLED` defaults to off** until the eval confirms the gain.
2. **The 200 s fast-pass deadline applies only when the rerank is on.** With it off, 230 s stays.

## Questions for you (answered above)
1. **Default for `RERANK_ENABLED`:** the PRD contradicts itself. §6.9 says it defaults to true; the rollout says it "ships behind `RERANK_ENABLED` and is turned on after the eval confirms the gain".
   - I recommend **off by default** until the eval runs, so merging changes nothing for users.
   - Or **on by default**, as in §6.9.
2. **Fast-pass deadline:** should I move it from 230 s to 200 s **only when the rerank is on** (recommended; with the rerank off, nothing changes), or always, as the PRD's timeline says?
