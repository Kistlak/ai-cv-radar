# Plan: Match quality T4: requirements text and a compact CV profile for scoring

**Status**: Completed (code), 2026-10-11. Batch size stays 10. Review approved as is. AI eval pending.
**Date**: 2026-10-11
**Branch**: `feature/match-quality-t4-job-text` (new, from `master`)
**PRD**: `.agents/prd/PRD-match-quality.md` (Task 4, requirement F4, design §6.4)

## Task Summary
The scoring model judges each job from the **first 500 characters** of its description, with HTML tags removed. That's usually the company introduction, so the requirements the new rubric (T3) checks are often never seen. The eval has a `late-requirements` trap for exactly this. The model also gets the **first 3,500 characters of the raw CV**, which can cut off older roles, education and certifications.

This task gives the model better input for the same job:
1. **`relevantJobText(description, maxChars)`** (new `lib/job-text.ts`):
   - turns HTML into readable text;
   - finds requirement-style sections (requirements, qualifications, skills, responsibilities, and so on, in a few major languages);
   - puts them first, then the rest of the description;
   - cuts to **1,500 characters**.
2. **`cvProfileText(profile, rawText)`** (new `lib/cv-profile.ts`):
   - a compact header from the parsed CV (location, summary, skills, the 4 most recent roles with periods, education);
   - then the raw CV text;
   - **6,000 characters** in total.
3. The scoring prompt uses both.

## Affected Files
- `lib/job-text.ts` (new): `htmlToText`, `relevantJobText`.
- `lib/cv-profile.ts` (new): `cvProfileText`.
- `lib/score-jobs.ts`:
  - `buildPrompt` uses `relevantJobText(…, 1500)` instead of `.slice(0, 500)`;
  - the CV limit goes from 3,500 to 6,000 characters;
  - the CV section is labelled `CANDIDATE CV (profile, then full text)`.
- `lib/match-pipeline.ts`: build the profile text with `cvProfileText(ctx.cvProfile, ctx.cvText)` and pass it to `scoreJobs` as the CV text.
- Tests:
  - `tests/unit/job-text.test.ts` (new);
  - `tests/unit/cv-profile.test.ts` (new);
  - `tests/unit/score-jobs.test.ts` (prompt assertions);
  - `tests/unit/match-pipeline.test.ts` (the profile reaches the prompt).
- Docs: this plan, its review, and the PRD row.

## Current Behavior to Preserve
**`buildPrompt`:**
- same signature;
- `<job_posting>` tags, with title, company and location through `untrusted()`;
- tags can't be smuggled in through the description: HTML is still stripped, and `untrusted()` is now also applied to the description text;
- `'No description provided.'` when there's no description;
- the T3 rubric, caps, rules, the query, location and remote-only lines;
- the `[i] Title:` format.

**`scoreJobs`:** batching, concurrency (3), the 45 s timeout per batch, `maxTokens: 1500`, the fallback of 30, the deadline and signal handling, and the output order are all unchanged. The batch size is a decision below.

**`rankJobs`:** the pre-rank, pool, `onPool`, and `top` selection are unchanged. Only the CV text passed to `scoreJobs` changes.

**Without a valid profile** (`cvProfile` is null): the raw CV text, up to 6,000 characters (it was 3,500).

**Pre-rank (`score-pool.ts`), the deep-dive, cover letter and tailored-CV prompts (`job-ai-helpers.ts`), and query derivation** keep their own text handling.

## Out of Scope
- Using `htmlToText` in the pre-rank or `job-ai-helpers.ts`. It would be a reasonable later cleanup, but they work today.
- The rerank's 3,000-character "detailed" mode (Task 9 reuses `relevantJobText`).
- Changing `maxTokens`, the timeouts or the concurrency.
- Translating headings beyond the list below.

## Approach
1. **`htmlToText(html)`:**
   - Block tags (`br`, `p`, `div`, `li`, `h1`–`h6`, `tr`) become line breaks, with `<li>` as "- ".
   - Other tags are removed.
   - Common entities are decoded (`&amp; &lt; &gt; &quot; &#39; &nbsp;`).
   - Spaces are collapsed within each line, lines are trimmed, and empty lines are dropped.
   - Plain text (Adzuna, JSearch) goes through unchanged, apart from whitespace.
2. **`relevantJobText(description, maxChars)`:**
   - **Null or empty** gives `''` (the caller keeps `'No description provided.'`).
   - **Heading lines:**
     - a line of up to 60 characters that matches the heading list, optionally ending in `:`; or
     - any line of up to 80 characters that ends with `:`.
   - **Requirement headings**, matched as words, case-insensitive:
     - **en:** requirements, qualifications, skills, experience, responsibilities, what you'll need / bring / do, must have, about you, who you are, you have, your profile, key duties
     - **de:** anforderungen, qualifikationen, ihr profil, aufgaben, das bringst du mit
     - **fr:** profil recherché, exigences, compétences, missions, qualifications requises
     - **es:** requisitos, perfil, responsabilidades, funciones
     - **pt:** requisitos, qualificações, responsabilidades, perfil
     - **nl:** functie-eisen, vereisten, wat wij vragen, profiel
     - **ar:** المتطلبات, المؤهلات, المسؤوليات
   - **Sections:** the lines from one heading up to the next. Requirement sections (heading included) come first, in their original order, followed by everything else in its original order (the intro first).
   - **No requirement headings found:** the text in its original order. That's the same as today, but 1,500 characters instead of 500.
   - **Cut:** to `maxChars`, at the last line break or space before the limit when there is one in the final 20%. Otherwise a hard cut.
