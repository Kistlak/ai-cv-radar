# Extension Privacy Hardening (review items 1–3)

**Status**: Completed (code); manual browser verification pending
**Date**: 2026-10-07
**Source**: `.agents/plans/reviews/2026-10-07-full-project-review.md`, the first three Critical items
**PRD**: none. This is a small, self-contained security fix (one feature, five files).

## Task Summary
Close three privacy holes in the Auto Apply browser extension and its profile API:
1. **Profile leaks to the next site in the tab.** After a manual "Fill this form", the user's profile stays queued for 10 minutes. It is auto-filled into every page that loads in that tab, including unrelated sites.
2. **Any `*.vercel.app` site is trusted.** Any such site can register itself as "the app" and make the extension open arbitrary URLs.
3. **The profile API answers any extension.** `/api/me/application-profile` sends CORS-with-credentials headers to *any* `chrome-extension://` or `moz-extension://` origin.

## Affected Files
| File | Change |
|---|---|
| `extension/background.js` | Origin allow-list, sender checks, applyUrl validation, manual-fill scoping |
| `extension/manifest.json` | Replace `https://*.vercel.app/*` with the explicit production origin |
| `app/api/me/application-profile/route.ts` | CORS only for origins listed in `ALLOWED_EXTENSION_ORIGINS` |
| `.env.local.example` | Document `ALLOWED_EXTENSION_ORIGINS` (commented, optional) |
| `extension/README.md` + `app/(app)/help/page.tsx` (lines 120–127) | Update the "configured origins" text, which currently says `*.vercel.app` |

Not touched: `content-filler.js`, `content-connector.js`, `popup.*`, `components/job-actions.tsx`, `lib/application-profile.ts`.

## Current Behavior to Preserve
`background.js` responsibilities today (all must still work):
1. `REGISTER_APP_ORIGIN`: remembers app origins; the popup lists them.
2. `AUTO_APPLY`:
   - fetches the profile from the app with cookies;
   - opens `applyUrl` in a new tab;
   - stores a pending fill (10-minute expiry);
   - the filler gets it once and the entry is then consumed.
3. `REQUEST_PENDING_FILL`:
   - auto-apply entries are consumed on the first request;
   - manual entries are only peeked, so filling works in **all frames**, including embedded Greenhouse/Lever iframes on a company careers page.
4. `FILL_ACTIVE_TAB`:
   - blocks `chrome://` and similar internal pages;
   - tries each known origin until one returns a profile;
   - resets the filler's run guard, so repeat clicks work after the user moves through form steps;
   - injects into all frames.
5. `tabs.onUpdated`: injects the filler when an **auto-apply** tab finishes loading, including after redirects.
6. Popup lists the remembered origins.

Route `/api/me/application-profile`: the GET with auth check, the `OPTIONS` preflight, and the 401/400 error shapes all stay unchanged.

## Out of Scope (noted for later)
- `<all_urls>` host permission (still needed for injecting into arbitrary ATS pages).
- Third-party iframes on the apply page can also receive filled values (via `allFrames`).
- Auto-apply entries consumed by an intermediate redirect page (existing behavior).
- Pinning the extension ID with a manifest `key`.
- Rate limiting and the other review items.

## Approach
### 1. Manual fill: stop leaking to later pages (`background.js`)
- In `handleFillActiveTab`, also store `targetOrigin = new URL(tab.url).origin` in the pending entry.
- In `tabs.onUpdated` (status `complete`): if the entry is **manual**, delete it and **do not** inject. The manual flow already injects the filler itself, and any new top-level load means the user has left that page. Auto-apply entries behave exactly as today.
- In `REQUEST_PENDING_FILL`, reject the request when the entry has a `targetOrigin` that differs from the sender's top-level origin. `sender.tab.url` is the tab's top-level URL, so embedded ATS iframes still match.

