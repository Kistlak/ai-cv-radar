# Plan: Match Quality T1 — Evaluation harness and baseline

**Status**: Completed (code), 2026-10-09. Review approved with changes. Baseline pending: Gemini free tier, run split over 2 days (see Deviations).
**Date**: 2026-10-09
**Branch**: `feature/match-quality`
**PRD**: `.agents/prd/PRD-match-quality.md` (Task 1)

## Task Summary
Build a repeatable way to measure match quality, so every later task can prove whether it helped:
- 8 synthetic CVs (different professions and countries), each with 48 synthetic jobs designed and labelled in advance;
- a runner that pushes them through the same ranking code as a real search;
- a report: how many of the top 10 are good, bad, ineligible or stale.

Then record the **baseline** on today's code.

**Why the jobs are synthetic too:** `.env.local` has no source keys (`FALLBACK_*`), so there's no way to snapshot real jobs. Synthetic jobs also have advantages:
- the labels are known by design;
- there's no personal or copyrighted data;
- each job can deliberately test a known weakness from the PRD:
  - requirements placed after a 600+ character company introduction,
  - "Remote (US only)" jobs,
  - missing licences,
  - seniority mismatches,
  - good jobs with synonym titles,
  - keyword-stuffed bad jobs,
  - old postings.

A real-job snapshot can be added later with the same fixture format (Out of Scope).

## Affected Files
**New:**
- `lib/match-pipeline.ts`: `rankJobs()`, the post-fetch ranking steps moved out of `runSearch` (pool → score → select top N).
- `tests/fixtures/match-eval/<case>/`, for each of the 8 cases:
  - `cv.txt`
  - `profile.json` (a `CvStructured` object)
  - `search.json` (`{ queries, location, remoteOnly, maxResults }`)
  - `jobs.json` (`RawJob`-shaped, except `postedDaysAgo` in place of `postedAt`, so freshness never goes stale)
  - `labels.json` (`{ [sourceJobId]: { label, why } }`)
- `tests/fixtures/match-eval/README.md`: format, label rubric, the trap types, how to add a case.
- `tests/eval/load-cases.ts`: loads and validates the fixtures with zod, and turns `postedDaysAgo` into `postedAt`.
- `tests/eval/metrics.ts`: pure metric functions.
- `tests/eval/matching.eval.ts`: the runner.
- `vitest.eval.config.mts`: runs `tests/eval/**/*.eval.ts` only, loads `.env.local`, with long timeouts.
- `tests/unit/eval-metrics.test.ts` and `tests/unit/match-pipeline.test.ts` (fake `AiClient`).
- `.agents/plans/reviews/2026-10-09-match-quality-t1-eval-harness-review.md`, at review time, with the baseline numbers.

**Modified:**
- `lib/run-search.ts`: call `rankJobs` in place of the inline pool/score/top-N code.
- `package.json`: an `"eval:matching"` script.
- `.gitignore`: `/eval-results/`.

## Current Behavior to Preserve (`runSearch`, every responsibility)
1. Loads the search and its pinned CV, filtered by user. Resolves keys and the provider, and builds the AI client.
2. Uses the user's query as given; a blank query derives 3 queries and saves the primary one.
3. Decides on the agentic path; fetches the cheap and agentic sources in parallel with the cancel signal and the agentic timeout; updates progress for each.
4. Dedupes jobs; applies the `toHttpUrl` filter and the `sourceJobId` fallback; logs dropped URLs; logs `fetch_completed`.
5. Cancel check before scoring. Zero jobs means `complete` immediately.
6. **Pool cap** (uncommitted Task 8 base): logs `run_search.scoring_pool`; the progress total is the pool size.
7. Scores with `t0 + SCORING_START_DEADLINE_MS` and the cancel signal; logs `scoring_completed` with `scored` = the number of jobs scored (before the top N).
8. Top N by `matchScore` when `maxResults` is set, otherwise all jobs.
9. Cancel check after scoring; the `persisting` progress stage; insert with `onConflictDoNothing`; final cancel check; `complete` and the log.
10. Errors: a cancel is not a failure; otherwise `failed` with `searchErrorMessage`; the status is never overwritten if cancelled; the cancel watcher is cleared; `logger.flush()`.

Only 6–8 move into `rankJobs`. The logs, progress and cancel checks stay in `runSearch` through a callback. The behaviour and log fields stay identical.

## Out of Scope
- Any change to scoring, prompts, the pre-rank logic, sources or the UI. Those are Tasks 3–9, and Task 1 must measure today's code unchanged.
- Query derivation quality. The eval uses fixed queries per case, as if derived, so runs are repeatable. Derive-query changes in Task 3 are checked by hand.
- Real-job snapshots, and an eval for the agentic path (it needs Apify and live data).
- Running the eval in CI.
- The rerank. It's added to `rankJobs` in Task 9.

