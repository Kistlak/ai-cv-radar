# PRD: Match Quality (a CV in, the right jobs out, for any profession, worldwide)

**Status**: Approved (2026-10-09). The owner chose "go with your recommendations, write synthetic CVs". Decisions are listed below.
**Date**: 2026-10-09
**Owner**: Kistlak
**Goal (owner's words)**: "Whenever someone gives a CV, we should give them back the jobs which match their CV. Proper ones. The user should be happy with them."
**Audience (decided 2026-10-09)**: any profession, users worldwide.
**Related**:
- `.agents/plans/2026-10-09-scoring-pool-cap.md` and its review. That change is folded into Task 8 here.
- `PRD-job-alerts.md` is on hold. Alerts only add value once matches are good.

---

## 1. Overview
A user uploads a CV and runs a search. The app then:
1. derives up to 3 queries from the CV,
2. fetches jobs from up to 6 sources,
3. scores them in batches of 10 with the fast model (Haiku 4.5 / Gemini Flash),
4. shows them sorted by score.

The pipeline works, but several parts of it work against match quality. The biggest ones:
- The AI sees only the first 500 characters of each job.
- The scoring rules are written for software developers.
- Location eligibility is ignored, and country support is patchy.
- Old jobs aren't filtered out.
- Nothing measures whether matches are good.

This PRD fixes those in four phases:
1. **Measure.** A labelled evaluation set and user thumbs feedback, so every change can be proven to help.
2. **Quick wins.** Neutral prompts for any profession, the requirements text, location, freshness, unscored jobs, and a CV-aware pre-rank.
3. **Rerank.** The smart model re-checks the top candidates with full detail.
4. **Later.** Learning from feedback, embeddings, regional job boards. These are listed but not in scope.

## 2. Problem & Goals
**Problems (with evidence):**
1. **The AI judges jobs from a snippet.**
   - `lib/score-jobs.ts` `buildPrompt` sends `description.slice(0, 500)`. The first 500 characters are usually the company introduction; requirements and qualifications come later.
   - The CV is cut at 3,500 characters.
2. **The prompts are written for developers.**
   - The scoring rules say "If the job's PRIMARY required language/framework is NOT in the candidate's CV, score must be 0–19" and talk about "tech stack" throughout.
   - `lib/derive-query.ts` gives Laravel examples and falls back to `'Software Engineer'`.
   - The agentic prompt rejects results by "wrong stack".
   - For a nurse, accountant or teacher, these rules are meaningless or harmful.
3. **Location is ignored, and country support is patchy.**
   - The scoring prompt never sees the candidate's location. So "Remote (USA only)" from Remotive, or an on-site job in another country, can score 90.
   - `lib/job-sources/country.ts` recognises 21 countries by regex.
   - A blank location falls back to Adzuna `gb` and Indeed `us`. For a worldwide audience, a blank location means UK/US jobs.
   - The CV's own `structured.location` is never used.
4. **Old postings.** No date filter is sent to Adzuna or JSearch, and nothing is dropped by `postedAt`. Users get expired jobs and dead links.
5. **Unscored jobs look like matches.**
   - Failed, timed-out or late batches get `score: 30, reason: 'Score unavailable'`.
   - These are stored and ranked next to real scores, and can even fill the top N slots.
6. **The jobs users actually read get the cheapest check.** Every job is scored once by the fast model in a batch of 10, and the top 10 the user reads get no closer look.
7. **The pre-rank ignores the CV.** The new scoring-pool pre-rank (`lib/score-pool.ts`) ranks by query words only, and has a word-boundary bug with terms like `.net`.
8. **Nothing measures quality.** There's no evaluation set and no user feedback, so we can't tell whether a change helps.

**Goals:**
- G1. **Measurable quality.** We get a repeatable score for "how good are the top 10", per profession and region. A baseline is recorded before any change.
- G2. **Works for any profession.** No step assumes software. Requirements such as licences, certifications, years, languages and specialisms are judged generically.
- G3. **Jobs the user can actually take.** The top results respect the candidate's location: on-site or hybrid in their area, or remote that's open to their country. Regional remote restrictions are respected.
- G4. **Fresh.** Postings older than the freshness window (Q4, proposed 30 days) are excluded when the source gives a date.
- G5. **Honest scores.** Unscored jobs are never shown as matches, and the top N contains only scored jobs.
- G6. **Accurate top results.** The top candidates are re-checked by the smart model with full job detail.
- G7. **Users can tell us.** Thumbs up/down with a reason on every job, stored for analysis and later learning.

**Targets** (on the evaluation set, compared with the baseline):
- At least 7 of the top 10 labelled "good" on average across professions.
- At most 1 "bad" job in the top 10.
- 0 location-ineligible jobs in the top 10.

**After launch:** at least 70% thumbs-up rate on rated jobs.

## 3. Users & Impact
- **Job seekers of any profession, anywhere:**
  - Relevant, current, eligible jobs.
  - Scores they can trust, with reasons that cite their actual requirements.
  - The search location is prefilled from their CV.
- **Operator (Kistlak):**
  - Quality becomes measurable.
  - A small cost increase per search from the rerank (§6.9, Q2), offset by the scoring-pool cap (about 85% fewer fast-model scoring calls at the default count of 10).
- **UX changes:**
  - Thumbs up/down on each job card.
  - "Not scored" shown instead of a fake 30.
  - "Posted N days ago" on cards.
  - Location prefilled on the search form.
  - No flows are removed.

## 4. Scope
**In scope:** Tasks 1–9 (§10).

**Out of scope (Phase 4, later PRDs):**
- Using thumbs feedback in scoring (personalisation).
- Embedding-based retrieval and ranking.
- New or regional job sources (for example Bayt/GulfTalent for the Gulf, topjobs.lk, Naukri, SEEK).
- Salary normalisation.
- Changing the deep-dive, cover letter and tailored CV prompts for non-tech professions. Worth checking next; noted in §8.
- Job alerts (on hold).

## 5. Requirements
**Functional**
- F1. **Evaluation set and runner.**
  - A labelled set of anonymised CVs, each paired with a frozen snapshot of fetched jobs, each job labelled `good` / `ok` / `bad` / `ineligible`.
  - `npm run eval:matching` scores them through the real pipeline (pre-rank → score → rerank) with a real key.
  - It reports per-CV and overall: good@10, bad@10, ineligible@10 and nDCG@10.
  - It never runs in CI.
- F2. **Feedback.**
  - Each job card has thumbs up/down. A thumbs down asks for an optional reason: `wrong_field`, `wrong_level`, `wrong_location`, `missing_requirement`, `expired`, `other`.
  - Clicking again clears the vote.
  - Votes are stored on `job_results` and are the user's own (`requireUser` + ownership).
- F3. **Neutral prompts.**
  - Scoring, query derivation and the agentic search prompt contain no profession-specific rules or examples.
  - Scoring judges these generically:
    - core skills and duties,
    - hard requirements (licences, registrations, certifications, degrees, years, languages),
    - field or industry,
    - seniority,
    - location eligibility.
  - A missing hard requirement caps the score at 30.
- F4. **Requirements text.**
  - Scoring gets up to 1,500 characters per job, chosen by `relevantJobText()`:
    - HTML stripped and whitespace collapsed;
    - sections under requirement-style headings first (requirements, qualifications, what you'll need, responsibilities, skills, experience, and common equivalents in a few major languages);
    - then the start of the description.
  - The CV is passed as a compact profile (`structured`: location, summary, skills, the 4 most recent roles with periods, education) plus the raw text, up to 6,000 characters total.
- F5. **Location.**
  - `matchCountry` recognises every ISO country by its English name, generated with `Intl.DisplayNames` (no dependency), plus common aliases and a curated list of major cities.
  - The search form prefills Location from `cvs.structured.location` when there is one. The user can edit or clear it.
  - The scoring prompt gets the candidate's location and the remote-only flag, with the rule: a job the candidate isn't eligible for (on-site elsewhere, or remote limited to other regions) scores at most 20, and the reason says why.
- F6. **Freshness.**
  - Ask the sources for recent jobs where they support it: Adzuna `max_days_old`, JSearch `date_posted=month`, and the Apify actors' date input where it exists.
  - After fetching, drop jobs whose `postedAt` is older than `JOB_MAX_AGE_DAYS` (default 30). Keep jobs with no date.
  - Cards show "Posted N days ago".
- F7. **Unscored jobs.**
  - A job the model didn't score is stored with `match_score = NULL` and the reason "Not scored".
  - The top-N selection takes scored jobs first.
  - The UI shows "–" with a "Not scored" label and sorts these jobs last.
- F8. **CV-aware pre-rank.**
  - `preRankJobs` also uses the CV's skills and recent role titles as terms. Query terms in the title score 3, CV terms in the title score 2, and any term in the description scores 1.
  - Fix the word-boundary bug: apply the boundary only on sides where the term starts or ends with a letter or digit.
- F9. **Rerank.**
  - After the fast pass, the top `RERANK_TOP_K` jobs (default `min(20, max(2N, 10))`; 20 for "All") are re-scored by the smart tier.
  - Each job gets up to 3,000 characters of relevant text, the full CV profile, and the same neutral rubric. Batches of 5 run in parallel.
  - The smart score replaces the fast score for those jobs.
  - The rerank only runs if it can start before its deadline (§6.8). Otherwise the fast scores stand.
  - It can be turned off with `RERANK_ENABLED=false`.

**Non-functional**
- N1. A search still finishes inside the route's 300 s `maxDuration` (§6.8).
- N2. Job text stays untrusted: `untrusted()` and `<job_posting>` tags everywhere, including the rerank. Model output is validated with zod (the existing `parseScores`).
- N3. Each task changes quality measurably or not at all. The eval report is attached to each task's review, before and after.
- N4. No breaking API changes. The feedback endpoint and columns are additive.
- N5. Unit tests cover all new pure logic (text extraction, country matching, freshness filter, pre-rank, selection with unscored jobs). Lint, `tsc`, `npm test` and `next build` pass.

## 6. Technical Design

**6.1 Evaluation harness (Task 1)**
- **Fixtures** in `tests/fixtures/match-eval/<case>/`:
  - `cv.txt`, anonymised, with names, emails and phones replaced;
  - `profile.json`, the `structured` output;
  - `search.json` (query, location, remoteOnly);
  - `jobs.json`, a frozen `RawJob[]`, 40–80 jobs fetched once from the real sources;
  - `labels.json` (`sourceJobId → good|ok|bad|ineligible`).
  - Fixtures are committed only when they contain no real personal data (Q1).
- **Case mix:** at least 8, covering different professions (for example software, nursing, accounting, sales, teaching, hospitality, logistics or trades, design) and regions (for example LK, AE, GB, US, IN, remote-only).
- **`scripts/eval-matching.ts`**, run as `npm run eval:matching -- [--case x] [--no-rerank]`:
  - Builds an `AiClient` from `EVAL_ANTHROPIC_KEY` or `EVAL_GEMINI_KEY`.
  - Runs the same functions as `runSearch` from pre-rank onwards (pre-rank → `scoreJobs` → rerank → select top N) on the frozen jobs, so the results are repeatable and no source API is called.
  - Prints a table and writes `eval-results/<timestamp>.json` (git-ignored).
- **Refactor needed:** move the post-fetch steps of `runSearch` (validate URLs → freshness → pool → score → rerank → select) into `lib/match-pipeline.ts` as `rankJobs(rawJobs, ctx)`, and call it from both `runSearch` and the eval. `runSearch` keeps its DB, progress and cancel handling. All its current responsibilities are listed in each task plan.
- **Labelling:** I draft labels with the smart model and a fixed rubric, then the owner reviews them (Q1). Labels are the ground truth; the model draft only saves time.

**6.2 Feedback (Task 2)**
- **Migration:** add to `job_results`:
  - `feedback smallint CHECK (feedback IN (-1, 1))`,
  - `feedback_reason text CHECK (...)` with the reasons in F2,
  - `feedback_at timestamptz`.
- **`PATCH /api/jobs/[id]/feedback`** takes `{ feedback: 1 | -1 | null, reason? }`.
  - Ownership goes through the job's search's `user_id`, as the other `/api/jobs/[id]/*` routes do.
  - zod-validated.
  - Logs `job_feedback.set`.
- **UI:** thumbs buttons on `JobCard` (a small client component). A thumbs down opens a compact reason picker.
- **Analysis:** a documented SQL query in the plan (thumbs-up rate overall, by source and by score band). There's no admin UI in v1.

**6.3 Neutral prompts (Task 3)**
- **Scoring rubric** in `buildPrompt`, generic for any field:
  - 90–100: same field and role type; meets all hard requirements; seniority fits; eligible by location.
  - 70–89: strong fit with minor gaps.
  - 50–69: same field with real gaps.
  - 20–49: related field, or a major gap.
  - 0–19: different field, or a fundamentally different role.
- **Caps:**
  - A missing hard requirement (licence, registration, certification, degree, years, required language) caps the score at 30.
  - Location-ineligible caps it at 20.
  - Seniority off by two or more levels caps it at 40.
- **Reason:** must name the specific matching or missing requirement.
- **Examples:** span professions. No profession-specific rules.
- **`derive-query.ts`:** neutral examples. The fallback becomes the CV's most recent role title (`structured.experience[0].role`), then `'jobs'`, never `'Software Engineer'`.
  - Queries should reflect the profession's own job-title vocabulary and the CV's seniority.
- **`agentic-search.ts`:** "wrong stack" becomes "wrong field, missing core requirements". No other change to the agent flow.

**6.4 Requirements text and CV profile (Task 4)**
- **`lib/job-text.ts` `relevantJobText(description, maxChars)`:** a pure function that:
  1. strips HTML and collapses whitespace;
  2. splits into sections by heading-like lines (short lines, colon-ended lines, or lines matching a heading list: requirements, qualifications, skills, experience, responsibilities, what you'll need/bring, must have, about you, plus de/fr/es/pt/nl/ar equivalents);
  3. outputs the requirement-style sections first, then the rest, cut to `maxChars`.
- **`lib/cv-profile.ts` `cvProfileText(cv)`:** builds the compact profile from `cv.structured` (validated with `CvStructuredSchema`), then appends raw text up to the 6,000-character total. If the structured CV is invalid, it uses the raw text only.
- **`scoreJobs`:** takes the profile instead of slicing `cvText`. `BATCH_SIZE` goes from 10 to 8 to keep the prompt size steady (about 8 × 1.5 k characters). `maxTokens` stays the same.

**6.5 Location (Task 5)**
- **`country.ts`:** keep `COUNTRY_PATTERNS` as overrides for cities and aliases (extended with major cities for about 40 more countries). Add a full name→code map built once from `Intl.DisplayNames(['en'], { type: 'region' })` over the ISO alpha-2 list, matched on word boundaries.
  - `guessCountry` and `adzunaCountry` keep their current fallbacks.
- **Search page:** `SearchForm` gets `defaultLocation` from `getActiveCv(user).structured.location` and prefills it. The user can still clear it (Q3).
- **Scoring:** the prompt gets `CANDIDATE LOCATION: <search location || CV location || unknown>` and `REMOTE ONLY: yes/no`, plus the eligibility rule from §6.3. Remotive's `candidate_required_location` is already in `job.location`, so the model sees "USA Only" and similar.

**6.6 Freshness (Task 6)**
- Adzuna `max_days_old=JOB_MAX_AGE_DAYS`. JSearch `date_posted` is `month` when the limit is at least 30 days, otherwise `week`.
- Apify: the LinkedIn, Indeed and Glassdoor actor inputs get their date filter where the actor's input schema supports one. Each is checked against the actor's schema in the plan; if not supported, the filter isn't applied.
- **`lib/freshness.ts` `isFresh(job, now, maxDays)`:** keeps jobs with a null `postedAt`. Applied in `rankJobs` before the pool.
- **Card:** "Posted N days ago" when `postedAt` is set.

**6.7 Unscored jobs and selection (Task 7)**
- `scoreJobs` returns `matchScore: number | null`. `unavailable()` yields `null` with the reason "Not scored". The DB column is already nullable.
- **`selectTop(jobs, maxResults)`:** scored jobs sorted by score descending, then unscored jobs, then cut to N. Pure and tested.
- **UI:**
  - The score badge shows "–" with a "Not scored" tooltip.
  - The search page query's ORDER BY becomes `match_score DESC NULLS LAST`.
  - The dashboard and any other score display are checked for null handling.

**6.8 Time budget (Task 9)**
Current timeline: agentic up to 210 s, then scoring batches start by 230 s with a 45 s cap each, ending by about 275 s. With the pool cap, the fast pass is 30–200 jobs instead of about 250. The rerank adds about 20 jobs in 4 parallel batches of 5, roughly 15–30 s on Sonnet.

New deadlines (from `t0`):
- Fast-pass batches start by **200 s**, with a 40 s cap each, so the fast pass ends by 240 s.
- The rerank starts only if `now < 245 s`, with a 30 s cap per batch, so it ends by 275 s.
- Persisting the results by 300 s is unchanged.

When the agentic path runs long, the rerank is simply skipped and the fast scores stand. The rerank never makes a search fail. This is logged as `run_search.rerank_skipped`.

**6.9 Rerank (Task 9)**
- **`lib/rerank.ts` `rerankTop(jobs, profile, ctx, ai, deadline, signal)`:** the same prompt builder as the fast pass, in "detailed" mode (3,000 characters of job text), on the `smart` tier.
  - Returns the jobs with replaced scores and reasons.
  - If a batch fails, those jobs keep their fast scores.
- **Cost** (Anthropic Sonnet 4.6 at current list prices): about 20 jobs × about 1.5 k input tokens plus the CV profile per batch. That's roughly 40–50 k input and 2 k output tokens per search, around $0.15. Gemini Flash costs a fraction of that.
  - On fallback keys, it's covered by the same search quota (no new quota).
  - The model for the smart tier is decided with the eval: current `claude-sonnet-4-6` vs `claude-sonnet-5` (Q5).
- **Config:** `RERANK_ENABLED` (default true) and `RERANK_TOP_K` (optional override).

## 7. Data & Migrations
| Migration | Task | Contents | Risk |
|---|---|---|---|
| `20261012_job_results_feedback.sql` | 2 | `feedback`, `feedback_reason` (CHECK), `feedback_at` on `job_results` | Low: nullable columns, no backfill |

No other schema changes. `match_score` is already nullable. Applied to the hosted DB only with your approval; `db/schema.ts` is kept in sync.

## 8. Security, Risks & Mitigations
| Risk | Mitigation |
|---|---|
| Changes make quality worse without anyone noticing | The eval runs before and after each task; the numbers go in the review. A task that lowers good@10 is reworked or dropped |
| Prompt injection through longer job text (1.5–3 k characters) | `untrusted()` plus `<job_posting>` tags and the existing rule. Scores are validated with zod and clamped 0–100. The rerank uses the same safeguards |
| The eval set has real personal data | Anonymise before committing, or keep fixtures local and git-ignored (Q1) |
| A generic rubric scores worse for developers than the current tuned one | The eval set includes software cases. Compare before and after; developer examples stay as one of several |
| The location rule is too strict (for example a relocation-friendly candidate) | Only *ineligible* jobs are capped (restricted to other regions, or on-site elsewhere with no relocation mentioned). The user can clear the location to widen the search |
| Freshness filter removes good jobs | Undated jobs are kept, the window is configurable, and the eval checks the drop rate |
| The rerank pushes the search over 300 s | Strict start deadlines with per-batch caps; skipped, never fatal (§6.8) |
| Rerank cost on fallback keys | Bounded to top K of 20 or fewer, within the existing search quota. Can be turned off |
| Feedback endpoint abused across users | Ownership check through `searches.user_id`, `requireUser`, zod, and a cross-user integration test |
| Deep-dive, cover letter and tailored CV prompts are still tech-flavoured for other professions | Out of scope. Flagged as the next check after this PRD |

## 9. Testing & Rollout
- **Unit tests:**
  - `relevantJobText`: section ordering, HTML, a non-English heading, the cut length.
  - `cvProfileText`: valid and invalid structured CV.
  - `matchCountry`: every-country names, aliases, cities, no false positives such as "Georgia" the US state (documented as a known ambiguity).
  - `isFresh`.
  - `preRankJobs` with CV terms, plus the `.net` and "ASP.NET" case.
  - `selectTop` with unscored jobs.
  - The rerank merge, including fallback on batch failure.
  - Updated `buildPrompt` assertions (no profession-specific rules; location line present).
  - Feedback zod schema.
- **Integration tests:** cross-user feedback PATCH.
- **Eval:** the baseline is recorded in Task 1 before any other change. Then before and after for Tasks 3–9, attached to each review.
- **Manual checks:** real searches for 3 profiles (one tech, two non-tech) in different countries with real keys; thumbs up/down; "Not scored" display; the location prefill.
- **Rollout:**
  - One task per commit or PR, in the §10 order.
  - Task 1 first, so everything after it is measured.
  - The rerank ships behind `RERANK_ENABLED` and is turned on after the eval confirms the gain.

## 10. Task Breakdown
| # | Task | Branch | Size | Depends on | Plan | Status |
|---|---|---|---|---|---|---|
| 1 | Eval harness: fixtures format, `rankJobs` extraction (`lib/match-pipeline.ts`), `eval:matching` script, baseline report | `feature/match-quality` | M–L | – | `2026-10-09-match-quality-t1-eval-harness.md` | Completed (code); baseline pending |
| 2 | Feedback: migration, PATCH endpoint, thumbs + reason UI, analysis SQL | `feature/match-quality` | M | – | `2026-10-10-match-quality-t2-feedback.md` | Completed (migration applied 2026-10-10) |
| 3 | Neutral prompts: scoring rubric, derive-query, agentic wording | `feature/match-quality` | M | 1 | – | Not Started |
| 4 | Requirements text + CV profile: `relevantJobText`, `cvProfileText`, batch size | `feature/match-quality` | M | 1 | – | Not Started |
| 5 | Location: every-country matching, CV location prefill, eligibility in scoring | `feature/match-quality` | M | 3 | – | Not Started |
| 6 | Freshness: source date params, `isFresh` filter, "posted N days ago" | `feature/match-quality` | S–M | 1 | – | Not Started |
| 7 | Unscored jobs: null scores, `selectTop`, UI and ordering | `feature/match-quality` | S–M | 1 | – | Not Started |
| 8 | Pre-rank: CV terms + boundary fix (completes `2026-10-09-scoring-pool-cap`) | `feature/match-quality-t8-prerank` | S | 1 | `2026-10-09-scoring-pool-cap.md` (base), `2026-10-10-match-quality-t8-prerank-cv-terms.md` | Completed (code), 2026-10-10; AI eval pending |
| 9 | Rerank: `rerankTop`, time-budget rebalance, `RERANK_*` env, model comparison | `feature/match-quality` | M | 3, 4, 7 | – | Not Started |

Each task gets its own plan in `.agents/plans/` and review in `.agents/plans/reviews/`. Each review includes the eval before and after.

## 11. Handover Notes
_No handovers yet._

**Findings during Task 1 (2026-10-09):**
- **Gemini was broken for new keys.** `gemini-2.5-flash` returns 404 ("no longer available to new users"). On `gemini-3.8-flash`, default thinking used up `maxOutputTokens`.
  - Fixed on this branch: `gemini-3.8-flash` plus `thinkingLevel: LOW`, and a `score_jobs.batch_failed` log.
  - This affected every Gemini feature in production. It shipped separately as PR #14 (`fix/gemini-model-and-thinking`, merged to `master` on 2026-10-09).
- **The Gemini free tier allows 20 requests per day per model.** That's too few for a full eval run (about 32 requests), or for an "All" search. The baseline needs a paid-tier key, or runs spread over several days.
- Details: `.agents/plans/reviews/2026-10-09-match-quality-t1-eval-harness-review.md`.

**Context for whoever picks this up:**
- The scoring-pool cap (`lib/score-pool.ts`, `lib/run-search.ts`) is implemented on `fix/hardening-and-cleanup` but uncommitted, and lint, tests and build haven't been run on it yet. The owner asked to run all checks at the end. Its review's Important item (the `.net` boundary bug) is part of Task 8.

---

## Decisions (2026-10-09)
1. **Evaluation data:**
   - Synthetic CVs, written by Claude, so there is no personal data and the fixtures are committed.
   - The jobs are also synthetic, each one designed to be good, ok, bad or ineligible, so its label is known in advance.
   - A real-job snapshot can be added later, when source keys are available (see the Task 1 plan).
   - The owner reviews the labels.
2. **Rerank cost:** about $0.10–0.20 per search accepted.
3. **Location:** prefilled from the CV and editable.
4. **Freshness window:** 30 days.
5. **Smart model.** The owner has **no Anthropic key at the moment and uses Gemini**, so Gemini is the primary provider for the eval and for development.
   - **Rerank on Gemini:** today both Gemini tiers are `gemini-2.5-flash` (`lib/ai/gemini.ts`), so a rerank would re-check with the same model. Task 9 compares, through the eval:
     - a flash rerank with more context, against
     - `gemini-2.5-pro` as the smart tier (lower free-tier limits; paid otherwise).
   - The `claude-sonnet-4-6` vs `claude-sonnet-5` comparison runs later, once an Anthropic key is available. It replaces the deferred "model upgrade eval".
   - **Watch item (added 2026-10-09):** Gemini 2.5 Flash counts thinking tokens toward `maxOutputTokens`, and scoring sets 1,500 without JSON mode. Batches may be cut off and fall back to the score of 30. The T1 baseline measures this (the `unscored` metric). If it's confirmed, it's fixed under the bug protocol before Task 3.
6. **Branch:** `feature/match-quality`, stacked on `fix/hardening-and-cleanup`. The uncommitted scoring-pool change moved here as Task 8.
7. **JSearch:** recommended as the default worldwide source, with an operator fallback key. That's a docs and config change only; the key itself is the operator's.

## Open Questions (answered above; kept for history)
1. **Evaluation data:** can you provide 8 or more real CVs across different professions and countries? I'd anonymise them.
   - The alternative is realistic synthetic CVs, which I'd write. They're faster, but less representative.
   - For labels: should I draft them with the smart model and you review, or do you label from scratch?
   - Should fixtures be committed (anonymised) or kept local and git-ignored?
2. **Rerank cost:** is about $0.10–0.20 per search on Anthropic keys acceptable for noticeably better top results? On the user's own key it's their cost; on fallback keys it's yours, within the same daily quota.
3. **Location prefill from the CV:** should the field be prefilled and editable (recommended)? Or should the CV location be used silently when the field is blank?
4. **Freshness window:** 30 days (recommended), or 14 or 45?
5. **Smart model:** should the eval compare `claude-sonnet-4-6` (current) with `claude-sonnet-5` and pick the better one? This would replace the deferred "model upgrade eval" from the hardening PRD.
6. **Branch:** a new `feature/match-quality` branch stacked on `fix/hardening-and-cleanup` (recommended, because the hardening branch is already large)? Or keep everything on `fix/hardening-and-cleanup`, with the scoring-pool change moving to the new branch as part of Task 8?
7. **Sources for worldwide reach:** JSearch (Google for Jobs) is the most global source we have, but needs a RapidAPI key. Should it become the recommended default, with an operator fallback key? Regional boards are a Phase 4 PRD.
