# Plan: Match quality T3: neutral prompts for any profession

**Status**: Completed (code), 2026-10-10. Review approved with changes (option b). One deviation, below. AI eval pending.
**Date**: 2026-10-10
**Branch**: `feature/match-quality-t3-neutral-prompts` (new, from `master`)
**PRD**: `.agents/prd/PRD-match-quality.md` (Task 3, requirement F3, design §6.3)

## Task Summary
Three prompts assume the candidate is a software developer:
1. **Scoring** (`lib/score-jobs.ts` `buildPrompt`):
   - The scale talks about "tech stack" throughout.
   - Rule 1 forces 0–19 when the job's "PRIMARY required language/framework" isn't on the CV.
   - The examples are Laravel and PHP.
2. **Query derivation** (`lib/derive-query.ts`):
   - It asks for queries "relevant to the candidate's actual stack" using only "technologies/frameworks" from the CV.
   - The only example is Laravel/PHP.
   - Any failure falls back to `'Software Engineer'`, so a nurse whose query derivation fails gets software jobs.
3. **Agentic search** (`lib/agentic-search.ts`): it discards results that have the "wrong stack".

This task rewrites them with a generic rubric that works for any field (§6.3), with examples from several professions. The fallback query becomes the CV's most recent role title.

## Affected Files
- `lib/score-jobs.ts`: `buildPrompt` text only.
- `lib/derive-query.ts`: prompt text, plus an optional fallback role parameter.
- `lib/agentic-search.ts`: one phrase in `buildSystemPrompt`.
- `lib/run-search.ts`:
  - pass the CV's most recent role to `deriveQueriesFromCv`;
  - parse the profile once and reuse it for `rankJobs` (it's currently parsed inline in the `rankJobs` call, from T8).
- Tests:
  - `tests/unit/score-jobs.test.ts`: prompt assertions;
  - `tests/unit/derive-query.test.ts` (new);
  - `tests/unit/agentic-search.test.ts`: one assertion, if the mock exposes the system prompt.
- Docs: this plan, its review, and the PRD row.

## Current Behavior to Preserve
**`buildPrompt(cvText, query, jobs)`:**
- same signature;
- each job wrapped in `<job_posting index="i">`, with title, company and location passed through `untrusted()`;
- HTML stripped from the description, cut at 500 characters (Task 4 changes that, not this task);
- the CV cut at 3,500 characters (also Task 4);
- the `CANDIDATE IS LOOKING FOR: <query>` line;
- `UNTRUSTED_JOB_RULE` stated;
- output asked as a JSON array `[{index, score, reason}]`, one item per job;
- the `[i] Title:` line format the parser and tests rely on;
- strict scoring: most generic job-board results aren't good fits.

**`scoreJobs` and `parseScores`:** untouched. Batching, concurrency, timeouts, `maxTokens: 1500`, the fallback of 30 and validation stay as they are.

**`deriveQueriesFromCv(cvText, ai, count, signal)`:**
- existing calls work unchanged;
- 2–5-word queries that complement each other and reflect the candidate's seniority, with no invented skills;
- `fast` tier, 300 max tokens, a 30 s timeout and the signal passed through;
- the result is parsed as a JSON array of non-empty strings, trimmed, cut at 100 characters and capped at `count`.

**`deriveQueryFromCv`:** kept (it currently has no callers). Only its fallback string changes.

**Agentic search:** the loop, tools, rules and count logic are unchanged. Only the wording of what counts as "off-target" changes.

**`runSearch`:**
- a user query is used as given;
- a blank query derives 3, and the primary one is saved;
- everything else is untouched.

## Out of Scope
- **Candidate location and remote-only in the scoring prompt** (Task 5).
  - The location-eligibility cap is written into the rubric now, as §6.3 specifies, judged from what the CV and the job say.
  - Task 5 adds the explicit `CANDIDATE LOCATION` / `REMOTE ONLY` lines.
- **Longer job text, the CV profile instead of the raw CV, and the batch size** (Task 4).
- **Null scores for unscored jobs** (Task 7).
- **The deep-dive, cover letter and tailored CV prompts** (out of the PRD's scope).
- **The agentic prompt's other text,** and the user prompt.

## Approach
1. **Scoring rubric (`buildPrompt`).** Replace the scale and the "CRITICAL RULES" with a generic version.
   - **Opening:** "You are a strict job-matching expert for candidates in any profession…". Keep "most jobs from generic job-board searches are NOT good fits".
   - **What to judge:**
     - core skills and duties;
     - hard requirements: licences, registrations, certifications, degrees, years of experience, required languages;
     - field or industry;
     - seniority;
     - location eligibility.
   - **Scale:**
     - 90–100: same field and role type; meets every hard requirement; seniority fits; eligible by location.
     - 70–89: strong fit with minor gaps.
     - 50–69: same field with real gaps.
     - 20–49: related field, or one major gap.
     - 0–19: different field, or a fundamentally different role from what the candidate is looking for.
   - **Caps:**
     - A hard requirement the CV doesn't show caps the score at 30.
     - Not eligible by location caps it at 20: on-site or hybrid somewhere the candidate doesn't live, or remote limited to regions or countries that don't include theirs.
     - Seniority two or more levels off caps it at 40.
     - Judge only what the posting and the CV actually say.
   - **Don't reward keyword overlap or topical similarity alone.** For example, two roles that are both "in healthcare" aren't a match by that fact alone.
   - **Reason:** must name the specific matching or missing requirement (skill, licence, years, language, location). No generic praise.
   - **Example output:** 3 items from different professions (a nurse missing a registration, an accountant with a strong fit, a developer on-site in another country). It's the format example only.
   - **`UNTRUSTED_JOB_RULE`:** kept, as the last rule.
2. **`derive-query.ts`:**
   - **Prompt:** "…cast a wide net while staying within the candidate's actual field, skills and seniority".
   - **Rules:**
     - Use the job-title vocabulary employers in this profession use.
     - Only use skills, specialisms and titles the CV supports; don't invent.
     - Reflect seniority.
     - Use the same language as the CV.
   - **Examples:** 3 one-line examples from different professions, labelled as format examples ("for other CVs; don't copy them").
   - **Signature:** `deriveQueriesFromCv(cvText, ai, count = 3, signal?, fallbackRole?: string)`.
   - **Fallback:** `fallbackRole?.trim() || 'jobs'`, used where `'Software Engineer'` is today: an empty result, or a parse failure.
   - **`deriveQueryFromCv`:** `first ?? 'jobs'`.
3. **`agentic-search.ts`:** "wrong stack, wrong seniority, irrelevant titles" becomes "wrong field, missing core requirements, wrong seniority, irrelevant titles".
4. **`run-search.ts`:**
   - After loading the CV: `const cvProfile = CvStructuredSchema.safeParse(cv.structured).data ?? null`.
   - Pass `cvProfile?.experience[0]?.role` as `fallbackRole`, and `cvProfile` to `rankJobs`. The T8 inline parse is replaced by this variable.
   - No other change.

## Database Changes
None.

## API Endpoints
None.

## Edge Cases & Risks
- **A generic rubric could score developers worse than the tuned one.**
  - The eval has a software case (`software-lk`). The before and after comparison will show it.
  - The developer example stays as one of three.
- **The location cap without an explicit candidate location (until Task 5).** The model infers the location from the CV.
  - If the CV has no location, the model shouldn't guess: "if the candidate's location isn't known, don't apply the location cap".
  - The baseline already has about 0 ineligible jobs in the top 10, so the risk of over-capping is the thing to watch in the eval (good jobs dropping).
- **The hard-requirement cap is too harsh.** "Nice to have" items must not trigger it: "only requirements the posting states as required".
- **`'jobs'` as a fallback query** (no role, and derivation failed) gives broad results. It's only reached when both the AI call and the CV profile fail, and it's still better than software jobs for everyone.
- **A longer prompt** adds about 300 tokens per batch. That's negligible against the job text, and `maxTokens` for the output is unchanged.
- **Prompt injection:** unchanged safeguards (tags, `untrusted()`, the rule, zod).

## Testing Strategy
- **Unit (`score-jobs.test.ts`):**
  - The prompt contains no `stack`, `framework`, `Laravel`, `PHP` or `tech`.
  - It contains the three caps (30, 20, 40) and the rule.
  - The `[i] Title:` format, the tags and the query line are still present (the existing untrusted tests stay).
- **Unit (`derive-query.test.ts`, new, with a fake `AiClient`):**
  - parses a valid array, trims it, cuts at 100 characters, caps at `count`;
  - an invalid response, or an empty array, gives `fallbackRole`;
  - no `fallbackRole` gives `'jobs'`;
  - the prompt has no `Laravel` or `stack`;
  - the signal and timeout are passed through.
- **Unit (`agentic-search.test.ts`):** the system prompt doesn't contain "wrong stack", if the existing mock captures it. Otherwise this is skipped and noted in the review.
- **Checks** (I'll ask first): lint, typecheck, `npm test`, `next build`.
- **Eval:**
  - `EVAL_LABEL=t3`, compared with the baseline and T8 runs.
  - Watch per case: good@10, bad@10, ineligible@10, and especially `software-lk` and the `missing-hard-requirement` / `late-requirements` traps.
- **Quota note:**
  - Each full run is about 32 Gemini requests. On the free tier (20 a day) that's 2 days per run.
  - Still queued: the rest of the baseline (about 8), then T8 (32), then T3 (32).
  - A paid key, or a second Google project's key for `EVAL_GEMINI_KEY`, would make this a same-day job.

## Deviations
- **Pulled forward from Task 5 (review option b, approved 2026-10-10):**
  - **Prompt lines:** `CANDIDATE LOCATION` and `REMOTE ONLY`.
  - **New context:** a `CandidateContext` (`location`, `remoteOnly`), passed through `scoreJobs` → `rankJobs` → `runSearch` and the eval runner.
  - **Location source:** the search location, or the CV's location when the search has none, or `unknown`.
  - **Why:** without these lines the new location cap judged by the CV's location alone. That would cap a user searching in a country they want to move to.
  - **Cap wording:** now refers to `CANDIDATE LOCATION`. With `REMOTE ONLY: yes`, an on-site or hybrid job inside the area is a major gap, not ineligible (this matches the eval labels, e.g. `designer-pt-01` = ok).
  - **Still in Task 5:** matching every country, the location prefill from the CV, and the source-side country fixes.
- **Query example:** the developer example is "Senior Python Developer…" instead of Laravel, so the derive prompt has no Laravel left.
