# Fallback-Key Rate Limits & Quotas (review item 4)

**Status**: Completed (code). **Blocked on deploy:** the migration is not yet applied to the hosted DB, and the manual DB tests are not run yet. Review approved with changes.

**Decisions (2026-10-08):** default limits approved; Vitest added; the concurrency limit applies to everyone.

**Deviations so far:**
- The helper is named `hasTooManyRunningSearches` (the maximum is configurable) instead of `hasRunningSearch`.
- Vitest is pinned to 4.1.11 and installed with `--legacy-peer-deps` (npm 10.9.3 `edgesOut` crash; Vitest 5 needs `@types/node` ≥22).
- The config is `vitest.config.mts` (ESM); unit tests live in `tests/unit/`; a `"test": "vitest run"` script was added.
- CV upload: the quota check runs after text extraction and before the storage upload, rather than right after the key check as planned (from the review).

## Outcome (2026-10-08)
- Unit tests 12/12, `tsc` clean, lint 0 errors (1 pre-existing warning).
- **Still to do:**
  1. Apply `supabase/migrations/20261008_add_usage_counters.sql` to the hosted DB. My attempt was blocked by a tool permission; the user will apply it.
  2. Run the manual DB checklist in the Testing Strategy section.
  3. Deploy only after step 1.
**Date**: 2026-10-08
**Source**: `.agents/plans/reviews/2026-10-07-full-project-review.md`, Critical item "No rate limiting / quotas"
**PRD**: none (one concern: a shared helper plus a check at each AI entry point).

## Task Summary
Signup is open (magic link). When the operator sets `FALLBACK_*` keys, any user can trigger unlimited paid AI and Apify calls on the operator's account. This task adds:
1. **Daily per-user quotas** that apply **only when an operator fallback key would pay for the call**. Users on their own keys are unaffected.
2. **A limit of one running search per user**, for everyone. It protects serverless function time and stops users from firing many searches in parallel.

When a limit is hit, the API returns **429** with a clear message ("…add your own API key in Settings") and a `Retry-After` header. All forms already show the API's `error` text in a toast, so no UI changes are needed.

## Affected Files
| File | Change |
|---|---|
| `db/schema.ts` | New `usageCounters` table |
| `supabase/migrations/20261008_add_usage_counters.sql` | **New**: creates the table and enables RLS |
| `lib/usage-limits.ts` | **New**: quota config, `consumeQuota()`, `isAiFallback()`, `hasRunningSearch()`, `quotaExceededResponse()` |
| `app/api/search/route.ts` | Concurrency check plus search quota (when fallback) |
| `app/api/cv/upload/route.ts` | Upload quota (when fallback) |
| `app/api/jobs/[id]/deep-dive/route.ts` | Generation quota (when fallback and not cached) |
| `app/api/jobs/[id]/cover-letter/route.ts` | Same |
| `app/api/jobs/[id]/tailored-cv/route.ts` | Same |
| `app/api/cv/general-cv/route.ts` | Same |
| `app/api/cv/general-cover-letter/route.ts` | Same |
| `lib/job-ai-helpers.ts`, `lib/general-cv-helpers.ts` | Also return `usingFallback: boolean` in the context |
| `.env.local.example`, `README.md` | Document the new env vars and replace the README's "consider rate-limiting" warning |

## Current Behavior to Preserve
- **All routes:** the auth check runs first (401), the existing validation and error messages and status codes stay the same, and success response shapes don't change.
- **Cached AI results** (`cached: true`) return without being counted. Only a real generation (cache miss or `?regenerate=1`) consumes quota.
- **`POST /api/search`:**
  - checks run in this order: body validation, then "CV exists", then "AI key exists", then insert, then the background `after()` run;
  - the 202 response with `searchId` is unchanged.
- **`POST /api/cv/upload`:** PDF check → key check → text extraction → storage upload → AI parse → deactivate old CVs → insert. The order stays the same; the quota check goes right after the key check.
- **`getDecryptedKeys` / `resolveProvider`:** behavior unchanged; they are only read.
- **Users with their own keys:** they must see **no** change apart from the one-running-search limit.

## Out of Scope
- `location-suggest` auth or rate limits (separate review item).
- IP-based limits, signup gating or CAPTCHA.
- Making cancel actually abort, and the stale-run reaper (review items 5–7, next task).
- Showing remaining quota in the UI (follow-up idea).
- Limits on Adzuna and JSearch fallback keys: these are free-tier APIs, and searches are already capped by the search quota.

## Approach

### 1. Table: `usage_counters`
```
user_id  uuid  FK profiles(id) on delete cascade
action   text  -- 'search' | 'ai_generation' | 'cv_upload'
day      date  -- UTC day bucket
count    integer not null default 0
PRIMARY KEY (user_id, action, day)
```
- RLS is enabled with **no policies**. The app connects as `postgres`, which bypasses RLS. Enabling it stops the Supabase anon key from reading or editing counters through the auto-generated REST API (PostgREST).
- Old rows are tiny (one row per user per action per day) and need no cleanup for now.

### 2. `lib/usage-limits.ts`
- **Config:** read from env with these defaults. A value of `0` disables that limit.
  - `QUOTA_SEARCHES_PER_DAY` = **5**
  - `QUOTA_AI_GENERATIONS_PER_DAY` = **30**: deep-dive, cover letter, tailored CV, general CV and general cover letter share one bucket.
  - `QUOTA_CV_UPLOADS_PER_DAY` = **5**
  - `MAX_CONCURRENT_SEARCHES` = **1**