## Approach
**1. `lib/match-pipeline.ts`**
```ts
export interface RankContext {
  queries: string[]          // pre-rank terms; queries[0] is the scoring "looking for"
  cvText: string
  ai: AiClient
  maxResults: number | null
  deadline?: number
  signal?: AbortSignal
  onPool?: (fetched: number, pool: number) => void | Promise<void>
}
export async function rankJobs(jobs: RawJob[], ctx: RankContext):
  Promise<{ scored: ScoredJob[]; top: ScoredJob[] }>
```
- The body is the existing code, moved verbatim: `scoringPoolSize` → `preRankJobs` + slice → `onPool` → `scoreJobs(toScore, cvText, queries[0], ai, deadline, signal)` → top N.
- `ScoredJob` is exported from `score-jobs.ts`. Today it's a local interface; this is a type-only export.

**2. `lib/run-search.ts`**
- Replace the moved lines with a `rankJobs(rawJobs, {...})` call.
- `onPool` does the existing `scoring_pool` log and `setProgress({ stage: 'scoring', totalJobs })`.
- `scoring_completed` logs `scored.length`, and the persist step uses `top`. No other lines change.

**3. Fixtures: 8 cases × 48 jobs**

| Case | CV | Search |
|---|---|---|
| `software-lk` | Mid-level PHP/Laravel backend developer, 4 years | Colombo, Sri Lanka |
| `nurse-gb` | Registered nurse (NMC), ICU, 6 years | Manchester, UK |
| `accountant-ae` | ACCA accountant, audit → financial reporting, 8 years | Dubai, UAE |
| `sales-us` | B2B SaaS account executive, 5 years | Chicago, USA |
| `teacher-au` | Primary teacher with VIT registration, 3 years | Melbourne, Australia |
| `hospitality-sg` | Hotel front office manager, 10 years | Singapore |
| `logistics-ca` | Warehouse supervisor, forklift and WHMIS certified, 7 years | Toronto, Canada |
| `designer-pt` | UX/UI designer, 4 years | Lisbon, Portugal; **remote only**. Portugal isn't recognised by `country.ts` today, which is a deliberate test for Task 5 |

Each case's 48 jobs:
- **10 good:**
  - 3 with requirements only after a 600+ character introduction;
  - 2 with synonym titles that don't contain the query words, to test the pre-rank.
- **8 ok:** adjacent role, or one soft gap.
- **18 bad:**
  - different field;
  - seniority two or more levels off;
  - a missing hard requirement (licence, registration, certification, language);
  - 4 keyword-stuffed (the query words in the title, but the wrong field or level).
- **8 ineligible:** "Remote (US/EU only)" where that excludes the candidate, on-site in another country, or a required work authorisation.
- **4 stale:** otherwise good, but posted 45–90 days ago.

Other details:
- Sources and fields mimic the real ones: a mix of `remotive`, `adzuna` and `jsearch` shapes; salary present on some; `postedDaysAgo` 0–20 for non-stale jobs.
- Companies are fictional, and descriptions are 300–2,500 characters.
- The fixtures are written by parallel subagents (one per case) from one shared spec, then checked by the zod loader. A unit test checks the counts per label and that every job has a label.
- **Labels:** `good` = 3, `ok` = 1, `bad` / `ineligible` / `stale` = 0 for nDCG. Each label has a `why` sentence. **You review the labels** (`README.md` lists the rubric). This review is the only manual step.

**4. Metrics (`tests/eval/metrics.ts`), per case and averaged**
- `good@10`, `ok@10`, `bad@10`, `ineligible@10`, `stale@10` (counts in the top 10).
- `nDCG@10`.
- `goodInPool`: how many good jobs survived the pre-rank, which shows whether the pre-rank cut good jobs.
- `meanScore` by label: does a good job score higher than a bad one (calibration)?
- `unscored` (the whole pool, and in the top 10): jobs that got the `Score unavailable` fallback.
  - **A run where unscored jobs are more than 10% of the pool is flagged as invalid** in the report, because the numbers then measure failures, not ranking quality.
  - It also matters for its own sake (see Risks).

