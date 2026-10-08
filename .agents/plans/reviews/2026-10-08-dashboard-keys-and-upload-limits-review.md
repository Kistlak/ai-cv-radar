# Code Review: Dashboard & search-page key checks, clickable searches, indexes, upload limits
**Date**: 2026-10-08
**Status**: Approved with Changes (2026-10-08, "fix all" + apply migration). See Resolution below.
**Plan**: `.agents/plans/2026-10-08-dashboard-keys-and-upload-limits.md`
**Branch**: `fix/dashboard-keys-and-upload-limits` (stacked on `fix/search-cancel-and-agentic`)

## Summary
The change follows the plan with no deviations: 8 files modified, 6 new (2 lib helpers, a migration, 2 test files, plus this review). Unit tests pass 68/68 (14 new), `tsc` is clean, and lint has 0 errors (1 pre-existing warning). The main open point is that the 5 MB upload limit sits above Vercel's own request-body limit. The index migration is written but **not applied**.

## Issues Found

### Critical (must fix before merging)
- None found.

### Important (should fix)
- [Bug] `lib/cv-upload.ts:3` (`MAX_CV_BYTES = 5 MB`): Vercel serverless functions reject request bodies over **4.5 MB** before our code runs. They return a plain-text 413, so the form's `res.json()` throws and the user sees the generic "Something went wrong" toast instead of "CV must be a PDF under 5 MB". The client-side check doesn't catch files between 4.5 and 5 MB either. **Fix:** set the limit to 4 MB (in the constant, the two messages and the test), which keeps the friendly message on every host. Most CV PDFs are well under 1 MB.
- [Performance] `app/api/cv/upload/route.ts:19`: the size check runs after `req.formData()`, which has already read the whole body into memory. On Vercel the 4.5 MB platform cap bounds this, but on a self-hosted server an oversized upload is fully buffered first. **Fix (optional):** reject early on the `Content-Length` header before `formData()`, and keep the `file.size` check as the authoritative one.

### Suggestions (nice to have)
- [Nitpick] `lib/key-status.ts` Adzuna: the status requires the id and key from the *same* source, but `getDecryptedKeys` mixes them (user id + fallback key works at search time). So a user with only their own Adzuna id plus an operator fallback key would see Adzuna as missing while searches still use it. That's very unlikely; to match exactly, use `row?.adzunaAppId || env.FALLBACK_ADZUNA_APP_ID` and the same for the key.
- [Improvement] `app/(app)/dashboard/page.tsx` `KeyRow`: the "shared" tag has no explanation. A `title="Provided by the app; daily limits apply"` tooltip would tell users why their usage is capped.
- [Note] `app/api/cv/upload/route.ts`: the storage upload now runs after the paid AI parse. If storage then fails, that AI call was spent with nothing saved. This was accepted in the plan; it's rarer and cheaper than the orphaned-file problem it replaces.
- [Note] The index migration `20261009_add_user_created_indexes.sql` isn't applied to the hosted DB. Applying it needs your OK, and the app works without it.

## Resolution (2026-10-08)
| Item | Outcome |
|---|---|
| Important: 5 MB above Vercel's 4.5 MB body limit | **Fixed.** Limit is 4 MB (`MAX_CV_MB`), with a shared message constant; a test asserts limit + slack < 4.5 MB |
| Important: body buffered before the size check | **Fixed.** Early 413 on `Content-Length` > limit + 64 KB, before `formData()`; `file.size` check kept |
| Nitpick: Adzuna stricter than search | **Fixed.** Per-part fallback like `getDecryptedKeys`; test added |
| Improvement: explain the "shared" tag | **Fixed.** `title` tooltip |
| Note: AI spend lost if storage fails after parse | No change (accepted in plan) |
| Note: index migration not applied | **Done.** Applied to the hosted DB; both indexes verified in `pg_indexes` |

Re-checked: unit tests 70/70, `tsc` clean, lint 0 errors.

## Manual checks still to run
1. Gemini-only user: the dashboard says "Ready to find jobs", and the search page shows the form.
2. With a `FALLBACK_*` key set: the dashboard shows the "shared" tag, and the search form enables those sources.
3. Click a running, failed and cancelled search on the dashboard; each opens its page.
4. Uploads:
   - Over the limit → friendly error.
   - A renamed `.png` → "A PDF file is required".
   - A corrupt PDF → "Could not read this PDF".
   - A normal CV → works, and the file is stored once.
5. After applying the migration, `\d searches` and `\d cvs` show the new indexes.

## Checklist
- [x] No SQL injection risks (Drizzle builder; the migration is static DDL)
- [x] No mass assignment vulnerabilities
- [x] No exposed secrets or hardcoded credentials (key status reads presence only; nothing is decrypted or sent to the client except booleans/labels)
- [x] No N+1 query problems
- [x] Missing indexes checked: `searches(user_id, created_at)` and `cvs(user_id, created_at)` added and applied
- [x] Error handling covers edge cases (4 MB limit stays under the platform limit; early `Content-Length` check)
- [x] Validation rules are complete (size, magic bytes, unreadable PDF)
- [x] Authorization checks are in place (unchanged; every query is scoped to `user.id`)
- [x] No unhandled promise rejections (the PDF parse is now wrapped)
- [x] No memory leaks in useEffect: N/A
- [x] Large collections use chunking: N/A
- [x] Tests cover the main scenarios (pure helpers; the pages and route are covered by the manual checks)
- [x] No existing features were removed or broken (all 54 earlier tests pass; behaviors in the preserve list are kept)
- [x] No unrelated files were modified
