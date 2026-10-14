# Code Review: Match quality T9: rerank the top candidates with the smart model
**Date**: 2026-10-15
**Status**: Approved (2026-10-15), no changes requested. The `RERANK_TOP_K` cap (Important) is left open as a follow-up; the suggestions and notes are left as they are.
**Plan**: `.agents/plans/2026-10-15-match-quality-t9-rerank.md`
**Branch**: `feature/match-quality-t9-rerank`

## Summary
The change follows the plan and the two decisions:
- the rerank is **off by default**;
- the 200 s fast-pass deadline applies **only when the rerank is on**.

With the rerank off, the search pipeline behaves exactly as before. The only differences are one extra field in `RankResult` and a skipped `rerankConfig()` read.

These checks pass:
- lint: 0 errors, plus the same 1 old warning in `components/search-form.tsx`;
- `tsc`;
- `npm test`: 312 of 312, across 26 files;
- `next build`.

Nothing blocks a merge. One Important item is about an operator override that can fire too many parallel calls.

**Deviations from the plan:**
- **`RerankSummary` has a new `ms` field**, the time spent in the rerank, for the `rerank_completed` log. `rankJobs` does both passes, so `run-search` can't time the rerank on its own.
- **`run_search.rerank_skipped` isn't logged when the reason is `disabled`.** That's the default, so it would otherwise fire on every search.
- **The eval's `model` label now includes the rerank setting**, for example `gemini-3.8-flash (default), no rerank` or `… + rerank gemini-3.8-flash (default)`. That keeps rerank-on and rerank-off runs apart in reports and in `EVAL_COMBINE`. The plan said "print the smart model in the header", and this does it through the existing field.
- **`rerankConfig` treats only `true` (any case) as on.** Any other value is off, the same as the default.

## Issues Found

### Critical (must fix before merging)
None.

### Important (should fix)
- [Performance] `lib/rerank.ts` (`rerankTop`, `Promise.all` over every batch) together with `rerankConfig` (`RERANK_TOP_K`):
  - the default `K` is at most 20, so at most 4 parallel calls;
  - but `RERANK_TOP_K` has no upper limit. An operator who sets it to 100 would fire 20 smart-tier calls at once, which risks rate limits (Gemini's per-minute limit, Anthropic's concurrency) and a big cost jump;
  - **Fix:** clamp the override to `MAX_TOP_K` (20) in `rerankTopK`, and document it in `.env.local.example`. That's one line plus a test.
  - The alternative is a concurrency cap like the fast pass's, but clamping is simpler and keeps the 30 s time budget valid.

### Suggestions (nice to have)
- [Improvement] **The progress UI shows "Scoring" during the rerank.** A "Re-checking top matches" stage would be clearer. It's out of scope in the plan (it touches `SearchStage` and the poller).
- [Note] **Eval comparability:**
  - result files written before T9 have the model label `gemini-3.8-flash (default)`, without ", no rerank";
  - so `EVAL_COMBINE` treats old and new runs as different models, even with the rerank off;
  - use a fresh `EVAL_LABEL` for runs after T9.
- [Note] **The model comparison.**
  - Gemini's `thinkingLevel: LOW` (`lib/ai/gemini.ts:36`) applies to both tiers, so a pro smart model also runs with low thinking. That keeps the 1,500 output tokens safe; this was the watch item from T1.
  - When comparing models, check the `rerank.batch_failed` count in the logs. A truncated reply shows up there.
- [Note] **Fast and smart scores sit side by side** in the top N whenever `N > K`, which only happens with `RERANK_TOP_K` set lower than the result count. That's documented in the plan and is the operator's choice.
- [Note] **Each search makes up to 4 more AI calls with the rerank on.** On fallback keys, that's inside the same search quota, as the PRD decided. There's no new quota.
- [Nitpick] `lib/match-pipeline.ts` (`rerankStep`) reads `rerankConfig()` even when `ctx.rerank` is passed, to get `topK`. That's a cheap env read, and it keeps one source for `RERANK_TOP_K`.

## Checklist
- [x] No SQL injection risks: no queries changed
- [x] No mass assignment vulnerabilities: no new write paths
- [x] No exposed secrets or hardcoded credentials
- [x] No N+1 query problems: no queries changed
- [x] Missing indexes on frequently queried columns checked: not applicable
- [x] Error handling covers edge cases:
  - a failed batch, a skipped index, the deadline, cancel and no jobs are all handled;
  - the rerank never throws out of `rankJobs` (each batch catches its own errors).
- [x] Validation rules are complete:
  - smart replies go through the same zod `parseScores` (clamped 0–100);
  - the env values are validated.
- [x] Authorization checks are in place: unchanged
- [x] No unhandled promise rejections: `Promise.all` over batches whose errors are caught
- [x] No memory leaks in useEffect: none touched
- [x] Large collections use chunking, not ->all(): the rerank is bounded to K ≤ 20 by default (see Important for the override)
- [x] Tests cover the main scenarios: K, config, batching and tier, 3,000 characters, failure and skip fallbacks, deadline and cancel, promotion in `rankJobs`, off by default, unscored rescue, "All"
- [x] No existing features were removed or broken: `buildPrompt` gives the same output by default (tested); with the rerank off, the deadlines and results are unchanged
- [x] No unrelated files were modified (`next-env.d.ts` was restored after `next build`)
- [x] Prompt-injection safeguards: the rerank uses the same `buildPrompt` (`untrusted()`, `<job_posting>` tags, `UNTRUSTED_JOB_RULE`)
