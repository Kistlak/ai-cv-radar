# PRD: Job Alerts (saved searches that re-run and email new matches)

**Status**: On hold (paused 2026-10-09 at the owner's request). Draft, not approved; no code, plans or migrations exist. To resume, answer the open questions at the end, then approve.
**Date**: 2026-10-09
**Owner**: Kistlak
**Source**: Product idea #1 in `.agents/plans/reviews/2026-10-07-full-project-review.md` ("Job alerts: saved searches re-run daily (Vercel Cron), emailing only *new* high-scoring jobs"). It was deferred in `PRD-hardening-and-cleanup.md` §4.
**Depends on**: `fix/hardening-and-cleanup` being merged first. This PRD builds on `getActiveCv`, `requireUser`, `toHttpUrl`, `untrusted()`, the usage quotas and the stale-search reaper.

---

## 1. Overview
Today a search runs once. The user has to come back, run it again and work out which results are new.

Job alerts let a user save a search (query, location, remote, sources, max results) as an alert. The alert runs on a schedule (daily or weekly). Each run:
1. Creates a normal `searches` row and runs the existing `runSearch` pipeline.
2. Compares the results with jobs this alert has already seen.
3. Emails the user only the **new** jobs that score at or above the alert's minimum score.

Every run is a normal search, so the existing search page, deep-dive, cover letter, tailored CV and Auto Apply all work on alert results with no changes.

## 2. Problem & Goals
**Problems:**
1. **No reason to come back.** Value comes from a single search. Job boards change daily, but the app only knows about them when the user runs a search by hand.
2. **Repeated searches show the same jobs.** Each search starts from nothing. `job_results` is deduped only within a search (`job_results_search_source_job_unique`), so the user has to spot new jobs themselves.
3. **No outbound channel.** The app has no email sending at all. Supabase sends auth emails only.

**Goals:**
- G1. A user can turn any search into an alert in one click, and manage their alerts (pause, edit, delete) on one page.
- G2. Alerts run unattended on a schedule and reuse `runSearch` unchanged.
- G3. Users receive an email only when there are new jobs at or above the minimum score. A job is never emailed twice for the same alert.
- G4. Cost stays bounded: per-user alert limits, the existing fallback-key quotas, and auto-pause after repeated failures.
- G5. Every email has a one-click unsubscribe that works without logging in.

**Non-goals (v1):** see §4.

## 3. Users & Impact
- **Job seekers:**
  - Get new matching jobs in their inbox without opening the app.
  - Results stay browsable in the app as a normal search.
- **Operator (Kistlak):**
  - A retention feature.
  - New running costs: email sending, plus AI/Apify usage for alerts that run on fallback keys. These are capped by §6.6.
  - One new external service (the email provider) and one new secret (`CRON_SECRET`).
- **UX changes:**
  - A "Create alert" button on the search results page.
  - A new `/alerts` page linked from the nav.
  - An alerts count on the dashboard.

## 4. Scope
**In scope:**
- An alerts data model and migration.
- An alerts CRUD API and UI.
- A scheduler (cron route).
- An alert runner.
- The diff of new jobs against jobs the alert has already seen.
- Email digests and one-click unsubscribe.
- Auto-pause after repeated failures.
- Docs and env updates.

**Out of scope (v1), possible follow-ups:**
- Per-user send time or timezone. Runs happen when the cron fires, in UTC.
- Other channels (Slack, push, SMS).
- Highlighting "new since last run" jobs on the search page. The email lists them; the search page shows the full run.
- Durable queues (Inngest/QStash). These are review idea #7, a separate PRD. This design keeps runs inside one 300 s function, the same as manual searches.
- Embedding pre-filters (review idea #3).
- Instant or real-time alerts.

## 5. Requirements
**Functional**
- F1. A user can create an alert from a completed search. The alert copies the search's query, location, remote, sources and max results. The user can also set:
  - a name (default: the query),
  - the frequency (`daily` | `weekly`),
  - the minimum score (default 70, range 0–100).
- F2. A user can list, edit (name, frequency, minimum score, enabled), pause/resume and delete their own alerts. Every query filters by `user_id`.
- F3. Each user can have at most `MAX_ALERTS_PER_USER` alerts (default 3). Creating one more returns 409 with a clear message.
- F4. Alerts run against the user's **active CV at run time** (`getActiveCv`), not a pinned one. If the user has no CV, the run is skipped and counted as a failure (see F9).
- F5. Each run creates a `searches` row with `alert_id` set, runs `runSearch`, and then works out the new jobs. A job is new when its (`source`, `source_job_id`) is not in this alert's seen set. Every job the run persisted is then added to the seen set, whether or not it was emailed.
- F6. A digest email is sent only if at least one new job has `match_score >= min_score`. It lists up to 10 jobs by score: title, company, location, salary, score, a short reason and the apply link. It also links to the full search page and has an unsubscribe link.
- F7. **The first run of a new alert sends no email.** It only seeds the seen set, so the first digest doesn't repeat jobs the user just saw.
- F8. **Unsubscribe without logging in.** A signed, single-purpose link disables that alert. The email also carries `List-Unsubscribe` and `List-Unsubscribe-Post` headers so mail clients can unsubscribe with one click.
- F9. **Auto-pause on repeated failures.** After 3 consecutive failed or skipped runs, the alert is disabled, the reason is stored, and the user gets one "alert paused" email.
- F10. **Quotas apply.** If the run would use a FALLBACK key (`searchUsesFallback`), it consumes the user's `search` quota. If the quota is used up, the run is skipped for today. This doesn't count toward F9.
- F11. Alert runs don't block the user's manual searches. They are left out of the concurrency check (Q7).
- F12. Alert searches show on the dashboard like any search, labelled with the alert's name.

**Non-functional**
- N1. `runSearch`, the manual search API and existing response shapes are unchanged, apart from the additive `alertId` field on searches.
- N2. The cron endpoint rejects any request without `Authorization: Bearer ${CRON_SECRET}`.
- N3. **No double runs.** Two overlapping cron calls can't run the same alert twice. Alerts are claimed atomically.
- N4. Email content treats job data as untrusted:
  - all text is HTML-escaped,
  - links go through `toHttpUrl`,
  - the subject line contains no job text, only counts and the alert name.
- N5. Without the email provider env vars, the feature switches itself off: the cron route returns 200 and logs a message, and the `/alerts` UI shows "Alerts aren't enabled on this deployment". Local dev and CI keep working without them.
- N6. Unit tests cover all new pure logic, and the integration suite gets cross-user tests for the alerts API. Lint, `tsc`, `npm test` and `next build` pass.

## 6. Technical Design

**6.1 Data model (Task 1)**
- **`job_alerts`** (new table):
  - `id uuid pk`
  - `user_id uuid → profiles ON DELETE CASCADE`
  - `name text`
  - the search fields: `query text`, `location text null`, `remote_only bool`, `sources text[]`, `max_results int null`
  - `min_score int default 70 CHECK 0–100`
  - `frequency text CHECK IN ('daily','weekly')`
  - `enabled bool default true`
  - `next_run_at timestamptz`
  - `last_run_at timestamptz null`
  - `last_search_id uuid null → searches ON DELETE SET NULL`
  - `consecutive_failures int default 0`
  - `paused_reason text null`
  - `seeded bool default false` (F7)
  - `created_at`, `updated_at`
  - Indexes: `(user_id, created_at desc)` and a partial index `(next_run_at) WHERE enabled`.
- **`alert_seen_jobs`** (new table):
  - `alert_id uuid → job_alerts ON DELETE CASCADE`
  - `source text`, `source_job_id text`
  - `first_seen_at timestamptz default now()`
  - PK `(alert_id, source, source_job_id)`
  - Rows older than 90 days are pruned by the cron, so the table stays bounded.
- **`searches.alert_id`**: a new nullable column, `→ job_alerts ON DELETE SET NULL`. Deleting an alert keeps its past searches.
- Keep `db/schema.ts` in sync, including the CHECKs, as done in T8.

**6.2 Alerts API and UI (Task 2)**
- **API routes** (all use `requireUser()`):
  - `GET/POST /api/alerts` and `PATCH/DELETE /api/alerts/[id]`, validated with zod.
  - POST takes `{ searchId, name?, frequency, minScore }` and copies the fields from that search after checking that the user owns it. This way the client can't send arbitrary sources.
  - `next_run_at` is set to the next cron slot.
- **New `/alerts` page:**
  - Lists the user's alerts with their status: enabled, paused with the reason, or last run with a link to the last search.
  - Has edit, pause/resume and delete controls.
  - Add `/alerts` to `isProtectedRoute` in `lib/supabase/middleware.ts` and to the nav.
- **Search page:** a "Create alert" button that opens a small dialog for name, frequency and minimum score. It's disabled while the search is running and when the alert limit is reached.

**6.3 Email (Task 3)**
- **`lib/email.ts`:** `sendEmail({ to, subject, html, text, headers })` over the provider's REST API with `fetch`, so no new SDK dependency. The recommended provider is Resend (Q2).
  - Env vars: `RESEND_API_KEY`, `ALERTS_FROM_EMAIL`.
  - `isEmailConfigured()` gates the feature (N5).
- **`lib/alert-email.ts`:** pure render functions `renderDigest(alert, jobs, searchUrl, unsubscribeUrl)` and `renderPausedNotice(...)`. Each returns `{ subject, html, text }`, with every field escaped (N4).
- **`lib/alert-token.ts`:** builds unsubscribe tokens.
  - The token is an HMAC-SHA256 of `alertId` + `purpose: "unsubscribe"`, signed with a key derived from `APP_ENCRYPTION_KEY` (HKDF, label `alert-unsubscribe`). No new secret is needed.
  - Tokens have no expiry. Unsubscribing is safe to repeat.
- **`/api/alerts/unsubscribe`:** public, with no auth.
  - `GET` shows a confirmation page.
  - `POST` handles the one-click `List-Unsubscribe-Post` and disables the alert.
  - It checks the token with a timing-safe compare and gives the same response whether or not the alert exists.

**6.4 Alert runner (Task 4)**
`lib/run-alert.ts` exports `runAlert(alertId)`. The steps are:
1. Load the alert. Return if it no longer exists or is disabled.
2. Get the active CV and the keys. If there's no CV or no AI key, record a failure (F9).
3. Apply the fallback quota (F10).
4. Insert a `searches` row with `alert_id` set, the same way `POST /api/search` does, including `sourcesHash`. Move the shared insert into a small helper, `createSearchRow`, and call it from both places. The route's behaviour stays the same.
5. `await runSearch(searchId, userId)`, unchanged.
6. If the search status is `complete`:
   - Select its `job_results` that are not in `alert_seen_jobs` (an anti-join).
   - Insert all of them into the seen set with `ON CONFLICT DO NOTHING`.
   - If `seeded` is true and some new jobs have a score of at least `min_score`, send the digest.
   - Set `seeded = true` and `consecutive_failures = 0`.
7. If the search status is `failed`, increment `consecutive_failures`. At 3, pause the alert and send the notice (F9).
8. Update `last_run_at` and `last_search_id`.

Notes:
- The new-job diff and the "should we email" decision are pure functions that are unit-tested on their own.
- **Run time:** `runSearch` already finishes by about 275 s. The diff and one email call take under 5 s, inside the 300 s budget.
- **Email retries:** if sending fails, the alert's `pending_digest_search_id` is set. The next cron call retries the send for that search before running new work. The diff never repeats, because the seen set is written first.
  - This adds one more nullable column to `job_alerts`. It's listed in the migration.

**6.5 Scheduler (Task 5)**
- **`vercel.json` cron:** `GET /api/cron/alerts`. The schedule depends on the hosting plan (Q1): hourly on Pro, daily on Hobby. On Hobby, a free GitHub Actions `schedule` workflow can call the same URL hourly instead.
- **`/api/cron/alerts`** (`maxDuration = 60`):
  1. Checks the `CRON_SECRET` bearer token (N2).
  2. Runs a **global** stale-search reaper: a new `failAllStaleSearches()` beside the existing per-user `failStaleSearches`, which stays as it is. Nobody polls alert searches, so this is needed.
  3. Retries pending digests.
  4. Claims up to `ALERTS_PER_TICK` due alerts (default 20) atomically:
     `UPDATE job_alerts SET next_run_at = <next slot> WHERE id IN (SELECT id … WHERE enabled AND next_run_at <= now() ORDER BY next_run_at FOR UPDATE SKIP LOCKED LIMIT n) RETURNING id` (N3).
  5. Sends one signed `POST /api/cron/alerts/run { alertId }` per claimed alert, without waiting for it to finish. This way each alert runs in its own 300 s function invocation.
  6. Prunes `alert_seen_jobs` older than 90 days.
- **`/api/cron/alerts/run`** (`maxDuration = 300`): checks the same secret and calls `runAlert(alertId)` inside `after()`, the same way manual searches start.
- **Next run time:** `nextRunAt(frequency, from)` is pure and tested. Daily adds 24 h and weekly adds 7 days, rounded down to the cron slot so runs don't drift.
- **Concurrency (F11):** `hasTooManyRunningSearches` adds `alert_id IS NULL` to its filter. This is the only change to existing quota logic (Q7).

**6.6 Cost controls**
- At most `MAX_ALERTS_PER_USER` alerts each (default 3).
- At most `ALERTS_PER_TICK` alerts per cron call (default 20).
- The existing `QUOTA_SEARCHES_PER_DAY` applies on fallback keys.
- Auto-pause after 3 failures.
- Alert sources follow Q4. The recommendation is to allow the Apify sources only when the user has their own Apify token.

**6.7 Env vars (Task 6)**
- New vars: `RESEND_API_KEY`, `ALERTS_FROM_EMAIL`, `CRON_SECRET`, `MAX_ALERTS_PER_USER`, `ALERTS_PER_TICK`.
- Document them in `.env.local.example`, the README and the `/help` page.

## 7. Data & Migrations
| Migration | Task | Contents | Risk |
|---|---|---|---|
| `20261011_add_job_alerts.sql` | 1 | `job_alerts` table, its CHECKs and indexes, `alert_seen_jobs` | Low: new tables only |
| `20261011_searches_alert_id.sql` | 1 | Nullable `searches.alert_id` FK, `ON DELETE SET NULL`, plus an index | Low: nullable column, no backfill |

Applied to the hosted DB only with your approval, using `npm run db:apply`. Recorded in `supabase/migrations/README.md`. RLS policies for the new tables go in `supabase/policies.sql` for consistency, although the app connects as `postgres`.

## 8. Security, Risks & Mitigations
| Risk | Mitigation |
|---|---|
| Anyone could trigger runs and burn keys through the public cron URL | Bearer `CRON_SECRET` check on both cron routes, compared timing-safe. The run route takes only an `alertId` and loads everything else from the DB |
| Cross-user access to alerts | `requireUser` plus a `user_id` filter on every query. Alert creation checks that the user owns the source search. Cross-user integration tests |
| Job text injected into the email (HTML or phishing) | Escape all fields, links only through `toHttpUrl`, no job text in the subject, a plain-text part included |
| Forged unsubscribe links | An HMAC token bound to the alert id and its purpose. The worst case is pausing an alert, with no data exposed |
| Runaway cost on fallback keys | §6.6 limits, the existing daily quota and auto-pause |
| Duplicate runs or emails from overlapping cron calls | `FOR UPDATE SKIP LOCKED` claim plus moving `next_run_at` in the same statement. The seen set is written before sending, and digest retries are keyed by search id |
| Alert run killed by the 300 s limit | The same budget as manual searches. The global reaper marks it failed, which counts toward auto-pause |
| Email deliverability (spam folder) | A verified sender domain with SPF/DKIM through the provider, `List-Unsubscribe` headers, and no email when there's nothing new |
| Emailing old or deleted accounts | `profiles` cascade deletes alerts. Emails go to `profiles.email` only |
| CV is personal data, sent in prompts on a schedule the user may forget | The `/alerts` page shows every active alert. Deleting a CV leaves the alert with no CV, which leads to failures and then auto-pause. The paused email explains why |

## 9. Testing & Rollout
- **Unit tests:**
  - `nextRunAt`
  - the new-job diff and the email decision, including the first run (F7) and the score threshold
  - the token sign/verify round trip and tampering
  - digest rendering and escaping, with a `<script>` title and a `javascript:` URL
  - cron auth
  - the zod schemas for the alerts API
- **Integration tests** (`tests/integration`, never run in CI):
  - Cross-user CRUD on alerts.
  - The claim query runs each alert once when called twice at the same time.
  - The seen-set diff works on real rows.
- **Manual checks:**
  - Create an alert, then trigger the cron locally with `curl -H "Authorization: Bearer $CRON_SECRET"`.
  - The first run sends no email. Running it again after new jobs appear sends a digest. Running it again with nothing new sends nothing.
  - One-click unsubscribe.
  - Auto-pause, by removing the AI key.
- **Rollout:**
  - Merge with the email env vars unset, so the feature is off (N5).
  - Apply the migrations and set the env vars plus the `vercel.json` cron.
  - Test with one account, then announce.

## 10. Task Breakdown
| # | Task | Branch | Size | Depends on | Plan | Status |
|---|---|---|---|---|---|---|
| 1 | Data model: migrations, Drizzle schema, RLS policies | `feature/job-alerts` | S–M | – | – | Not Started |
| 2 | Alerts CRUD API, `/alerts` page, "Create alert" on the search page, middleware and nav | `feature/job-alerts` | M | 1 | – | Not Started |
| 3 | Email: `lib/email.ts`, digest and paused templates, unsubscribe token and route | `feature/job-alerts` | M | 1 | – | Not Started |
| 4 | Runner: `createSearchRow` helper, `runAlert` (quota, diff, seen set, digest, failures and auto-pause) | `feature/job-alerts` | M–L | 1, 3 | – | Not Started |
| 5 | Scheduler: cron and run routes, claim query, global reaper, digest retry, pruning, `vercel.json`, concurrency exclusion | `feature/job-alerts` | M | 4 | – | Not Started |
| 6 | Docs: env example, README, `/help`, migrations README | `feature/job-alerts` | S | 5 | – | Not Started |

Following the usual workflow, each task gets its own plan in `.agents/plans/` and review in `.agents/plans/reviews/`.

## 11. Handover Notes
_No handovers yet._

---

## Open Questions (need answers before planning)
1. **Hosting plan:** is this on Vercel Hobby or Pro?
   - Hobby crons run at most once a day, so "daily" means once per day at a fixed UTC time.
   - The alternative is an hourly GitHub Actions workflow calling the cron URL. I recommend that if you're on Hobby.
2. **Email provider:** Resend is my recommendation: a simple REST API, a free tier of about 3k emails a month, and easy domain verification. Alternatives are Postmark, or SES (cheapest at scale). Do you have a sending domain to verify?
3. **Fallback keys:** should alerts be allowed to run on operator FALLBACK keys, counting against the daily search quota as in F10? Or should alerts require the user's own AI key? The recommendation is to allow fallback with the quota, since that's the simplest consistent rule.
4. **Expensive sources:** should alerts include LinkedIn/Indeed/Glassdoor (Apify/agentic, the slowest and most costly)? The recommendation is to include them only when the user has their own Apify token.
5. **Limits and defaults:** are these OK?
   - 3 alerts per user
   - daily and weekly frequencies
   - default minimum score 70
   - up to 10 jobs per email
   - no email when nothing is new
   - auto-pause after 3 failures
6. **First run:** is it OK for the first run to stay silent and only seed the seen set (F7)?
7. **Concurrency:** should alert runs be left out of the one-running-search limit (F11), so a background alert never blocks a manual search?