- **`consumeQuota(userId, action)`** does an atomic check-and-increment in one statement:
  ```sql
  INSERT INTO usage_counters (user_id, action, day, count) VALUES ($1, $2, current_date_utc, 1)
  ON CONFLICT (user_id, action, day) DO UPDATE SET count = usage_counters.count + 1
    WHERE usage_counters.count < $limit
  RETURNING count
  ```
  This is written with Drizzle's `onConflictDoUpdate({ set, setWhere })`. No row returned means the user is over the limit. It returns `{ ok: true }` or `{ ok: false, limit, retryAfterSeconds }`. Because it's a single statement, parallel requests can't both slip past the limit.
- **`isAiFallback(keys, resolved)`** returns `true` when the resolved provider's key came from `FALLBACK_*`, using the existing `usingFallback` flags.
- **`hasRunningSearch(userId)`** returns `true` if the user has a search with `status = 'running'` created **within the last 10 minutes**. The time window means a search stuck in `running` (a known bug, fixed in the next task) cannot lock a user out forever.
- **`quotaExceededResponse(result, what)`** builds the 429 `NextResponse` with a `Retry-After` header (seconds until the next UTC midnight) and an error like: *"Daily limit reached for shared keys (5 searches/day). Add your own API key in Settings to keep going, or try again tomorrow."*

### 3. Wire into routes
- **`POST /api/search`**, after the "AI key" check and before the insert:
  1. If `hasRunningSearch`, return 429 with *"You already have a search running. Wait for it to finish or cancel it."*
  2. A search counts as fallback if `isAiFallback`, **or** an Apify source is selected and `usingFallback.apifyToken` is true. If it's fallback, call `consumeQuota('search')`.
- **`POST /api/cv/upload`:** after the provider is resolved, if `isAiFallback`, call `consumeQuota('cv_upload')`.
- **The five generation routes:** right before calling the generator (after the cache check), if `ctx.usingFallback`, call `consumeQuota('ai_generation')`. To expose that flag, `loadJobAIContext` and `loadGeneralCvContext` add `usingFallback` to the context they return. This is an additive field; existing callers are unaffected.

### 4. No refunds
Quota is consumed **before** the paid call. If the AI call then fails, the unit is not refunded, because the provider may already have billed tokens. This keeps the code simple and errs on the side of the operator's budget.

## Database Changes
- New table `usage_counters` (above), with a composite primary key that also serves as the lookup index.
- New migration `supabase/migrations/20261008_add_usage_counters.sql`, plus the matching Drizzle table in `db/schema.ts`.
- No existing migrations are modified.
- Apply with the SQL file (or `npx drizzle-kit push`) against Supabase. I will **ask before** running it against your hosted DB.

## API Endpoints
| Method | Route | New response |
|---|---|---|
| POST | `/api/search` | 429: search already running / daily search limit (fallback only) |
| POST | `/api/cv/upload` | 429: daily upload limit (fallback only) |
| POST | `/api/jobs/[id]/deep-dive`, `/cover-letter`, `/tailored-cv` | 429: daily generation limit (fallback only, cache miss only) |
| POST | `/api/cv/general-cv`, `/api/cv/general-cover-letter` | Same |

## Edge Cases & Risks
- **Mixed keys:** a user with their own Anthropic key but the fallback Apify token. Their searches still count, because Apify is paid by the operator. Their AI generations don't count.
- **Preferred provider has no key, so it falls back to the other provider:** `isAiFallback` checks the provider that was actually *resolved*, so this is handled correctly.
- **Race on concurrent searches:** two requests in the same ~100 ms could both pass `hasRunningSearch`. This is acceptable for now; the daily quota still caps cost. A Postgres advisory lock can close the gap later if needed.
- **UTC day boundary:** quotas reset at 00:00 UTC (04:00 Dubai time). This is simple and predictable, and documented in the error message via `Retry-After`.
- **Migration not applied:** if the table is missing, `consumeQuota` throws and the route returns 500. I'll apply the migration before deploying, and it should be listed in the PR.

## Testing Strategy
The repo has **no unit-test runner** today (Playwright e2e only). Proposed:
- **Add Vitest** as a dev dependency with a minimal `vitest.config.ts` and a `test` npm script. Then unit-test the pure logic:
  - `getQuotaConfig()`: defaults, env overrides, `0` = disabled, garbage values fall back to defaults;
  - `isAiFallback()`: every combination of preferred, resolved and fallback flags;
  - `secondsUntilUtcMidnight()`: boundary times;
  - the search fallback decision (AI fallback, or Apify source selected with fallback token).
- **DB-dependent behavior**, verified manually against the dev database with a test user and the fallback key set:
  1. With `QUOTA_SEARCHES_PER_DAY=2`: searches 1 and 2 return 202, search 3 returns 429 with `Retry-After`.
  2. A second search while one is running returns 429. After the first one completes, a new search is allowed.
  3. Deep-dive on the same job twice: the first call counts, the second (cached) doesn't. `?regenerate=1` counts.
  4. A user with their own Anthropic key and no Apify fallback is never limited except for concurrency.
  5. Rows in `usage_counters` match the counts above.
- Then run `npm run lint`, `npx tsc --noEmit` and Vitest. I'll ask before running each.

## Open Questions
1. **Default limits:** are 5 searches/day, 30 AI generations/day, 5 CV uploads/day and 1 concurrent search sensible? All of them can be overridden with env vars.
2. **Vitest:** OK to add it as a new dev dependency for unit tests? The alternative is manual tests only.
3. **Concurrency limit:** should it apply to **all** users (recommended: it protects server time), or only to users on fallback keys?