3. **`cvProfileText(profile, rawText, maxChars = 6000)`:**
   - **With a profile:**
     ```
     PROFILE
     Location: …            (omitted if empty)
     Summary: …             (omitted if empty)
     Skills: a, b, c, …     (omitted if empty)
     Recent roles:
     - Role, Company (period)       (up to 4)
     Education:
     - Degree, Institution (year)
     FULL CV TEXT
     <raw text>
     ```
   - The whole thing is cut to `maxChars`. The header is short, typically under 1,500 characters, so most of the budget is raw text.
   - **Without a profile:** `rawText` cut to `maxChars`.
   - This is the candidate's own data, so it doesn't need `untrusted()`.
4. **`buildPrompt`:** `cvText.slice(0, 6000)`, so other callers still get a cap. Each job's description is `untrusted(relevantJobText(job.description, 1500)) || 'No description provided.'`.
5. **`rankJobs`:** `scoreJobs(toScore, cvProfileText(ctx.cvProfile ?? null, ctx.cvText), …)`.

## Decision for you: the batch size
§6.4 says to cut the batch size from 10 to 8, "to keep the prompt size steady". I'd recommend **keeping 10**:

| | Batch 10 (recommended) | Batch 8 (PRD) |
|---|---|---|
| Prompt per batch | about 10 × 1.5 k + 6 k ≈ 21 k characters ≈ 5–6 k tokens | about 18 k characters ≈ 4.5–5 k tokens |
| AI calls per search (pool of 40) | 4 | 5 (+25%) |
| Eval run (8 cases) | about 32 requests | about 40 requests |

- Both prompt sizes are small for Gemini Flash and Haiku.
- The free tier's binding limit is **requests** (20 a day per model, plus per-minute limits), not prompt size. One more request per search counts for every free-tier user and for every eval run.
- The output stays well inside `maxTokens: 1500`: about 10 reasons × 60 tokens.

If the eval shows quality falling at 10, 8 is a one-line change. **I'll build with 10 unless you say 8.**

## Database Changes
None.

## API Endpoints
None.

## Edge Cases & Risks
- **A heading regex false positive.** A body line like "Experience:" inside a list is treated as a section start. The impact is only the order; all the text still competes for the 1,500 characters.
- **Very long requirement sections** fill the 1,500 characters, and the company and role intro is dropped. That's acceptable: the title, company and location are on the job line anyway.
- **Prompt injection in longer text.** The tags, `untrusted()` (now also on the description), the rule and the zod validation are unchanged. More text means more surface, which is already covered by §8 of the PRD.
- **Cost and latency:** about 3× more description text per job. That's roughly 4 k more input tokens per batch: small on paid keys, and free-tier token limits are far above it.
- **A CV that's mostly in another language than the postings:** no change from today. The model reads both.
- **Entity decoding is partial** (only common entities). Others stay as text, which is harmless.

## Testing Strategy
- **`job-text.test.ts`:**
  - HTML lists and headings become lines, and entities are decoded;
  - a requirements section moves before the intro;
  - a non-English heading works (`Anforderungen:`, `Requisitos`);
  - the cut is at most `maxChars`, at a line break or space where possible;
  - with no headings the original order is kept;
  - null or empty gives `''`;
  - plain text is unchanged apart from whitespace.
- **`cv-profile.test.ts`:**
  - the full profile renders its fields in order;
  - empty fields are omitted;
  - only 4 roles are shown;
  - the total is capped at `maxChars`;
  - a null profile gives the raw text.
- **`score-jobs.test.ts`:**
  - a requirement placed after 500 characters is now in the prompt;
  - a `</job_posting>` inside the description can't close the tag;
  - the existing format, rubric and untrusted tests still pass.
- **`match-pipeline.test.ts`:** with a `cvProfile`, the prompt contains `PROFILE` and `Recent roles:`; without one, the raw text.
- **Checks** (I'll ask first): lint, typecheck, `npm test`, `next build`.
- **Eval:**
  - `EVAL_LABEL=t4` after the T3+T8 run.
  - Watch the `late-requirements` and `missing-hard-requirement` traps, bad@10, and the unscored count (prompt-size-related failures).

## Deviations
- **Heading list widened** after an offline check on the eval fixtures.
  - The first list moved requirements first in only 11 of the 24 `late-requirements` postings.
  - Added: "What you need", "You'll need", "What you will do", "What we are looking for", "What we need", "Selection criteria", "The successful applicant", "To be successful" and "Ideal candidate".
  - "About …", "The role" and "Why …" now end a requirement section.
  - Result: 23 of 24. The list was tuned on the fixtures, so watch the real eval for overfitting.
- **The prompt label stays `CANDIDATE CV:`.** The text carries its own `PROFILE` and `FULL CV TEXT` headings.
