# Code Review: "View PDF" link for uploaded CVs
**Date**: 2026-10-21
**Status**: Approved with Changes (2026-10-22): "fix all". Fixed: route unit test (Important), /help "Your CV" section. Skipped by decision: CSP `sandbox` (would break the PDF viewer in Chrome/Edge), UTC-vs-local file-name date (server can't know the user's zone; aligning would change existing page dates).
**Plan**: `.agents/plans/2026-10-21-view-cv-pdf.md` (stream through our route; no file-name column)

## Summary
A small, well-guarded feature. `GET /api/cv/[id]/file` streams the owner's PDF inline, behind two guards:
- `requireUser`;
- a `userId`-filtered row lookup, plus the storage policy through the user's own Supabase client.

The links are plain anchors, so no client JS is needed. No critical issues. There's one deviation from the plan (the help line), and the route itself has no unit test.

## Issues Found

### Critical (must fix before merging)
- None.

### Important (should fix)
- [Testing] `app/api/cv/[id]/file/route.ts`: no unit test covers the route itself: 401, bad-id 404, `not_found` 404, `storage_failed` 500, and the 200 headers (`application/pdf`, `inline; filename="CV-YYYY-MM-DD.pdf"`, `private, no-store`).
  - The helper is unit-tested, and the cross-user 404 is in the integration suite, but that never runs in CI.
  - Fix: a small `tests/unit/cv-file-route.test.ts` mocking `@/lib/auth` and `@/lib/cv-retention`.

### Suggestions (nice to have)
- [Deviation] The plan's Question 3 (a `/help` line) wasn't done. The help page only covers the browser extension and has no CV section, so a line would need a new section.
  - Options: add a short "Your CV" section there, add a hint under the CV page's intro text, or skip it (the link is self-explanatory).
- [Nitpick] `route.ts:32`: the file name uses the **UTC** date (`toISOString().slice(0, 10)`), while the page shows the **local** date (`toLocaleDateString()`). A CV uploaded near midnight could be "CV-2026-10-20.pdf" on a row that says "Uploaded 21/10/2026".
  - It's harmless. A fix would format the date in one fixed zone for both, which is out of this task's scope.
- [Security, low] `route.ts`: the user's own uploaded PDF is served **inline from our origin**.
  - The upload route checks the `%PDF-` magic bytes.
  - We set `Content-Type: application/pdf`, and `X-Content-Type-Options: nosniff` is global (`next.config.ts`).
  - Browsers render PDFs in their sandboxed viewer, and only the owner can fetch their own file, so the worst case is self-inflicted.
  - Hardening option: add `Content-Security-Policy: sandbox` to this response only. Not done, to keep the diff small.
- [Note] The response buffers the whole file (≤ 4 MB) in memory before sending. That's fine at the current cap. The comment in the route says to switch to a signed URL if the cap ever goes past Vercel's 4.5 MB response limit.
- [Note] The storage policy in `supabase/policies.sql` is `FOR ALL`, own folder only, so `download` is covered by the same policy that lets uploads work today. No storage change is needed.

## Checks run
- `tests/unit/cv-retention.test.ts`: 10/10, including 3 new `getCvFile` cases (owner's bytes from the `cvs` bucket; not the user's → `not_found` without touching storage; download error → `storage_failed`).
- `tests/integration/cross-user-access.test.ts`: added "CV file → 404". **Not run**, because it needs `DATABASE_URL` and writes test rows; I'll ask first.
- `npm run lint`: 0 errors, 1 existing warning (React Hook Form `watch()`), not in this diff.
- `npm run typecheck`: clean. This needed `Uint8Array<ArrayBuffer>` in `CvFileResult` for `NextResponse`'s body type.
- `npm test`: 28 files, 329 tests passed.
- `next build`: compiles, and `ƒ /api/cv/[id]/file` is listed. `next-env.d.ts`, which the build rewrites, was restored.

## Checklist
- [x] No SQL injection risks (Drizzle query builder, no raw SQL)
- [x] No mass assignment vulnerabilities (read-only route)
- [x] No exposed secrets or hardcoded credentials
- [x] No N+1 query problems (one row lookup per request)
- [x] Missing indexes on frequently queried columns checked (`cvs` primary key lookup plus `user_id`; fine)
- [x] Error handling covers edge cases (bad id, not yours, file missing in storage)
- [x] Validation rules are complete (`z.string().uuid()` on the id)
- [x] Authorization checks are in place (`requireUser`, `userId` filter, storage policy)
- [x] No unhandled promise rejections (n/a)
- [x] No memory leaks in useEffect (no effects added)
- [x] Large collections use chunking, not ->all() (n/a)
- [x] Tests cover the main scenarios (route unit test added in the "fix all" round: `tests/unit/cv-file-route.test.ts`, 5 cases)
- [x] No existing features were removed or broken (full suite passes; Delete, the list and the page sections are unchanged)
- [x] No unrelated files were modified
