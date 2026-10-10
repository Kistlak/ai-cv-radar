# Plan: Match quality T8: CV-aware pre-rank and the `.net` boundary fix

**Status**: Completed (code), 2026-10-10. Review approved as is. No deviations from this plan. AI eval pending (after the baseline; needs Gemini quota).
**Date**: 2026-10-10
**Branch**: `feature/match-quality-t8-prerank` (new, from `master`)
**PRD**: `.agents/prd/PRD-match-quality.md` (Task 8, requirement F8). This completes `2026-10-09-scoring-pool-cap.md` and the Important item of its review.

## Task Summary
When the user picks a result count, a cheap keyword pre-rank (`preRankJobs`) chooses which jobs are sent to the AI for scoring: the best `max(4N, 30)`. Today it looks only at the search query words, so a good job with a different title ("Digital Experience Designer" for a "UX Designer" search) can be cut before the AI ever sees it. It also has a bug: a term that starts with punctuation, such as `.net`, never matches inside "ASP.NET".

This task:
1. adds the CV's skills and recent role titles as pre-rank terms,
2. fixes the word-boundary bug,
3. reads more of each description (3,000 characters instead of 1,000).

### Evidence (offline, no AI calls)
I ran the pre-rank alone over the 8 eval cases (80 good jobs). Scratch script, not committed.

