# Plan: "View PDF" link for uploaded CVs

**Status**: Completed (2026-10-22). Review approved with "fix all" (two items skipped by decision): `.agents/plans/reviews/2026-10-21-view-cv-pdf-review.md`
**Date**: 2026-10-21
**Type**: Small feature. Not an Asana task. No PRD (a single task).
**Branch**: `feature/view-cv-pdf`, from `origin/master`, created after the 503 fix was committed and pushed (`f7b7cb7` on `fix/gemini-503-retry`), so the two don't mix.

## Task Summary
The CV page only shows the **parsed** version of a CV: profile, skills and experience. The uploaded PDF is kept in the private `cvs` storage bucket (`{userId}/{timestamp}.pdf`), but there's no way to open it.

This adds a **View PDF** link:
- next to the "Parsed {date}" badge, for the active CV;
- on each row of **Previous CVs**.

Either one opens the original PDF in a new browser tab.

## Affected Files
- **`lib/cv-retention.ts`:** a new `getCvFile(userId, cvId, supabase)`.
  - It reads the user's CV row, filtered by `userId` and `cvId`. RLS doesn't apply, so the filter is the guard.
  - It downloads the file from the `cvs` bucket with the **user's** Supabase client, so the storage policy (own folder only) is a second guard.
  - It returns `{ ok: true, bytes, createdAt }`, `{ ok: false, reason: 'not_found' }` or `{ ok: false, reason: 'storage_failed' }`.
  - It lives next to `deleteCv`, which already owns the bucket name and the same row lookup.
- **`app/api/cv/[id]/file/route.ts`** (new): `GET`. It returns the PDF bytes with:
  - `Content-Type: application/pdf`;
  - `Content-Disposition: inline; filename="CV-2026-10-21.pdf"` (the upload date);
  - `Cache-Control: private, no-store`.
