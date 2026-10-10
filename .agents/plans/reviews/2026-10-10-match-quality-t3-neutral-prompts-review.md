# Code Review: Match quality T3: neutral prompts for any profession
**Date**: 2026-10-10
**Status**: Approved with Changes (2026-10-10): the Important item was fixed with option (b), with 4 new tests. Suggestions not applied.
**Plan**: `.agents/plans/2026-10-10-match-quality-t3-neutral-prompts.md`

## Summary
The three prompts no longer assume a software developer.
- **Query derivation:** the fallback is now the CV's most recent role, or `'jobs'`, instead of `'Software Engineer'`.
- **CV profile:** `runSearch` parses it once and reuses it.
- **Checks:** lint (no new warnings), `tsc`, `npm test` (243/243, 8 new) and `next build` pass.
- **The one real issue:** the new location cap can penalise users who are searching in a country they want to move to. The scoring prompt doesn't see the search location until Task 5.

The AI eval hasn't run.

## Issues Found

### Critical (must fix before merging)
None.

### Important (should fix)
- **[Bug] `lib/score-jobs.ts:86` — the location cap judges by the CV's location, not the search location.**
  - **Scenario:** a candidate in Colombo searches for on-site jobs in Dubai to relocate. The model sees "lives in Colombo" on the CV and "on-site in Dubai" on the job, so it caps every result at 20. The format example even models this exact case (Berlin vs Colombo → 15).
  - **Before this change:** location wasn't part of scoring, so these users got normal scores.
  - **Root cause:** the search location and the remote-only flag only reach the prompt in Task 5 (§6.5). Task 3 adds the rule but not the inputs.
  - **Options:**
    - (a) Narrow the cap until Task 5: "apply only when the job is restricted to regions that exclude the candidate, or on-site somewhere the candidate neither lives nor is searching in; if unsure, don't cap". Keep the format example but make it a remote-region case.
    - (b) Pull Task 5's `CANDIDATE LOCATION` / `REMOTE ONLY` prompt lines into this task. That's a small change: `scoreJobs` and `rankJobs` get `location` and `remoteOnly`, and `runSearch` and the eval pass them. The rest of Task 5 (country matching, prefill) stays in Task 5.
    - (c) Leave it, and ship Task 5 straight after Task 3.
  - **Recommendation:** (b). It's the correct fix, and the eval cases already include `location` and `remoteOnly` in `search.json`.

### Suggestions (nice to have)
- **[Risk] `lib/score-jobs.ts:85` — the hard-requirement cap (30) depends on what the CV shows.**
  - CVs often leave out things like a driving licence or right to work, so the model could cap a good job.
  - The prompt limits the cap to requirements "the posting states as required". Watch the `missing-hard-requirement` trap and the good jobs' scores in the eval.
- **[Risk] `lib/score-jobs.ts:96` — the format example's scores (30 / 88 / 15) may anchor the model.**
  - The previous prompt had one example at 85.
  - If the eval shows scores clustering at those numbers, use reason-only examples.
- **[Note] `lib/derive-query.ts:32` — one of the three query examples is still a developer one.**
  - It's intentional: the plan keeps one developer example out of three. It's no longer Laravel, and the examples are labelled "for other CVs; don't copy them".
- **[Note] `lib/derive-query.ts:60` — `deriveQueryFromCv` still has no callers.**
  - It was kept per the plan (no removals). It's a candidate for deletion in a cleanup task.
- **[Eval] `EVAL_LABEL=t3` hasn't run.**
  - Compare it with the baseline and T8, especially `software-lk` (the risk that a generic rubric hurts developers) and the location traps.

## Checklist
- [x] No SQL injection risks (no queries changed)
- [x] No mass assignment vulnerabilities (n/a)
- [x] No exposed secrets or hardcoded credentials
- [x] No N+1 query problems (n/a)
- [x] Missing indexes on frequently queried columns checked (n/a)
- [x] Error handling covers edge cases (derive fallback: a role, then `'jobs'`; an invalid profile → `null`)
- [x] Validation rules are complete (the profile goes through `CvStructuredSchema`; scores are still zod-validated and clamped)
- [x] Authorization checks are in place (unchanged)
- [x] No unhandled promise rejections (no new async)
- [x] No memory leaks in useEffect (n/a)
- [x] Large collections use chunking (n/a)
- [x] Tests cover the main scenarios (prompt content and caps, derive parsing and fallbacks, agentic wording; the existing untrusted-data tests still pass)
- [ ] No existing features were removed or broken. See the Important item: search scores for relocating users can drop.
- [x] No unrelated files were modified

## Resolution (2026-10-10)
- **Important item fixed with option (b):**
  - The scoring prompt now gets `CANDIDATE LOCATION (where they live or are searching)` (the search location, or the CV's location, or `unknown`) and `REMOTE ONLY`.
  - The cap is worded against them. "Unknown" means no cap.
  - With remote-only, an on-site job inside the area is a gap, not ineligible.
  - Tests: the lines are present, and the fallback is `unknown`. Passing through `scoreJobs` and `rankJobs` is also tested.
- **Checks after the fix:** lint (no new warnings), `tsc`, `npm test` 247/247, `next build`.
