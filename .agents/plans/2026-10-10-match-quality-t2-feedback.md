# Plan: Match Quality T2 — Thumbs up/down feedback on job results

**Status**: Completed (2026-10-10). Migration applied to the hosted DB; integration tests 13/13; review approved as is. Manual check on the production site pending after deploy.
**Date**: 2026-10-10
**Branch**: `feature/match-quality`
**PRD**: `.agents/prd/PRD-match-quality.md` (Task 2; F2, §6.2, §7)

## Task Summary
Every job card on the search results page gets 👍 / 👎 buttons:
- A 👎 shows a row of optional reasons: *Wrong field*, *Wrong level*, *Wrong location*, *Missing a requirement*, *Expired / closed*, *Other*.
- Clicking the active thumb again clears the vote.
- Votes are saved on the job (`job_results`) and only the owner can set them.

This gives us real user ratings to go with the synthetic eval: the thumbs-up rate overall, by source and by score band. The PRD target is at least 70% thumbs-up. The ratings can also feed the scoring later (Phase 4).

**No ranking code changes**, so this task doesn't affect the eval baseline and can be built while the 2-day baseline runs.

## Affected Files
**New:**
- `supabase/migrations/20261012_job_results_feedback.sql`: three nullable columns plus two CHECKs.
- `lib/job-feedback.ts`: the reason list, the zod request schema, and `normalizeFeedback()` (pure; a reason is only kept with a 👎).
- `app/api/jobs/[id]/feedback/route.ts`: `PATCH`.
- `components/job-feedback.tsx`: a client component with the thumbs and the reason chips.
- `tests/unit/job-feedback.test.ts`: the schema and normalisation.

**Modified:**
- `db/schema.ts`: the `job_results` columns, plus CHECKs declared so drizzle-kit sees no drift (the same pattern as `searches_status_check`).
- `app/(app)/search/[id]/page.tsx`: render `<JobFeedback>` in `JobCard` with the saved vote.
- `tests/integration/cross-user-access.test.ts`: user B gets 404 on `PATCH` for user A's job; user A's own vote round-trips.
- `supabase/migrations/README.md`: the applied-migrations table, after it's applied.