- **`app/(app)/cv/page.tsx`:** a "View PDF" link beside the "Parsed" badge (only when there's an active CV). It passes nothing new to `PreviousCvs`, which already gets each CV's `id`.
- **`components/previous-cvs.tsx`:** a "View" link before the Delete button on each row.
- **Tests:**
  - `tests/unit/cv-retention.test.ts`: `getCvFile` cases, using the existing db and storage fakes;
  - `tests/integration/cross-user-access.test.ts`: user B → 404 for user A's file.
- **Docs:** this plan and its review. Optionally one line in `/help` (Question 3).

## Current Behavior to Preserve
- **Upload:** unchanged. It's PDF only, up to 4 MB with the byte check, parsed before it's stored, the new CV becomes active, and unused CVs are pruned.
- **CV page:**
  - the "Parsed" badge, profile, skills, experience and polish actions are unchanged;
  - the page still renders with no CV (no link then).
- **Previous CVs:** the list, date, search count, the Delete confirm text and its refresh are unchanged. The active CV still isn't listed.
- **`deleteCv` and `pruneUnusedCvs`:** unchanged behaviour. The bucket constant is shared, not changed.
- **`DELETE /api/cv/[id]`:** unchanged.
- **Security headers:** unchanged (`frame-ancestors 'none'` in `next.config.ts`). The PDF opens in its own tab, not in an iframe, so it isn't affected.

## Out of Scope
- **Storing the original file name.** It needs a migration on the hosted DB; see Question 2.
- **An in-page PDF preview** (iframe/embed): blocked by `frame-ancestors 'none'` for our own pages, and it isn't needed for "see what I uploaded".
- **Downloading** as an attachment. The browser's PDF viewer already has a download button.
- **The browser extension's CV profile.**

## Approach
1. **`getCvFile`:**
   ```
   row = select id, filePath, createdAt from cvs where id = cvId and userId = userId limit 1
   if !row → not_found
   { data, error } = supabase.storage.from(BUCKET).download(row.filePath)
   if error or !data → log warn cv_file.download_failed, return storage_failed
   return { ok, bytes: new Uint8Array(await data.arrayBuffer()), createdAt: row.createdAt }
   ```
   A missing object in storage, for example an old test row, counts as `storage_failed`.
2. **The route** `GET /api/cv/[id]/file`:
   - `requireUser()`; a signed-out user gets 401.
   - `z.string().uuid()` on `id`, as in the feedback route; a bad id gets 404, not a Postgres 500.
   - `not_found` → 404 `{ error: 'CV not found' }`.
   - `storage_failed` → 500 `{ error: 'Could not load the CV file. Please try again.' }`.
   - On success it returns the bytes with the headers above.
3. **Links:** plain `<a href="/api/cv/{id}/file" target="_blank" rel="noopener noreferrer">`, styled like the existing small outline buttons, with the `FileText` / `ExternalLink` icon.
   - They're links, not fetch + blob, so the browser's own PDF viewer handles it, and no JS is needed.
   - Previous CVs: "View" sits before "Delete".
   - Active CV: "View PDF" sits next to the badge.

### Why stream through our route, not a signed Storage URL
**Signed URL (`createSignedUrl` + redirect):**
- It's lighter on our server.
- But the redirect target is a bearer link that works for anyone holding it until it expires.
- It also lands on the Supabase domain.

**Streaming (recommended):**
- The PDF is served only to the signed-in owner.
- It stays on our domain.
- It matches the existing download routes, which return bytes.
- The files are at most 4 MB, inside the 4.5 MB function response limit.

## Database Changes
None. A file-name column would be the one change; see Question 2.

## API Endpoints
- **`GET /api/cv/[id]/file`:**
  - 200: `application/pdf`, inline;
  - 401: signed out;
  - 404: bad id, or not your CV;
  - 500: storage failure.

## Edge Cases & Risks
- **Another user's CV id:** 404, because of the `userId` filter; the storage policy is the second line. It's covered by the cross-user integration test.
- **A CV whose file is gone from storage:** 500 with a clear message, and a warning is logged. The page doesn't break.
- **Response size:** at most 4 MB, plus headers, under Vercel's 4.5 MB response limit. If the upload limit is ever raised past that, this route would need the signed-URL approach instead; this is noted in a code comment.
- **Caching:** `private, no-store`, so a shared or proxy cache never keeps someone's CV.
- **A file name with odd characters:** the name is built from the date only (`CV-YYYY-MM-DD.pdf`), so it's always header-safe.

## Testing Strategy
**Unit** (`cv-retention.test.ts`):
- the owner's row plus storage returning a Blob → `ok` with the same bytes and `createdAt`;
- no row (wrong user or wrong id) → `not_found`, and storage is never called;
- a storage error → `storage_failed`.

**Integration** (`cross-user-access.test.ts`):
- user B → `GET /api/cv/{cvA}/file` → 404.
- These run against `DATABASE_URL` and never in CI. I'll ask before running them.

**Checks:** lint, typecheck, the full `npm test`, and `next build` (a new route). I'll ask before running them.

**Manual:**
- On the CV page, click **View PDF** and check that the uploaded PDF opens in a new tab. Do the same with **View** on a previous CV.
- Signed out, the URL gives 401.

## Questions for you
1. **Streaming vs signed URL:** stream the PDF through our route (recommended, see above), or redirect to a short-lived Supabase signed URL?
2. **The original file name:** also store and show it ("Kistlak_CV_2026.pdf" instead of "Uploaded 21/10/2026")?
   - It needs a new migration (`cvs.file_name text NULL`), `db/schema.ts`, and the upload route saving `file.name`.
   - Old CVs would keep showing the date.
   - Recommended: **not now**. Ship the link first, then do the name as a follow-up if you want it, since it touches the hosted DB.
3. **Help page:** add one line to `/help` ("You can open the PDF you uploaded from the CV page")? Recommended: yes.

## Outcome (2026-10-22)
- **Answers** (approved with "yes"):
  - Q1: stream through our route;
  - Q2: no file-name column (possible follow-up);
  - Q3: help text, done as a "Your CV" section (see below).
- **Built as planned:**
  - `getCvFile` in `lib/cv-retention.ts`;
  - `GET /api/cv/[id]/file`;
  - "View PDF" on the CV page and "View" on Previous CVs.
- **Deviations:**
  - `CvFileResult.bytes` is typed `Uint8Array<ArrayBuffer>`, which `NextResponse`'s body type needs.
  - `/help` had no CV section, so it got a short **"Your CV"** section (upload, view, delete) instead of one line, and the page intro mentions it.
- **From the review ("fix all"):**
  - added `tests/unit/cv-file-route.test.ts` (5 route cases);
  - added the help section.
- **Skipped by decision (2026-10-22):**
  - the CSP `sandbox` header, which would stop Chrome and Edge rendering the PDF;
  - the UTC-vs-local date in the file name, since the server doesn't know the user's zone and aligning would change the page's existing dates.
- **Checks:**
  - `npm run lint`: 0 errors, 1 existing warning;
  - `npm run typecheck`: clean;
  - `npm test`: 29 files, 334 tests passed;
  - `next build`: OK.
- **Still open:**
  - the cross-user integration test is added but not run (it needs `DATABASE_URL`);
  - manual check in the browser.