### 2. Origin allow-list (`manifest.json`, `background.js`)
- `manifest.json`: replace `https://*.vercel.app/*` with `https://<PROD_ORIGIN>/*` in both `content_scripts.matches` and `host_permissions`. Keep the two localhost entries.
- `background.js`: add an `ALLOWED_APP_ORIGINS` constant with the same list.
  - `REGISTER_APP_ORIGIN` and `AUTO_APPLY` use `new URL(sender.url).origin`, not the origin given in the message, and ignore anything not on the list.
  - `getAppOrigins()` drops stored origins that aren't on the list, which cleans up anything a malicious site registered earlier.
- `handleAutoApply`: before `chrome.tabs.create`, require that `applyUrl` parses with `new URL()` and uses `http:` or `https:`.

### 3. CORS allow-list (`application-profile/route.ts`)
- `corsHeaders(origin)` sets `Access-Control-Allow-Origin` only when `origin` is in `process.env.ALLOWED_EXTENSION_ORIGINS` (comma-separated, trimmed). Otherwise it sends no allow-origin header.
- Why this shouldn't break our extension even with the env var unset: in Manifest V3, an extension's service worker that has host permission for a site is exempt from CORS. Our manifest has `<all_urls>`, so its `fetch` should work without these headers. The env var is there as an explicit opt-in in case a browser needs it. **Verified in manual test step 4; if that fails, we set the env var to our extension ID.**

## Database Changes
None.

## API Endpoints
`GET` / `OPTIONS` `/api/me/application-profile`: only the CORS header behavior changes.

## Edge Cases & Risks
- **Production origin unknown.** I need the deployed URL (e.g. `https://ai-cv-radar.vercel.app`). Vercel *preview* URLs will stop matching; add them to the list if previews must work.
- **Stable extension ID.** Unpacked extensions get a per-machine ID unless a `key` is set. Relevant only if the env var turns out to be needed.
- **Multi-step forms with full page reloads.** The user clicks "Fill this form" again on each step; that is already how it works today (see the comment at `background.js:180`).
- **SPA route changes** don't fire `status: complete`, so the filler's single-run guard still applies, as today.

## Testing Strategy
There are no automated tests for the extension (no harness exists; adding one is out of scope). Manual checklist, run with the unpacked extension reloaded:
1. **Auto Apply:** in the app, open a result and click Auto Apply. The tab opens and the form is filled.
2. **Manual fill:** open a Greenhouse page and use popup → Fill. The fields are filled, including inside an embedded iframe if one is available.
3. **Leak check:** after step 2, navigate the same tab to another site that has a form. Nothing is filled and no badge appears.
4. **CORS:** with `ALLOWED_EXTENSION_ORIGINS` unset, steps 1–2 still fetch the profile. Then `curl -H "Origin: chrome-extension://abc" .../api/me/application-profile -I` returns no `Access-Control-Allow-Origin`.
5. **Bad applyUrl:** posting an `AUTO_APPLY_REQUEST` with `applyUrl: "javascript:alert(1)"` from the app's devtools opens no tab and returns an error.
6. **Origin list:** the popup no longer lists non-allow-listed origins.

Then run `npm run lint` and `npx tsc --noEmit` (with your OK), plus the existing Playwright suite.

## Open Questions (resolved)
1. Production origin: `https://ai-cv-radar.vercel.app`.
2. Preview deployments: the user is unsure, so they are **not** allow-listed. Adding one means updating `manifest.json` and `ALLOWED_APP_ORIGINS` in `background.js`.

## Outcome (2026-10-08)
- Implemented as planned. `npm run lint`: 0 errors, 1 pre-existing warning (`components/search-form.tsx:67`). `npx tsc --noEmit`: clean.
- **Deviation:** the plan said manual entries would be deleted on *any* `tabs.onUpdated` `complete` event. The implementation deletes them only when the tab's top-level origin changes, because Chrome can fire `complete` after iframe loads, which would have broken late-loading embedded ATS iframes. Manual entries are still never re-injected automatically.
- Review approved as is: `.agents/plans/reviews/2026-10-07-extension-privacy-hardening-review.md`.
- **Still to do (user):** run the manual browser checklist above, especially test 4 (profile fetch with `ALLOWED_EXTENSION_ORIGINS` unset). Playwright e2e was not run because browsers aren't installed.