## Current Behavior to Preserve
**`app/(app)/search/[id]/page.tsx`:**
- Auth and ownership (`notFound` for another user's search).
- Stale-search reaping.
- The poller while the search is running.
- Results ordered by `match_score DESC`.
- The score badge colours.
- The `toHttpUrl` apply link or "No apply link".
- The match reason box.
- `JobActions` (deep-dive, cover letter, tailored CV, Auto Apply).
- The source and date footer.

The thumbs are added; nothing else on the card moves except one new row.

**`db/schema.ts`:**
- Existing tables, indexes and checks are unchanged.
- The `JobResult` type gains three nullable fields. All current readers ignore unknown fields.

**`tests/integration/cross-user-access.test.ts`:** every existing assertion stays. The new cases are added to the same setup.

## Out of Scope
- Using feedback in scoring or prompts (Phase 4).
- An admin or analytics UI. A documented SQL query is enough for now.
- Feedback anywhere other than the search results page (dashboard, extension).
- Changing `JobActions` or the card layout beyond the new row.
- Rate limiting the endpoint. It's a cheap, owner-only update of one row.

## Approach
**1. Migration `20261012_job_results_feedback.sql`.** Idempotent, in the same style as the T8 migrations:
```sql
ALTER TABLE job_results
  ADD COLUMN IF NOT EXISTS feedback smallint,
  ADD COLUMN IF NOT EXISTS feedback_reason text,
  ADD COLUMN IF NOT EXISTS feedback_at timestamptz;
-- feedback ∈ {-1, 1}; reason ∈ the six values, and only with -1
DO $$ … ADD CONSTRAINT job_results_feedback_check CHECK (feedback IN (-1, 1)) …
       ADD CONSTRAINT job_results_feedback_reason_check CHECK (
         feedback_reason IS NULL OR (feedback = -1 AND feedback_reason IN
         ('wrong_field','wrong_level','wrong_location','missing_requirement','expired','other'))) … $$;
```
- Nullable columns with no default, so applying it is instant and doesn't rewrite rows.
- **No index:** analysis reads are rare, admin-only SQL.

**2. `lib/job-feedback.ts`**
- `FEEDBACK_REASONS`: the 6 values with UI labels.
- `FeedbackRequestSchema` (zod): `{ feedback: 1 | -1 | null, reason?: <reason> | null }`.
- `normalizeFeedback(input)` returns `{ feedback, reason }`:
  - the reason is dropped unless `feedback === -1`;
  - `null` clears both.

**3. `PATCH /api/jobs/[id]/feedback`**
- `requireUser()`, then `params.id`, then parse the body with zod (400 on failure).
- **Ownership** is enforced in the same statement:
  `UPDATE job_results SET feedback, feedback_reason, feedback_at = now() (or NULL when clearing) WHERE id = $id AND search_id IN (SELECT id FROM searches WHERE user_id = $user) RETURNING id, match_score, source`
  - No row means 404 "Job not found". That's the same response as the other job routes, so ids don't leak.
  - It's one round trip, with no separate read.
- **Log:** `job_feedback.set { userId, jobId, feedback, reason, matchScore, source }`. The score and source make it possible to analyse the logs without the DB too.
- **Response:** `{ feedback, reason }`.

**4. `components/job-feedback.tsx`** (client)
- **Props:** `jobId`, `initialFeedback`, `initialReason`.
- **Buttons:** two small icon buttons (`ThumbsUp` / `ThumbsDown` from lucide-react, already a dependency) in the card footer row, with `aria-pressed` and accessible labels ("This match is good" / "This match is not good").
- **Saving:** optimistic. On error it rolls back and shows a `sonner` toast, the existing pattern in `JobActions`.
- **Reasons:** after 👎, an inline row of 6 small chip buttons appears ("Why? (optional)"). Picking one saves it, and picking it again clears it. There's no popover dependency; the UI kit has none.
- **Re-clicking** the active thumb sends `feedback: null`.

**5. Page.** In `JobCard`'s footer row (source · date), add `<JobFeedback>` on the right, passing `job.feedback` and `job.feedbackReason`. The page already loads the full row with `select()`, so there's no extra query.

**6. Analysis SQL.** Documented in the plan and the PRD:
```sql
SELECT jr.source,
       width_bucket(jr.match_score, 0, 100, 5) AS score_band,
       count(*) FILTER (WHERE feedback = 1)  AS up,
       count(*) FILTER (WHERE feedback = -1) AS down,
       round(100.0 * count(*) FILTER (WHERE feedback = 1) / nullif(count(feedback), 0), 1) AS up_pct
FROM job_results jr WHERE feedback IS NOT NULL
GROUP BY 1, 2 ORDER BY 1, 2;
-- and: SELECT feedback_reason, count(*) FROM job_results WHERE feedback = -1 GROUP BY 1;
```

## Database Changes
- **One migration:** `20261012_job_results_feedback.sql` (above). Additive and nullable; safe for the code already running.
- **Order matters:** `db.select().from(jobResults)` lists every column in `db/schema.ts`. Once this code is deployed, any query on `job_results` fails until the columns exist. That includes **preview deployments, which share the production DB.** So:
  1. **Apply the migration to the hosted DB first**, with your approval, using `npm run db:apply`. The current code ignores the new columns, so this is safe at any time.
  2. Then push and merge.
- Record it in `supabase/migrations/README.md`.

## API Endpoints
| Method | Route | Body | Responses |
|---|---|---|---|
| PATCH | `/api/jobs/[id]/feedback` | `{ "feedback": 1 \| -1 \| null, "reason"?: "wrong_field" \| "wrong_level" \| "wrong_location" \| "missing_requirement" \| "expired" \| "other" \| null }` | 200 `{ feedback, reason }` · 400 invalid body · 401 not signed in · 404 not your job, or no such job |

## Edge Cases & Risks
- **Deploying before the migration breaks the results page** (see Database Changes). Mitigation: migrate first. The plan and the PR say so.
- **A reason sent with 👍 or `null`:** dropped by `normalizeFeedback`, and also blocked by the DB CHECK.
- **Fast double clicks:** each PATCH is idempotent (last write wins). The component turns the buttons off while a request is in flight.
- **Old searches:** rows created before this task just show no vote. Nothing to backfill.
- **Deleted job or search:** 404, and the component rolls back with a toast.
- **Feedback on unscored (30) jobs** is still useful ("wrong field" on an unscored job). It's allowed; analysis can exclude them by `match_reason`.

## Testing Strategy
- **Unit tests (`tests/unit/job-feedback.test.ts`):**
  - the schema accepts 1, -1 and null, and rejects 0, 2, strings and unknown reasons;
  - `normalizeFeedback` drops the reason for 1 and null, and keeps it for -1.
- **Integration tests** (`npm run test:integration`, against the hosted DB, after the migration, with your OK):
  - user B → 404 on user A's job, and A's vote is unchanged;
  - user A sets 👎 with `wrong_level`, then reads it back; sets 👍 and the reason is cleared; clears with `null`.
- **Checks:** lint, typecheck, `npm test`, `next build`.
- **Manual, on the production site after the merge:** vote on a few jobs, reload, and check the votes persist; check that a 👎 reason is saved; run the analysis SQL.