| Variant | Pool 40 of 48 (the eval's N=10) | Pool 30 (N=2/5, closer to a real 250-job fetch) |
|---|---|---|
| Current (query terms only) | 74/80 good kept, 92 bad kept | 60/80 good, 66 bad |
| CV skills as whole phrases + 2 roles, 1,000 chars | 79/80, 85 bad | 59/80, 59 bad |
| **CV skills as words + 4 roles, 3,000 chars (proposed)** | **80/80, 89 bad** | **75/80, 47 bad** |

- Every good job the current pre-rank loses is a `synonym-title` trap. The proposed version keeps all of them at N=10.
- With a tighter pool it keeps 15 more good jobs and lets in 19 fewer bad ones.
- Most of the gain at pool 30 comes from the longer description window: `late-requirements` jobs put their skills after 1,000 characters.
- **Caveat:** the fixtures are synthetic and I chose between these variants on them, so this is a sanity check, not proof. The AI eval (below) is the real measure.

## Affected Files
- `lib/score-pool.ts`: CV terms, the boundary fix, the description window.
- `lib/match-pipeline.ts`: `RankContext.cvProfile`, passed through to `preRankJobs`.
- `lib/run-search.ts`: pass the CV's validated `structured` profile to `rankJobs` (one line plus one import).
- `tests/eval/matching.eval.ts`: pass `c.profile` to `rankJobs`, so the eval measures what users get.
- `tests/unit/score-pool.test.ts`, `tests/unit/match-pipeline.test.ts`: new tests.
- Docs: this plan, its review, and the PRD Task Breakdown row.

## Current Behavior to Preserve
**`preRankJobs(jobs, queries)`:**
- pure, with no AI calls; returns a new array and doesn't mutate the input;
- query words of 2+ characters, lower-cased and deduped, with the stop-word list removed;
- inner punctuation kept (`node.js`, `c#`, `c++`), and a trailing `.` or `:` dropped;
- a query term in the title scores 3, and one in the (HTML-stripped) description scores 1;
- whole-word matching ("go" doesn't match "good"), Unicode-aware;
- ties keep the input order;
- with no terms at all, the input order is returned unchanged.

**`scoringPoolSize`:** unchanged (null → null, otherwise `max(4N, 30)`).

**`rankJobs`:**
- pre-ranks and cuts only when a count is set and there are more jobs than the pool;
- "All" and small fetches score every job, in the input order;
- `onPool` is called before any scoring call;
- `scoreJobs` gets the same arguments as today;
- `top` is the top N by score, or every scored job for "All".

**`runSearch`:** no other change. Queries, fetching, cancellation, progress, the zero-jobs path, saving and error handling are untouched.

**When there's no usable CV profile** (an older CV whose `structured` fails validation, or an empty one), the pre-rank behaves as it does today, apart from the boundary fix and the 3,000-character window.

## Out of Scope
- `scoreJobs`, the scoring prompt, and the pool sizes (Tasks 3, 4 and 9).
- Always scoring the agentic jobs (a separate suggestion in the scoring-pool review).
- The stop-word list, apart from what the new terms need. I'm not changing it.
- Freshness (Task 6). Stale jobs still go through the pre-rank as today.
- Committing the offline recall script. It's easy to add later as an `EVAL_PRERANK_ONLY` mode if you want it.
- The out-of-date note in PRD §11 that the scoring-pool cap is "uncommitted". I'll flag it, not change it.

## Approach
1. **`preRankJobs(jobs, queries, cv?: CvStructured | null)`**, an optional third parameter, so existing callers keep working.
2. **CV terms**:
   - The skills, plus the role titles of the 4 most recent jobs (`experience.slice(0, 4)`, matching F4's "4 most recent roles").
   - Split into words with the same tokenizer and stop words as the queries. For example, "Accessibility (WCAG 2.1 AA)" gives `accessibility`, `wcag`, `2.1`, `aa`.
   - Any term that's already a query term is removed from the CV set, so the query weight wins.
   - Capped at `MAX_CV_TERMS = 80`, role words first and then skills in CV order. That bounds the regex work on a CV with a very long skills list (about 80 terms × about 250 jobs, well under a few milliseconds).
3. **Weights (F8):**
   - a query term in the title: 3;
   - a CV term in the title: 2;
   - any term in the description: 1.
   - Each term counts at most once per field, as today.
4. **Description window:** `DESCRIPTION_CHARS` goes from 1,000 to 3,000 (after stripping HTML).
   - This deviates from the PRD, which didn't specify a length. It comes from the evidence above: `late-requirements` jobs.
5. **Boundary fix (`termPattern`):**
   - Add the `(?<![\p{L}\p{N}])` look-behind only when the term starts with a letter or digit.
   - Add the look-ahead only when it ends with one.
   - So `.net` matches "ASP.NET" and ".NET", while "go" still doesn't match "good".
6. **`rankJobs`:** add `cvProfile?: CvStructured | null` to `RankContext` and pass it as `preRankJobs(jobs, ctx.queries, ctx.cvProfile)`.
7. **`runSearch`:** pass `cvProfile: CvStructuredSchema.safeParse(cv.structured).data ?? null`. An invalid profile falls back to query-only, so there's no new failure path.
8. **Eval runner:** pass `cvProfile: c.profile`.

## Database Changes
None. `cvs.structured` is already loaded by `runSearch`.

## API Endpoints
None.

## Edge Cases & Risks
- **Noise from CV words**, for example "basic", "native" or "english" from the languages in the skills list.
  - They count 1 in a description, or 2 in a title. The query title weight (3) still leads.
  - Measured: the number of bad jobs in the pool goes down, not up.
  - If real searches look off, a few more stop words can be added later.
- **Keyword-stuffed jobs** (a title full of CV words) can rise. The AI scoring still judges them. The pool only decides what gets scored.
- **A CV in a different language from the postings:** its terms simply don't match, and it falls back to query-driven behaviour.
- **Fixtures vs real fetches:** the eval cases have 48 jobs and a pool of 40, so the AI eval will show only a small change. In real searches about 250 jobs compete for 40 slots, which is where this matters (the pool-30 column).
- **Speed:** the longer window and extra terms are still microseconds per job.

## Testing Strategy
- **Unit (`score-pool.test.ts`):**
  - `.net` matches "ASP.NET Core Developer" and ".NET Developer";
  - "go" still doesn't match "good";
  - `c#` still works;
  - a CV skill in the title outranks one that's only in the description;
  - a query term in the title outranks a CV term in the title;
  - a CV role title term helps a synonym-title job into the pool;
  - no CV, `null`, or an empty CV gives the same order as before;
  - a term found only between characters 1,000 and 3,000 counts;
  - a term already in the query isn't double-counted from the CV;
  - the CV term cap;
  - the input isn't mutated.
- **Unit (`match-pipeline.test.ts`):** `cvProfile` reaches the pre-rank (a CV-matching job wins the last pool slot).
- **Checks** (I'll ask first): `npm run lint`, `npm run typecheck`, `npm test` and `next build`, since `run-search` is used by a route.
- **Eval:**
  - The offline recall table above goes into the review.
  - The AI eval (`EVAL_LABEL=t8`) runs once the baseline is finished. It needs Gemini quota: about 32 requests, so 2 days on the free tier. Its numbers go into the review when available.
- **Manual (optional):** a real search with a count of 10, then check `run_search.scoring_pool` and that the top results look right.
