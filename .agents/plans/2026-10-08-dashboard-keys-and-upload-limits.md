# Dashboard & Search-Page Key Checks, Clickable Searches, Indexes, Upload Limits

**Status**: Completed (code), 2026-10-08. Index migration applied to the hosted DB. Manual UI/upload checks pending. Review approved: "fix all".

**Deviations (all from the review's "fix all"):**
- **Upload limit is 4 MB, not the approved 5 MB.** Vercel rejects request bodies over 4.5 MB before our code runs, which would show a generic error. `MAX_CV_MB = 4` and `CV_TOO_LARGE_MESSAGE` live in `lib/cv-upload.ts`, shared by the route and the form.
- The upload route rejects an oversized `Content-Length` (with 64 KB multipart slack) before `formData()` buffers the body. `file.size` stays the authoritative check.
- Adzuna status now mixes sources per part exactly like `getDecryptedKeys`: `'user'` only when both parts are the user's.
- The "shared" tag has a tooltip explaining the daily limits.
- Not changed: the storage upload after the AI parse (a note, accepted in the plan).

## Outcome (2026-10-08)
- Unit tests 70/70 (16 new), `tsc` clean, lint 0 errors (1 pre-existing warning).
- `20261009_add_user_created_indexes.sql` applied to the hosted DB (approved by the user). Both indexes were verified in `pg_indexes`. The planner still seq-scans at the current tiny table sizes, as expected.
- **Still to do:** the manual checks in the Testing Strategy section (upload limit now 4 MB), then commit on your go-ahead.
**Date**: 2026-10-08
**Source**: `.agents/plans/reviews/2026-10-07-full-project-review.md`, Important items "Dashboard only checks the Anthropic key", "Running/failed searches can't be opened", "[Data] missing indexes" (index part only) and "[Upload]".
**Builds on**: `fix/search-cancel-and-agentic`. This task branches from there as `fix/dashboard-keys-and-upload-limits`.
**PRD**: none. These are four small, independent fixes with no handover expected.

## Task Summary
1. **Gemini-only and shared-key users are told they can't search.**
   - The dashboard decides "can search" from the user's Anthropic key alone.
   - The search page does the same and hides the form completely, so a Gemini-only user **cannot search at all**, even though `POST /api/search` would accept the request.
   - Neither page counts operator `FALLBACK_*` keys. That also greys out Apify, Adzuna and JSearch in the search form when the operator provides them.
2. **Only completed searches can be opened from the dashboard.** Running searches (with progress and Cancel), failed ones (with the error) and cancelled ones are dead rows. The badge also has no "Cancelled" style.
3. **No index backs the per-user "latest" lookups.** `searches(user_id, created_at)` and `cvs(user_id, created_at)` are used by the dashboard, the search page, every "latest CV" lookup, the stale-search cleanup and the concurrency check.
4. **CV upload is unguarded:**
   - No size limit.
   - The type check trusts the browser.
   - A corrupt PDF throws an unhandled 500.
   - The full text goes to the AI with no cap.
   - The PDF is stored *before* AI parsing, so a parse failure leaves an orphaned file.

## Affected Files
| File | Change |
|---|---|
| `lib/key-status.ts` (new) | `getKeyStatus(userId)`: which keys are available, and whether each is the user's own or a shared fallback. No decryption, presence only |
| `app/(app)/dashboard/page.tsx` | Use `getKeyStatus`; can search = CV + (Anthropic or Gemini); key list includes Gemini and a "shared" tag; every recent search links to its page; add a "Cancelled" badge |
| `app/(app)/search/page.tsx` | Use `getKeyStatus`; ready = CV + (Anthropic or Gemini); setup hint says "Anthropic or Gemini"; source flags include fallback keys |
| `db/schema.ts` | Declare the two indexes on `searches` and `cvs` |
| `supabase/migrations/20261009_add_user_created_indexes.sql` (new) | `CREATE INDEX IF NOT EXISTS` for both |
| `app/api/cv/upload/route.ts` | 5 MB cap (413), `%PDF-` magic-byte check, catch unreadable PDFs (400), cap the text sent to the AI, store the file only after AI parsing succeeds |
| `lib/cv-upload.ts` (new) | Pure helpers `MAX_CV_BYTES`, `isPdfBytes()`, `textForParsing()` (shared by route, form and tests) |
| `components/cv-upload-form.tsx` | Client-side size check with the same limit (a toast before uploading) |
| `tests/unit/key-status.test.ts`, `tests/unit/cv-upload.test.ts` (new) | Unit tests |

## Current Behavior to Preserve
- **Dashboard:**
  - Layout, cards, CTA links and the 5 most recent searches.
  - `failStaleSearches` runs before the list is read.
  - A user with their own Anthropic key and a CV sees exactly what they see today, apart from the extra Gemini row.
- **Search page:**
  - Missing-CV hint and link.
  - The `SearchForm` props shape (`hasApify`, `hasAdzuna`, `hasJsearch`).
  - The disabled placeholder when not ready.
- **Search detail page:** already renders the running (poller + Cancel), failed, cancelled and complete states. No changes there.
- **Upload route:**
  - 401 without a user.
  - "A PDF file is required" (400).
  - The no-AI-key 400.
  - "Could not extract text from PDF" (400).
  - The quota check after text extraction and before any paid or stored work.
  - The storage path format `{userId}/{timestamp}.pdf`.
  - Deactivate old CVs, then insert the new active one.
  - The **full** `rawText` is still saved to the DB; only the copy sent to the AI is capped.
  - The response shape `{ cv }`.
- **Settings page** (`api-keys-form.tsx`) is unchanged.

## Out of Scope
- Deleting old CV files and rows. That's a data-retention decision; see "Privacy controls" in the review.
- zod or structured output for the CV-parse JSON (the separate "AI JSON parsing" item).
- The other `[Data]` points: NULL `source_job_id` dedupe, the CHECK constraint in Drizzle, `pgEnum` status, and a single migration workflow.
- Moving `getDecryptedKeys` out of the route file (an [Architecture] item). `getKeyStatus` deliberately doesn't import it.
- Copy elsewhere that says "Claude" (the search-page intro text). Content, not a bug.

## Approach

### 1. Key status (`lib/key-status.ts`)
- `type KeySource = 'user' | 'shared' | null`.
- Pure function `resolveKeyStatus(row, env)` returns `{ anthropic, gemini, apify, adzuna, jsearch: KeySource }`:
  - `'user'` if the row has the value.
  - Otherwise `'shared'` if the matching `FALLBACK_*` env var is set.
  - Otherwise `null`.
  - Adzuna needs both the id and the key, from the same source.
- `getKeyStatus(userId)` selects the `user_api_keys` row and calls `resolveKeyStatus(row, process.env)`.
- It **checks presence only and never decrypts**. These pages shouldn't depend on `APP_ENCRYPTION_KEY`, and they don't today.
- Helper `canUseAi(status)` = `!!(anthropic || gemini)`. This mirrors `resolveProvider`, which accepts either.

### 2. Dashboard
- Replace the direct `userApiKeys` select with `getKeyStatus(user.id)`.
- `canSearch = Boolean(activeCv) && canUseAi(status)`.
- **API Keys card:**
  - Rows for Anthropic, Gemini, Apify, Adzuna and JSearch, with "`{n}` of 5 configured".
  - `KeyRow` gets an optional `shared` flag that renders a small "shared" label next to the check.
  - Card status: `pending` without an AI key, `partial` with an AI key only, `ready` with an AI key and at least one source key.
- Empty-state copy: "Upload your CV and add an Anthropic or Gemini key to get started."
- **Recent searches:**
  - Every row links to `/search/${s.id}` with the hover style.
  - Remove the `'#'` / `pointer-events-none` branch.
  - `StatusBadge` gets `cancelled` (muted style, same as the search page's badge).

### 3. Search page
- `const status = await getKeyStatus(user.id)`.
- `ready = hasCv && canUseAi(status)`.
- The hint becomes "Add an Anthropic or Gemini API key - required for parsing and matching."
- `SearchForm` gets `hasApify={!!status.apify}`, `hasAdzuna={!!status.adzuna}` and `hasJsearch={!!status.jsearch}`.

### 4. Indexes
- **Migration:**
  ```sql
  CREATE INDEX IF NOT EXISTS "searches_user_created_idx" ON "searches" ("user_id", "created_at" DESC);
  CREATE INDEX IF NOT EXISTS "cvs_user_created_idx" ON "cvs" ("user_id", "created_at" DESC);
  ```
- `db/schema.ts`: add the matching `index(...).on(table.userId, table.createdAt.desc())` to both tables. `searches` and `cvs` currently have no extras callback; add one, as `jobResults` does.
- **Applying it:** the tables are tiny, so plain `CREATE INDEX` (not `CONCURRENTLY`) locks them for milliseconds. It needs your OK before I run it on the hosted DB, like the last migration.

### 5. Upload limits (`app/api/cv/upload/route.ts` + `lib/cv-upload.ts`)
New order of steps (✱ = new):
1. Auth.
2. Form file + the existing type check.
3. ✱ `file.size > MAX_CV_BYTES` (5 MB) → **413** "CV must be a PDF under 5 MB".
4. Keys / provider.
5. Buffer, then ✱ `isPdfBytes(buffer)` (starts with `%PDF-`) or **400** "A PDF file is required".
6. ✱ Wrap `getDocumentProxy` + `extractText` in try/catch → **400** "Could not read this PDF".
7. Empty-text check (unchanged).
8. Quota (unchanged position).
9. ✱ AI parse with `textForParsing(rawText)`, which caps the text at 20,000 characters (≈ 6–8 pages of CV text) and logs when it truncates. The parse error stays a 500.
10. ✱ **Then** the storage upload (moved from before the AI parse). A failed AI parse no longer leaves a stored file.
11. Deactivate old CVs + insert (unchanged).

- **Client:** `cv-upload-form.tsx` checks `file.size > MAX_CV_BYTES` and shows a toast before uploading.
- **Next.js body limit:** route handlers aren't bound by the Server Actions body limit, so a 5 MB form upload needs no config change. I'll confirm this during the manual check.

## Database Changes
- New migration `20261009_add_user_created_indexes.sql` (2 indexes, additive, `IF NOT EXISTS`), mirrored in `db/schema.ts`.
- It must be applied to the hosted DB before deploy. The app works without it, just without the speed-up.

## API Endpoints
`POST /api/cv/upload` gets new error responses:
- 413 for files over 5 MB.
- 400 when the bytes aren't a PDF.
- 400 "Could not read this PDF" (previously an unhandled 500).

There are no other changes.

## Edge Cases & Risks
- **A PDF that's real but sent with the wrong MIME type:** still rejected by the existing type check (unchanged behavior). The magic-byte check only adds rejections.
- **A CV over 20k characters:** the AI sees the first 20k, while the DB keeps the full text for searches and scoring. Most CVs are 3–10k chars. The truncation is logged so we can see if it happens.
- **Shared-key users:**
  - The dashboard now says "Ready" for them. Their searches are still subject to the daily quota, and the 429 message already explains that.
  - The "shared" tag sets expectations.
- **The fallback env var is set but invalid:** the page says ready and the API call fails with the provider's error. That's the same as an invalid user key today.
- **Storage upload fails after a successful AI parse:** the user gets the existing 500 and the AI call was spent. The quota unit was already consumed before, as today.

## Testing Strategy
**Unit (Vitest):**
- `resolveKeyStatus`:
  - User key → `'user'`; fallback only → `'shared'`; neither → `null`; the user key wins over the fallback.
  - Adzuna needs both parts.
  - Gemini-only → `canUseAi` true.
- `isPdfBytes`: real header passes; a PNG, empty input or `%PD` alone fails.
- `textForParsing`: under the cap it's unchanged; over the cap it's cut to 20k chars and flagged as truncated.

**Checks:** `tsc`, lint, full `npm test`.

**Manual:**
1. Gemini-only user: the dashboard says "Ready to find jobs" and the search page shows the form.
2. Click a running, failed and cancelled search on the dashboard; each opens its page.
3. Upload a 6 MB PDF (413 toast), a `.png` renamed to `.pdf` (400), a corrupt PDF (400) and a normal CV (works, file stored once).
4. After applying the migration, `\d searches` and `\d cvs` show the indexes.

## Open Questions
1. **Uncommitted docs:** the two plan-doc updates from the DB checks are uncommitted on `fix/search-cancel-and-agentic`. Should I commit them there first, before branching?
2. **Limits:** OK with 5 MB for the file and 20,000 characters sent to the AI?
3. **"Shared" tag:** OK to show it on the dashboard when a key comes from the operator's fallback? It tells users their usage is capped.
