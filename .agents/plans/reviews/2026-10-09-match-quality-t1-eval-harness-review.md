# Code Review: Match Quality T1 — Evaluation harness
**Date**: 2026-10-09
**Status**: Approved with Changes (2026-10-09): `nurse-gb-11` (Dublin) relabelled `ok`; baseline pending (Gemini free tier, split over 2 days)
**Plan**: `.agents/plans/2026-10-09-match-quality-t1-eval-harness.md`
**PRD**: `.agents/prd/PRD-match-quality.md` (Task 1)

## Summary
Implemented as planned:
- `rankJobs` moved out of `runSearch` unchanged;
- 8 synthetic cases × 48 jobs (about 600 KB), all generated to the README spec, and each case writer's own read-only check passed;
- the loader, metrics and runner;
- 3 new unit test files.

Two things still need your input before the numbers mean anything:
- the owner's label review (the borderline labels are listed below);
- the baseline run, which needs `EVAL_GEMINI_KEY`.

**Not run yet:** lint, typecheck, `npm test`, `next build` and the eval. At your request, they run together at the end.

## Issues Found

### Critical (must fix before merging)
None found. This is subject to the checks above; typecheck is the most likely to flag something, see Important.

### Important (should fix)
- **[Unverified] `tests/unit/match-pipeline.test.ts:22` — the fake client's typing hasn't been checked.**
  - The `fakeAi()` return type (`AiClient & { complete: ReturnType<typeof vi.fn> }`) and `import.meta.dirname` in `tests/eval/*.ts` haven't been through `tsc` yet.
  - If typecheck complains, the fix is local: cast through `vi.fn<AiClient['complete']>()`, or use `path.dirname(fileURLToPath(import.meta.url))`.
- **[Accuracy] `tests/eval/metrics.ts:38` — `isUnscored` also treats an empty reason as unscored.**
  - That catches jobs the model skipped (`scoreJobs` gives them a score of 30 and the reason `''`). But a real score with an empty `reason` would also count, since `reason` is optional in `ScoreResultSchema`.
  - This could slightly overstate "unscored", and could flag a run as invalid that isn't.
  - **Fix options:** give the skipped-index fallback the reason `'Score unavailable'` in `score-jobs.ts` (a behaviour change, so better in Task 7, where unscored jobs become `null`). Or accept it for now: the baseline report shows both counts.

### Suggestions (nice to have)
- **[Fidelity] `tests/eval/matching.eval.ts:83` — the eval passes no deadline or cancel signal.**
  - In production, slow batches past 230 s get the fallback score. The eval measures ranking quality without time pressure.
  - That's intended (the timing work is Task 9), but note it when comparing with live searches.
- **[Coverage] Synthetic data only.** The descriptions are cleaner than real feeds, though some include light HTML and messy formatting. A real-job snapshot (same format) is the follow-up once source keys exist.
- **[Data] `designer-pt` — a Canada-based (ineligible) job lists its salary in CAD,** although the spec asks for EUR/USD. It doesn't affect any label. Left as is.
- **[Labels] Borderline labels for your review.** The case writers flagged these:
  - `software-lk`: "ok" for the Laravel 6-month contract and for the Node.js role that welcomes PHP developers.
  - `nurse-gb`: the on-site Dublin ICU job is `ineligible` (another country), although UK citizens can work in Ireland under the Common Travel Area. Consider `ok`.
  - `teacher-au`: the Albury (NSW) role is `ok`. The ad says VIT holders can get NESA accreditation through mutual recognition, so the only gap is moving away from Melbourne.
  - `accountant-ae`: the Audit Manager role (7+ years of audit; she has 4) is `ok`, and so are the internal audit, tax, treasury and FP&A roles.
  - `sales-us`: the Enterprise AE role (8+ years) and the SMB AE role are `ok`, while an entry-level BDR role is `bad` for seniority.
  - `logistics-ca`: the bilingual-French "Warehouse Supervisor" is `missing-hard-requirement`, not `keyword-stuffed`.
  - `hospitality-sg`: "Senior Front Office Manager (8+ years)" is `good` for a candidate with 10 years.

## Checklist
- [x] No SQL injection risks (no DB code)
- [x] No mass assignment vulnerabilities (n/a)
- [x] No exposed secrets or hardcoded credentials (the eval key comes from git-ignored `.env.local` and is never logged; fixtures use `example.com` and fake phone numbers)
- [x] No N+1 query problems (n/a)
- [x] Missing indexes on frequently queried columns checked (n/a)
- [x] Error handling covers edge cases (fixtures validated with zod; missing label throws; no key → skip with a message)
- [x] Validation rules are complete (loader schemas for all 5 files)
- [x] Authorization checks are in place (unchanged)
- [x] No unhandled promise rejections (runner awaits everything)
- [x] No memory leaks in useEffect (n/a)
- [x] Large collections use chunking (n/a; 48 jobs per case)
- [x] Tests cover the main scenarios (metrics, `rankJobs` incl. pool/deadline/signal, fixture integrity × 8 cases)
- [ ] No existing features were removed or broken. The `runSearch` change is a verbatim move with identical logs and progress, **but the test suite hasn't been run yet**
- [x] No unrelated files were modified

## Checks (2026-10-09)
- Lint: 0 errors (1 warning in `components/search-form.tsx`, a file these changes didn't touch).
- Typecheck: clean.
- `npm test`: 212/212 (after the Gemini fix below).
- `next build`: passes.

## Bug found by the first baseline run, then fixed (owner approved: "go ahead with the fix, include the warning log")
**Run 1** (`gemini-2.5-flash`): **320/320 jobs unscored.** A diagnostic call showed `404: models/gemini-2.5-flash is no longer available to new users … use models/gemini-3.8-flash`. So every Gemini call fails for new keys: scoring, CV parse, derive-query, deep-dive, cover letter and tailored CV.

**Second cause.** On `gemini-3.8-flash` with the app's settings, thinking used 1,411 of the 1,500 `maxOutputTokens`. The result was `finishReason: MAX_TOKENS`, truncated JSON, and the fallback score. With `thinkingLevel: LOW`: `STOP`, 10/10 scores parsed, 0 thinking tokens. `MINIMAL` isn't supported by the model (400).

**Fix:**
- `lib/ai/gemini.ts`: the default model for both tiers is now `gemini-3.8-flash` (the env overrides are unchanged), plus `thinkingConfig: { thinkingLevel: LOW }` on every call.
- `lib/score-jobs.ts`: a `score_jobs.batch_failed` warning log in `scoreBatch`'s catch, skipped on cancel.
- Test first: `tests/unit/gemini-client.test.ts` failed 3/3 before the fix and passes after.

**Run 2** (`gemini-3.8-flash`, low thinking): **still invalid, because of the free-tier daily quota.**
- The error: `429 … generate_content_free_tier_requests, limit: 20, model: gemini-3.8-flash` (per project, per model, per day). A full eval needs about 32 requests.
- Partial numbers, for context only (not a baseline): average good@10 went from 2.88 to 5.13 and bad@10 from 2.0 to 0.88.
- `nurse-gb` was the only fully scored case: 6 good / 4 stale in the top 10, nDCG 0.473, mean score good 92 / bad 7.

**Product note:** a free-tier Gemini user gets 20 requests a day per model, across every feature. One search with "All" (about 25 scoring batches) can't finish, and a search with a count of 10 uses about 5. Free-tier keys will show many unscored jobs. Task 7 ("Not scored" display) and the Settings/help text should say this.

## Baseline
_Pending._ It needs a quota that allows about 32 requests per run (see the summary for the options). The results go here and into PRD §11.