**5. Runner (`npm run eval:matching`)**
- `vitest run --config vitest.eval.config.mts`, an optional `EVAL_CASE=<name>`, and `maxResults` 10 (pool 40 of 48, so the pre-rank is exercised).
- **AI:** `EVAL_AI_PROVIDER` (**`gemini` default**, since the owner has no Anthropic key at the moment; `anthropic` also works) with `EVAL_GEMINI_KEY` / `EVAL_ANTHROPIC_KEY`. If no key is set, it skips with a clear message. The model overrides (`GEMINI_FAST_MODEL`, `ANTHROPIC_FAST_MODEL` etc.) apply as in the app. The report header shows the provider and model.
- **Free-tier rate limits (Gemini):**
  - Cases run one after another, with `EVAL_CASE_DELAY_MS` (default 20 s with Gemini, 0 with Anthropic) between them. A case is 4 batches at the app's concurrency of 3, which stays under the free tier's per-minute limit.
  - A full run is about 32 calls, well within the free daily quota.
- **Output:** a console table, plus `eval-results/<ISO timestamp>-<label>.json` (git-ignored) with each case's top 10, scores, reasons and labels. A `EVAL_LABEL` env var tags runs ("baseline", "t3-prompts", …).
- **Cost of a run:** 8 cases × 4 batches. Free on a Gemini free-tier key; about $0.05 on Anthropic Haiku.

**6. Baseline**
- After implementation and your OK, run it once with `EVAL_LABEL=baseline` on today's pipeline.
- Copy the summary into the review document and the PRD's §11 context.

## Database Changes
None.

## API Endpoints
None.

## Edge Cases & Risks
- **Synthetic jobs are cleaner than real ones** (no HTML noise, consistent fields). Some descriptions will include basic HTML and messy formatting on purpose. Real-job snapshots are the follow-up to cover the rest.
- **The labeller's bias.** Claude writes and labels the jobs, and Claude models score them. Mitigations:
  - labels come from the design spec (the intended trait), not from a model's judgment of the text;
  - you review them.
- **Gemini 2.5 Flash may truncate scoring output (to confirm with the baseline, not assumed).**
  - Flash is a "thinking" model, and its thinking tokens count toward `maxOutputTokens`. `scoreBatch` sets 1,500 and doesn't ask for JSON mode.
  - If thinking uses most of that budget, the JSON array is cut off, `parseScores` throws, and the whole batch gets the fallback score of 30.
  - That would mean Gemini users get many fake scores today. The `unscored` metric will show it.
  - **If confirmed:** follow the bug protocol (a failing test first, then a minimal fix such as a thinking budget or a higher `maxTokens` for Gemini), in its own small task, before Task 3. This plan doesn't change it, so the baseline shows today's real behaviour.
- **Cost:** with a free-tier Gemini key, a run costs nothing (paid tier: well under $0.01).
- **AI variation between runs.** Report averages across all 8 cases. For close calls, run twice and compare. Scoring uses the provider's default temperature (no change).
- **The refactor changes behaviour by accident.** The moved code is verbatim. Unit test `rankJobs` with a fake `AiClient`:
  - the pool applies only when there are more jobs than the pool size;
  - `onPool` is called with (fetched, pool);
  - top N vs all;
  - deadline and signal are passed through.
  The full `npm test` must still pass.
- **Fixture size:** about 8 × 48 × 1.2 KB ≈ 500 KB of JSON. Acceptable in the repo, and kept out of the app bundle (only under `tests/`).
- **An eval key in `.env.local`** is git-ignored. Never log keys.

## Testing Strategy
- **Unit tests:**
  - `eval-metrics`: counts, nDCG on hand-computed examples, an empty top 10.
  - `match-pipeline`: the cases listed above.
  - A fixture-integrity test, run as part of `npm test`: all 8 cases load, there are 48 jobs, the label counts match the spec, every job is labelled, and the ids are unique.
- **Full checks** (batched at the end, as you asked): `npm run lint`, `npm run typecheck`, `npm test`, `next build`.
- **Eval:** one baseline run with `EVAL_GEMINI_KEY` (I'll ask first; free tier).

## Deviations (2026-10-09)
- **The owner stays on the Gemini free tier** (20 requests per day per model per project; a full run is about 32). The runner now supports:
  - `EVAL_CASES=a,b,c,d`: run part of the set. 4 cases is about 16 requests.
  - `EVAL_COMBINE=<label>`: no AI calls. Merges every results file with that label (latest per case) into `<label>-combined`, and refuses to mix models.
- **A full measurement is spread over 2 days:**
  - day 1: `accountant-ae,designer-pt,hospitality-sg,logistics-ca`
  - day 2: `nurse-gb,sales-us,software-lk,teacher-au`
  - then combine.
- **Results are also written as `.txt`,** since vitest hides console output in this environment.
- **The Gemini default model changed to `gemini-3.8-flash` with low thinking** (bug found by the first run; shipped in PR #14).
