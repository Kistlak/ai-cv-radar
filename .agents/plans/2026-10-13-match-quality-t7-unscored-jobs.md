# Plan: Match quality T7: unscored jobs are stored as "Not scored", never as matches

**Status**: Completed (code), 2026-10-13. Review approved: "fix all". Old rows left as they are (question 1). Branched from `origin/master`; local `master` untouched (question 2). Manual check with a real key pending.
**Date**: 2026-10-13
**Branch**: `feature/match-quality-t7-unscored` (new, from the rewritten `origin/master`)
**PRD**: `.agents/prd/PRD-match-quality.md` (Task 7, requirement F7, goal G5, design §6.7)

## Task Summary
When the AI doesn't score a job, it currently gets a made-up score of **30**:
- with the reason "Score unavailable" when its batch failed, timed out or started after the deadline;
- with the reason `''` when the model's reply skipped that job's index.

These jobs are stored, ranked and shown like real scores. In a small or weak result set, they can even fill the top N.

After this task:
- An unscored job is stored with `match_score = NULL` and the reason **"Not scored"**.
- The top-N selection takes scored jobs first (best score first), and unscored jobs only fill the slots that are left.
- The results page shows **"–"** with a "Not scored" tooltip in the score badge and lists these jobs last.

## Affected Files
- `lib/score-jobs.ts`:
  - `ScoredJob.matchScore` becomes `number | null`;
  - `unavailable()` and the "skipped index" case produce `null` with the reason `'Not scored'`;
  - comments that mention the fallback of 30.
- `lib/match-pipeline.ts`: new exported pure `selectTop(jobs, maxResults)`, used for `top`.
- `app/(app)/search/[id]/page.tsx`:
  - ORDER BY becomes `match_score DESC NULLS LAST`;
  - `JobCard` shows "–" with `title="Not scored"` and the muted style when `matchScore` is null.
- `tests/eval/metrics.ts`: `isUnscored` checks `matchScore === null`, and `meanScoreByLabel` skips nulls.
- `tests/eval/matching.eval.ts`: only type changes, if any; the eval logic stays the same.
- Tests:
  - `tests/unit/score-jobs.test.ts`: fallback expectations go from `30` / `'Score unavailable'` / `''` to `null` / `'Not scored'`;
  - `tests/unit/match-pipeline.test.ts`: the deadline test (expects 30), plus new `selectTop` tests;
  - `tests/unit/eval-metrics.test.ts`: `isUnscored` and `meanScoreByLabel` with nulls.
- Docs: this plan, its review, and the PRD row.

No DB migration: `job_results.match_score` is already nullable (`db/schema.ts:106`).

## Current Behavior to Preserve
**`scoreJobs`:**
- batching (10), concurrency (3), the 45 s timeout per batch, `maxTokens: 1500`;
- the deadline and cancel-signal handling: no model call after either, and those jobs come back unscored;
- output order matches input order, one result per input job;
- the zod validation and clamping (0–100) of real scores;
- the `score_jobs.batch_failed` log.

**`rankJobs`:** pre-rank and pool size, `onPool`, the CV profile and candidate context, and `scored` containing every job sent to scoring.

**"All" (`maxResults` null):** every scored job is still stored. Only their order in the array changes (sorted), and the page orders by score anyway.

**Results page:**
- the score colours for real scores (≥75 green, ≥50 amber, otherwise muted);
- the reason line, apply link, badges, feedback thumbs (unscored jobs can still get feedback);
- jobs from searches that aren't complete are not loaded.

**`run-search.ts`:** inserts `job.matchScore` as is. A null is valid for the column, so no change is needed there.

**Feedback API:** returns `matchScore`, which is already `number | null` from the DB type.

## Out of Scope
- **Existing rows** stored with 30 and "Score unavailable". They are not backfilled (that would be a write to the hosted DB) and still show as 30. See question 1 below.
- Logging an `unscored` count in `run_search.scoring_completed`. It's useful, but not in the PRD for this task.
- Retrying failed batches, or changing the timeouts or deadlines (Task 9 rebalances the time budget).
- The deep-dive, cover letter and tailored-CV features, which don't use the score.
- Changing the `job_results_search_score_idx` index. Each search has at most a few hundred rows, so the sort cost is negligible.

## Approach
1. **`lib/score-jobs.ts`:**
   - `export interface ScoredJob extends RawJob { matchScore: number | null; matchReason: string }`.
   - Add `const NOT_SCORED = 'Not scored'`.
   - `unavailable(batch)` returns no results (an empty array), so every job in that batch falls to the "no result" path below. That keeps a single source for the unscored value.
   - When the results are assembled: `matchScore: result?.score ?? null`, `matchReason: result ? result.reason : NOT_SCORED`.
   - A real score with an empty reason stays scored, with an empty reason, as today.
   - Update the comments about "the fallback score" and "30".
