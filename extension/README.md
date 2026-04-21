# CV Radar — Auto Apply (browser extension)

Chromium browser extension (Manifest V3) that autofills job application forms
with the user's CV Radar profile. Never submits — the user reviews every filled
field and clicks submit themselves.

## What it does

1. Runs a small connector content script on the CV Radar web app origin. This
   sets `data-cv-radar-extension="<version>"` on `<html>` so the app can detect
   the extension.
2. When the user clicks **Auto Apply** in the app, the page posts a message to
   the connector, which forwards it to the background service worker.
3. The background worker fetches `/api/me/application-profile` from the app
   (using the existing session cookie) and opens the job's apply URL in a new
   tab.
4. Once that tab finishes loading, the filler content script is injected. It
   detects the ATS (Greenhouse, Lever, Ashby, Workable) and fills known fields.
   For unknown sites it falls back to a heuristic that matches fields by
   `autocomplete`, `name`, `id`, `aria-label`, placeholder, and label text.
5. A floating badge shows how many fields were filled with **Undo** and
   **Dismiss** actions.

## Install (unpacked, for development)

1. Open `chrome://extensions` in Chrome/Edge/Brave.
2. Toggle **Developer mode** on.
3. Click **Load unpacked** and select this `extension/` folder.
4. Visit the CV Radar app in the same browser and sign in.
5. Open a job result and click **Auto Apply** → **Start Auto Apply**.

## Configured app origins

The connector script is matched against these patterns (edit `manifest.json` if
you deploy elsewhere):

- `http://localhost:3000/*`
- `http://127.0.0.1:3000/*`
- `https://*.vercel.app/*`

The background worker also records each origin the connector announces, so the
popup shows which app instances the extension has seen.

## What is not filled

- File uploads (CV/cover letter) — Greenhouse et al. expect the user to select.
- Auth-walled pages (LinkedIn, Indeed, company SSO) — the extension only fills
  what it can see; if the form is behind a login, the user will see the login
  page and decide what to do.
- CAPTCHA, honeypots, custom freeform questions — left blank for the user.
- Fields not present on the CV (visa sponsorship, salary expectation, EEO) —
  left blank.

## Tech notes

- MV3 service worker, `chrome.storage.session` for pending fills, dynamic
  injection via `chrome.scripting.executeScript`.
- Uses the native `HTMLInputElement` value setter + dispatches input/change
  events so React-controlled forms register the change.
- `MutationObserver` retries filling for 6s to cover SPA forms.
