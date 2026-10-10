# Code Review: Match quality T4: requirements text and a compact CV profile
**Date**: 2026-10-11
**Status**: Approved (2026-10-11, as is). Suggestions not applied; AI eval pending.
**Plan**: `.agents/plans/2026-10-11-match-quality-t4-job-text-cv-profile.md`

## Summary
The scoring model now reads the requirement sections of each posting first, up to 1,500 characters (it was the first 500 characters), and a profile-first CV of up to 6,000 characters (it was 3,500 characters of raw text). The batch size stays at 10, as approved.
- **New code:** two small pure modules, plus a two-line change in the prompt and the pipeline.
- **Tests:** 18 new.
- **Checks:** lint (no new warnings), `tsc`, `npm test` 265/265 and `next build` pass.
- **Offline check:** requirement sections now come first in 23 of the 24 `late-requirements` fixture postings. The other one has no requirements heading.

No critical or important issues. Two deviations from the plan are listed below.

## Deviations from the plan
- **The heading list is wider than planned.**
  - The first version moved requirements first in only 11 of the 24 `late-requirements` fixture postings.
  - I added the wordings real postings use:
    - "What you need", "You'll need", "What you will do", "What we are looking for", "What we need";
    - "Selection criteria", "The successful applicant", "To be successful".
  - I also made "About …", "The role" and "Why …" end a requirement section.
  - That brought it to 23 of 24. The list was tuned against the fixtures, so watch the real eval for overfitting.
- **The prompt still says `CANDIDATE CV:`** instead of the planned "CANDIDATE CV (profile, then full text)". The text itself starts with `PROFILE` and `FULL CV TEXT` headings, and when there's no profile the new label would be wrong.

## Issues Found

### Critical (must fix before merging)
None.

### Important (should fix)
None.

### Suggestions (nice to have)
- **[Edge case] `lib/job-text.ts:53` — broad "other" headings can end a requirement section early.**
  - A non-bullet line inside the requirements that starts with "Position …", "Role …", "About …" or "Why …" (60 characters or fewer) is treated as a heading. The rest of that section then goes after the intro.
  - Nothing is dropped as long as the text fits in 1,500 characters; only the order changes.
  - **Option:** require these to be heading-shaped: no full stop at the end, and at most 5 words.
- **[Edge case] `lib/job-text.ts:34` — "Skills" or "Experience" at the start of a short intro sentence** (for example "Experience the best of Dubai…") would start a requirement section. As above, it only affects the order.
- **[Improvement] `lib/job-text.ts:6` — only common named entities are decoded.**
  - Numeric entities (`&#8217;`, `&#x2019;`) stay as text. That's harmless for the model, but adding a numeric-entity decode is a one-line fix.
- **[Improvement] The pre-rank (`score-pool.ts`) and `job-ai-helpers.ts` still use their own `replace(/<[^>]+>/g, …)`.**
  - They could use `htmlToText`. It's out of scope (they work), so I'm noting it for a cleanup.
- **[Note] `lib/job-text.ts:22` — like the old code, anything shaped like `<…>` is removed as a tag.** For example "salary <50k and >30k" loses its middle. That's the same behaviour as before, and it's also what keeps a `<job_posting>` tag from being injected.
- **[Cost] About 3× more description text per job:** roughly 4 k more input tokens per batch of 10. That's small on paid keys and well under Gemini's free-tier token limits. The request count is unchanged.
- **[Eval] `EVAL_LABEL=t4` hasn't run.** Watch the `late-requirements` and `missing-hard-requirement` traps, bad@10, and unscored jobs (timeouts from bigger prompts).

## Checklist
- [x] No SQL injection risks (no queries)
- [x] No mass assignment vulnerabilities (n/a)
- [x] No exposed secrets or hardcoded credentials
- [x] No N+1 query problems (n/a)
- [x] Missing indexes on frequently queried columns checked (n/a)
- [x] Error handling covers edge cases (null or empty description → "No description provided."; null profile → raw text; long text cut at a word where possible)
- [x] Validation rules are complete (the profile is already zod-validated upstream; scores are still validated and clamped)
- [x] Authorization checks are in place (unchanged)
- [x] No unhandled promise rejections (no new async)
- [x] No memory leaks in useEffect (n/a)
- [x] Large collections use chunking (n/a; per-job string work on ≤40 jobs, or about 250 for "All")
- [x] Tests cover the main scenarios (HTML, reordering, other languages, heading boundaries, false positives, cuts, the profile layout and cap, prompt injection through the description, pipeline wiring)
- [x] No existing features were removed or broken (all earlier tests pass; the batch size, timeouts and output budget are unchanged)
- [x] No unrelated files were modified
