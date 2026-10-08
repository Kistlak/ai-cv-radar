# Code Review: Hardening & Cleanup (T1–T11)
**Date**: 2026-10-08
**Status**: Approved with Changes (2026-10-08, "fix all"). See Resolution below.
**Plan**: `.agents/plans/2026-10-08-hardening-and-cleanup.md` | **PRD**: `.agents/prd/PRD-hardening-and-cleanup.md`
**Branch**: `fix/hardening-and-cleanup`, 11 commits `2721a80`…`f8c2015`, all authored by Kistlak Rajapaksha <kistlakall@gmail.com>

## Summary
All 11 tasks are implemented as planned, with five small, documented deviations (below).
- **Checks:** 134 unit tests pass (64 new), `tsc` is clean, the full-repo lint has 0 errors (1 pre-existing warning), and `next build` succeeds. A clean `npm ci` passes on the new lock file.
- **Not run yet** (they touch the hosted DB and need your OK):
  - The cross-user integration tests.
  - The real-row check of the T5 schemas.
  - The two T8 migrations.
- **Most important finding:** a pre-existing **critical** advisory in `next@16.2.4`. It needs a framework upgrade, which is outside this branch.

## Deviations from the plan
1. **T4 `adzunaCountry`:** an *unrecognised* location keeps today's `gb`. Adzuna is skipped only for places known to be unsupported (UAE, Sri Lanka). The plan said "null otherwise", but that would have dropped Adzuna for every unmapped city (e.g. "New York"). US cities were added to the mapping, so they now query Adzuna's US index.
2. **T5 `derive-query`:** left unchanged. It already validates its output (array, string filter, fallback). `z.array(z.string())` would be *stricter*: one bad item would reject the whole array.
3. **T7:** `nextPreferredProvider` and the `DeletableKeyField` type live in `lib/keys.ts`, not the route file. A reusable `components/confirm-button.tsx` was added and is also used by T9.
4. **T8:** `searches.status` is typed through Drizzle's text-enum, in addition to the CHECK. Every status write is now type-checked at compile time, and no call sites changed.
5. **T11:** `shadcn` stays in `dependencies`, because `app/globals.css` imports `shadcn/tailwind.css` at build time. Only `drizzle-kit` and `dotenv` moved. `npm audit fix` also bumped `shadcn` 4.3.0 → 4.21.4 (within `^4`); the build passes, and a visual check is listed below.

## Issues Found

### Critical (must fix before merging)
- None introduced by this branch.

### Important (should fix)
- [Security, pre-existing] `package.json` `next: 16.2.4`: `npm audit` reports a **critical** advisory fixed in `next@16.4.0`. 21 more high/moderate advisories need breaking upgrades: `apify-client`, `eslint-config-next`, `shadcn`'s transitive deps, `drizzle-kit`'s esbuild-kit and `@anthropic-ai/sdk` 0.90 → 0.132. **Fix:** a follow-up task to upgrade `next` to 16.4.x first (minor, same major), run the full suite and build, then the rest one at a time.
- [Bug risk] `lib/ai/schemas.ts` `CvStructuredSchema.name` must be non-empty (as planned). A CV the AI parses without a name now fails the upload with "AI could not parse the CV structure", where it used to be stored. **Watch:** the existing `cv_upload` error path. If it shows up, relax `name` to default `''`.
- [Behavior] `lib/job-sources/country.ts`: Indeed now gets `nl`, `es`, `it`, `sg`, `nz`, `za`, `br`, `mx`, `pl`, `at`, `be` or `ch` for those places, instead of `us`. That's the intended improvement, but I haven't verified that the `misceres/indeed-scraper` actor accepts every one of these codes. **Fix:** a manual check with one Amsterdam search on real keys. If the actor rejects one, add it to `INDEED_UNCONFIRMED`.
- [Data] `app/api/cv/upload/route.ts` + `lib/cv-retention.ts`: auto-prune (decision 1b) runs right after an upload. A previous CV with no searches is deleted at once, including any general CV and cover letter generated from it. That's consistent with the decision, but worth knowing.
- [Unverified] `lib/cv-retention.ts`: storage deletes use the user's session client. The storage policy (`FOR ALL`, own folder) should allow them, but this hasn't run against real storage yet. **Fix:** the manual CV-delete check below.

### Suggestions (nice to have)
- [Cleanup] `app/api/keys/route.ts`: the re-export of `getDecryptedKeys`/`ResolvedKeys` has no importers left and could be removed in a later change.
- [Improvement] `lib/cv-retention.ts`: storage `error` objects are passed as `err` to the logger. They're plain objects, not `Error`s, so the logged shape depends on the logger's serializer. Minor.
- [Note] `next.config.ts`: `frame-ancestors 'none'` + `X-Frame-Options: DENY`. Nothing embeds the app today, and the extension uses fetch/postMessage. Verify the Auto Apply flow once.
- [Note] T2's delimiters change the scoring prompt slightly. Compare one saved search's top scores before and after with real keys.

