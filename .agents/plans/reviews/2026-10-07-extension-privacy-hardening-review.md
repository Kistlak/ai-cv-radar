# Code Review: Extension privacy hardening (review items 1–3)
**Date**: 2026-10-07
**Status**: Approved (2026-10-08, as is)
**Plan**: `.agents/plans/2026-10-07-extension-privacy-hardening.md`

## Summary
The change is small and targeted, and it closes the three holes as planned. Lint (0 errors) and `tsc` pass. The one remaining risk: the claim that the extension's own profile fetch works without CORS headers is still unverified until the manual browser test.

## Issues Found

### Critical (must fix before merging)
- None found.

### Important (should fix)
- [Verification] `app/api/me/application-profile/route.ts:5-13`: With `ALLOWED_EXTENSION_ORIGINS` unset, the route no longer sends `Access-Control-Allow-Origin` to our own extension. This relies on MV3 service workers that have host permissions (`<all_urls>`) being exempt from CORS. It was not tested in a browser here.
  **Mitigation:** run manual test 4. If the profile fetch fails, set the env var to `chrome-extension://<our-id>`. Unpacked IDs differ per machine unless a manifest `key` is pinned.
- [Testing] `extension/background.js`: There is no automated coverage. The extension has no test harness, so every behavior change relies on the manual checklist in the plan.
  **Suggestion:** a follow-up task to add Playwright extension tests (`launchPersistentContext` with `--load-extension`).

### Suggestions (nice to have)
- [Improvement] `extension/background.js:15-19`: The `ALLOWED_APP_ORIGINS` list duplicates the `content_scripts.matches` list in `manifest.json`, so the two can drift apart. The list could be derived from `chrome.runtime.getManifest().content_scripts[0].matches` instead. It was kept explicit to keep the diff minimal and readable. The README and Help page both note that the two must be kept in sync.
- [Nitpick] `extension/content-connector.js:26`: The connector still sends `origin` in `REGISTER_APP_ORIGIN`, which background now ignores in favor of `sender.url`. It's harmless, so it was left untouched (out of scope).
- [Note] `extension/background.js:248-256`: A manual entry is dropped only when the tab's top-level origin changes, not on every `complete` event, because Chrome can report `complete` after iframe loads. While the user stays on the same site, the entry lives out its 10-minute expiry, but it is never re-injected automatically. The filler only runs when the user clicks Fill.
- [Note] Pre-existing, unchanged: auto-apply entries are still consumed by the first frame that asks for them, which could be a third-party iframe or an intermediate redirect page. These are tracked as out of scope in the plan.

## Behavior check (responsibilities from the plan)
| Responsibility | Status |
|---|---|
| REGISTER_APP_ORIGIN remembers origins, popup lists them | Kept; now only allow-listed origins, taken from `sender.url` |
| AUTO_APPLY fetch profile → open tab → pending fill, consumed once | Kept; adds origin + `http(s)` applyUrl checks |
| REQUEST_PENDING_FILL: auto entries consumed, manual entries peeked for all frames | Kept; manual entries are also scoped to the top-level origin |
| FILL_ACTIVE_TAB: internal-page block, origin fallback loop, guard reset, allFrames inject | Kept unchanged; adds `targetOrigin` |
| onUpdated injects filler for auto-apply tabs (incl. redirects) | Kept; manual entries are no longer re-injected |
| Profile route: auth, OPTIONS, error shapes | Kept; only the allow-origin value changed |

## Checklist
- [x] No SQL injection risks (no DB changes)
- [x] No mass assignment vulnerabilities
- [x] No exposed secrets or hardcoded credentials (only a public origin was hard-coded)
- [x] No N+1 query problems (N/A)
- [x] Missing indexes on frequently queried columns checked (N/A)
- [x] Error handling covers edge cases (bad URLs → `originOf` returns null; invalid applyUrl → error response)
- [x] Validation rules are complete (sender origin and applyUrl protocol)
- [x] Authorization checks are in place (route auth unchanged; origin allow-lists added)
- [x] No unhandled promise rejections (all new async paths sit inside the existing `.then/.catch` chains)
- [x] No memory leaks in useEffect (N/A)
- [x] Large collections use chunking (N/A)
- [ ] Tests cover the main scenarios: manual only, see Important
- [x] No existing features were removed or broken (lint + tsc pass; browser test pending)
- [x] No unrelated files were modified. The pre-existing edits to `.env.local.example` and `package-lock.json` came from the earlier setup task; this task only added the `ALLOWED_EXTENSION_ORIGINS` block.