2. **`selectTop(jobs, maxResults)`** in `lib/match-pipeline.ts`:
   - It's pure and doesn't mutate its input.
   - Scored jobs are sorted by score, highest first. The sort is stable, so ties keep their input order.
   - Unscored jobs follow, in input order.
   - The list is cut to `maxResults`; `null` means no cut.
   - `rankJobs` uses `top = selectTop(scored, ctx.maxResults)`.
3. **Results page:**
   - `.orderBy(sql\`${jobResults.matchScore} desc nulls last\`)`. Postgres sorts `DESC` with NULLs **first** by default, so this is needed.
   - `JobCard` gets `const score = job.matchScore` (no `?? 0`).
   - If `score` is null: the badge shows "–", uses the muted style, and has `title="Not scored"` and `aria-label="Not scored"`.
   - Otherwise it shows today's colours and number.
   - The reason line already shows "Not scored" from `matchReason`.
4. **Eval:**
   - `isUnscored(job)` returns `job.matchScore === null`. Its signature takes `{ matchScore: number | null }`.
   - `meanScoreByLabel` ignores null scores. A label with only nulls is left out.
   - This also fixes a small eval inaccuracy: a real score with an empty reason no longer counts as unscored.
5. **Tests** (below), then lint, typecheck, `npm test` and `next build`. That needs your go-ahead, per the usual rule.

## Database Changes
None. `match_score` is already nullable, and the reason is free text.

## API Endpoints
No new or changed routes. `PATCH /api/jobs/[id]/feedback` can already return `matchScore: null`.

## Edge Cases & Risks
| Case | Handling |
|---|---|
| Every batch fails | Every job is "Not scored"; the top N holds them in pre-rank order. The search still completes, as today |
| The model skips one index | That job is "Not scored" instead of 30 |
| Score 0 | Still a real score, kept as a number. The `?? null` and `result ?` checks don't treat 0 as missing |
| Mixed scored and unscored, more scored than N | No unscored job appears in the top N |
| Old rows with 30 and "Score unavailable" | Unchanged; still shown as 30 (question 1) |
| Ties between scores | A stable sort keeps the input order (the pre-rank order) |
| Something else reading `matchScore` as a number | `tsc` will flag every use once the type becomes `number | null`. Today only the page and the eval do |

## Testing Strategy
**Unit tests:**
- `scoreJobs`:
  - a failed batch, a batch after the deadline, and a cancelled search give `null` / `'Not scored'`;
  - a skipped index gives `null` / `'Not scored'`;
  - a score of 0 stays 0.
- `selectTop`:
  - scored jobs come first, by score descending;
  - unscored jobs fill only the remaining slots;
  - `null` keeps every job;
  - ties keep the input order;
  - the input array isn't mutated;
  - all-unscored input keeps the input order.
- `rankJobs`: `top` never contains an unscored job when there are enough scored ones. Update the deadline test, which expects 30.
- Eval metrics: `isUnscored` uses null, and `meanScoreByLabel` skips nulls.

**Checks:** lint, `tsc`, `npm test` and `next build` (the page changes).

**Manual check** (needs a real key): a search where scoring is cut short shows "–" with the tooltip, and those jobs come last. To force this, a tiny deadline or an invalid key in a local run will do.

**Eval:** no change to scores is expected. The `unscored` column now counts real nulls. It runs with the other pending evals when Gemini quota allows.

## Deviations
- **"All" results are sorted.** The existing test `returns every scored job for "All"` expected `top` to be the same array as `scored`. It now expects the same jobs, best first. The page already ordered by score, so users see no change.
- **Review fixes ("fix all"):**
  - The unscored badge renders `<span aria-hidden>–</span>` plus a `sr-only` "Not scored" (instead of `aria-label` on a `<div>`).
  - `selectTop` uses a type guard, so the `?? 0` is gone.
  - **`lib/run-search.ts`** (not in the original Affected Files): the `run_search.scoring_completed` log gains an `unscored` count.
- **Checks:** lint (0 errors; 1 old warning in `components/search-form.tsx`), `tsc`, `npm test` 272/272, and `next build` all pass.

## Open questions (answered)
1. **Old rows:** leave the existing 30 / "Score unavailable" rows as they are (recommended; they age out), or add a one-off migration that sets them to NULL / "Not scored"? The migration writes to the hosted DB, so it needs your approval to apply.
2. **Before I start:** your local `master` still has the pre-rewrite history. I'll create the branch from `origin/master`, the rewritten one. Please run `git fetch origin && git reset --hard origin/master` first, or tell me to branch straight from `origin/master` and leave local `master` as it is.