## Resolution (2026-10-08, "fix all")
| Item | Outcome |
|---|---|
| Critical `next` advisories | **Fixed.** `next` and `eslint-config-next` 16.2.4 → **16.3.8** (exact pin kept), the smallest version past every listed range: 3 RCEs, proxy/middleware bypasses, SSRF, cache poisoning. Critical advisories: 1 → 0 |
| Other advisories | **Partly fixed.** `@anthropic-ai/sdk` ^0.90 → **^0.91.1** (patch release that fixes its advisory; no 0.132 jump). 18 remain, none critical, all without a safe fix: `braces` has no patched release (via the `shadcn` CLI and ESLint); the `esbuild` dev-server issue sits inside `drizzle-kit`'s dev tooling; `basic-ftp` (via `apify-client` → `proxy-agent` → `get-uri`, whose latest release still pins 5.x) is in an FTP-proxy path this app never uses. Fixing it needs a major-version override under `apify-client` that could break search. npm's other suggestions are downgrades |
| `CvStructuredSchema.name` required | **Fixed.** A missing name becomes `''` (the CV page shows `-`), so the upload no longer fails |
| Indeed country codes unverified | **Fixed.** Checked against the actor's public input schema (`country` enum). Every mapped code is supported except `lk`, so `ae` (UAE) now goes to Indeed too. **New finding, not changed:** the enum is uppercase, but the code has always sent lowercase. If Apify's input validation is case-sensitive, every non-agentic Indeed run has been rejected and silently returned `[]`. Confirming needs one paid Apify run. Your bug-fix protocol says reproduce first, so the casing is unchanged |
| Auto-prune drops the previous CV's generated docs | **No change.** That's decision 1b; those documents belong to the replaced CV |
| Storage delete unverified | **Manual check** (needs a real session; listed below) |
| Re-export in `app/api/keys/route.ts` | **Fixed.** Removed (no importers) |
| Storage errors logged as plain objects | **Fixed.** `asError()` keeps the message |
| Frame headers / scoring delimiters | **Manual checks** (listed below) |

Re-checked: 135 unit tests, `tsc`, full-repo lint (0 errors), `next build`, and `npm ci` on the new lock all pass.

## DB steps awaiting your approval
1. **T8 migrations:**
   - First a read-only pre-check: `SELECT DISTINCT status FROM searches` and a count of NULL/''/'undefined' `source_job_id`.
   - Then `npm run db:apply` for both files, then verify the constraint exists and no NULLs remain.
2. **T3 integration tests** (`npm run test:integration`): temporary users, CV, search and job, removed in `afterAll`.
3. **T5 real-row check:** read a few existing `cvs.structured`, `general_cv` and `job_results.deep_dive`/`tailored_cv` values and confirm they pass the new schemas. Read-only; nothing is printed except pass/fail counts.

## Manual checks (real keys / browser)
- Settings: remove a key (and both Adzuna parts), and check the preferred-provider switch.
- CV page: delete a previous CV, and check the confirmation text and search count.
- Searches:
  - Amsterdam → Adzuna `nl` and `€`; Indeed `nl` accepted.
  - Dubai → Adzuna skipped.
- A failed search shows "The AI provider took too long…".
- Extension Auto Apply still works with the new headers.
- UI looks unchanged after the `shadcn` 4.21 bump.

## Checklist
- [x] No SQL injection risks (Drizzle builder; migrations are static DDL; `db-apply` runs trusted files only)
- [x] No mass assignment vulnerabilities (DELETE field is a zod enum mapped to fixed columns)
- [x] No exposed secrets or hardcoded credentials (decrypt failures log the field name, never the value)
- [x] No N+1 query problems (`listCvs` is one grouped query; prune loops over a handful of rows per user)
- [x] Missing indexes on frequently queried columns checked (no new hot queries)
- [x] Error handling covers edge cases (storage failures keep rows; prune is best-effort; decrypt is per field)
- [x] Validation rules are complete (URLs, AI output, delete field, CV ownership/active)
- [x] Authorization checks are in place (`requireUser` everywhere; ownership in every query; cross-user tests written, run pending)
- [x] No unhandled promise rejections
- [x] No memory leaks in useEffect: N/A
- [x] Large collections use chunking: N/A
- [x] Tests cover the main scenarios (134 unit tests; integration suite pending a run)
- [x] No existing features were removed or broken (all 70 earlier tests pass; build passes)
- [x] No unrelated files were modified
