# AI CV Radar

AI-powered job search that ranks job listings against your CV and helps you apply faster - with fit analysis, tailored cover letters, and ATS-friendly CV Word documents generated per role.

## What it does

- **Upload your CV once.** A PDF is text-extracted and parsed into structured data (skills, experience, education) by Claude.
- **Search jobs across multiple sources.** Remotive, Adzuna, and JSearch are free tier prefilters; LinkedIn, Indeed, and Glassdoor run through Apify. When an Apify token is present, Claude drives the search as an agentic loop - calling actors, reading results, and refining the query when results are weak.
- **Every job gets three AI actions:**
  - **Deep dive** - honest fit analysis: strengths, gaps, and what to emphasize.
  - **Cover letter** - a tailored draft grounded in your CV.
  - **Tailored CV** - an ATS-friendly MS Word document rewritten for the role. Download, edit, apply.
- **Reusable polished CV and cover letter.** From your uploaded CV, generate a general ATS-friendly `.docx` and a cover-letter template (with `[Company Name]` / `[Role Title]` placeholders) you can send for similar roles.
- **Auto Apply (browser extension).** Install the bundled Chromium extension and either click **Auto Apply** on a job result (opens the apply page and fills it for you) or click the extension popup's **Fill this form** button on any application page you've already opened. The extension never submits - you review every field and click submit yourself. Works on Greenhouse, Lever, Ashby, and Workable out of the box, plus a heuristic fallback for unknown ATSs.
- **Cancel anytime.** Long-running searches stop cleanly from the UI.

All AI outputs are cached. Each has an explicit Regenerate button if you want a fresh pass.

## Tech stack

- **Framework:** Next.js 16 (App Router), React 19, TypeScript
- **UI:** Tailwind CSS 4, Base UI, lucide-react, sonner
- **Database:** Supabase Postgres via Drizzle ORM
- **Auth & storage:** Supabase (CV PDFs in a private bucket)
- **AI:** Anthropic Claude - Sonnet 4.6 for generation, Haiku 4.5 for scoring
- **Job sources:** Remotive, Adzuna, JSearch (direct APIs); LinkedIn, Indeed, Glassdoor (via Apify)
- **Document generation:** `docx` (Word output), `unpdf` (PDF parsing)
- **Browser extension:** Manifest V3 (Chromium-based browsers - Chrome, Edge, Brave, Arc)
- **Testing:** Playwright for end-to-end browser tests

## Getting started

### Prerequisites

- Node.js 20+
- A Supabase project
- An Anthropic API key (each user adds their own in Settings)
- Optional: Apify token, Adzuna app ID + key, RapidAPI key - for broader source coverage

### Setup

1. Clone and install:
   ```bash
   git clone <this-repo>
   cd ai-cv-radar
   npm install
   ```

2. Copy the env template and fill it in:
   ```bash
   cp .env.local.example .env.local
   ```

   | Variable | Purpose |
   | --- | --- |
   | `NEXT_PUBLIC_SUPABASE_URL` | From your Supabase project |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | From your Supabase project |
   | `SUPABASE_SERVICE_ROLE_KEY` | From your Supabase project |
   | `DATABASE_URL` | Supabase connection string (Drizzle uses this) |
   | `APP_ENCRYPTION_KEY` | Encrypts user API keys at rest. Generate with `openssl rand -base64 32` |
   | `NEXT_PUBLIC_APP_URL` | `http://localhost:3000` in dev |

   **Optional operator-provided fallback keys.** If you want users without their own keys to still be able to use the app, set any of these. They are used only when the user hasn't configured their own key in Settings.

   | Variable | Falls back for |
   | --- | --- |
   | `FALLBACK_ANTHROPIC_KEY` | Claude (CV parsing, scoring, deep dive, cover letter, tailored CV, agentic search) |
   | `FALLBACK_APIFY_TOKEN` | LinkedIn / Indeed / Glassdoor scraping + agentic loop |
   | `FALLBACK_ADZUNA_APP_ID` | Adzuna source |
   | `FALLBACK_ADZUNA_APP_KEY` | Adzuna source |
   | `FALLBACK_RAPIDAPI_KEY` | JSearch source |

   > **Cost warning.** Anything you put in a `FALLBACK_*` var is billed to *your* account every time a user without their own key uses that feature. Anthropic and Apify costs scale fast - a single agentic search can run several Claude turns and dozens of Apify actor calls. Only set these if you're prepared to pay for shared usage, and consider rate-limiting or sign-up gating before going public.

3. Push the schema to Supabase:
   ```bash
   npx drizzle-kit push
   ```

4. In the Supabase dashboard, create a private Storage bucket named `cvs` for uploaded PDFs.

5. Run the dev server:
   ```bash
   npm run dev
   ```

6. Sign up, open **Settings**, and paste your Anthropic key (plus optional Apify / Adzuna / RapidAPI keys). Keys are encrypted with `APP_ENCRYPTION_KEY` before they touch the database.

### Scripts

```bash
npm run dev               # start the dev server
npm run build             # production build
npm run start             # run the production build
npm run lint              # ESLint
npm run test:e2e          # run Playwright end-to-end tests
npm run test:e2e:ui       # Playwright UI mode (interactive debugger)
npm run test:e2e:report   # open the last HTML test report
```

## How it works

1. **Upload** - your PDF is text-extracted with `unpdf`, structured by Claude, and saved.
2. **Search** - you pick sources, optional query, optional location. If an Apify token is set, an agentic loop lets Claude call the actors, read the results, and retry with better queries before finalizing.
3. **Score** - each job is ranked against your CV (0–100) with a one-line reason.
4. **Apply** - click Deep dive, Cover letter, or Tailor CV on any job. Outputs are cached and downloadable.
5. **Reuse** - from the CV page, generate a general polished CV and cover letter for similar roles.

## Auto Apply browser extension

The `extension/` folder is an unpacked Manifest V3 extension for Chromium-based browsers (Chrome, Edge, Brave, Arc). It autofills job application forms with your CV Radar profile and **never submits** - you review every field and click submit yourself.

### Install

1. Open `chrome://extensions` (or `edge://extensions`, `brave://extensions`).
2. Toggle **Developer mode** on.
3. Click **Load unpacked** and select the `extension/` folder.
4. Reload any open CV Radar tab.

A built-in install guide lives at `/help#extension` and is linked from the Auto Apply dialog when the extension isn't detected.

### Two ways to use it

- **From a job result.** Click **Auto Apply** on any job in CV Radar. The extension opens the apply URL in a new tab, fetches your application profile from `/api/me/application-profile` using your session cookie, and fills the form.
- **From the popup, on any page.** Some application pages need a couple of clicks before the form is visible. Once it is, click the CV Radar extension icon → **Fill this form**. The extension grabs your profile and fills whatever fields it finds, in the active tab and any embedded ATS iframes.

### What it fills

ATS-aware selectors for **Greenhouse, Lever, Ashby, Workable**, plus a heuristic fallback that matches `autocomplete`, `name`, `id`, `aria-label`, placeholder, and label text against common field types (name, email, phone, location, LinkedIn, portfolio, current company / title, summary).

### What it skips

- File uploads (CV / cover letter `.docx`) - pick those yourself
- Pages behind login walls (LinkedIn, Indeed, company SSO)
- CAPTCHA, honeypots, custom freeform questions
- Fields not present in your CV (visa sponsorship, salary expectation, EEO)

A floating badge in the bottom-right reports how many fields were filled and offers **Undo** / **Dismiss**.

## Testing

End-to-end tests use Playwright against the dev server. The current suite is a smoke layer - landing renders, login form behaves, protected routes redirect to `/login` when unauthenticated. Authenticated flows (upload CV → run search → open result) are not yet covered; they require Supabase test fixtures.

### Run

```bash
npm run test:e2e          # headless run, ~25s for the current suite
npm run test:e2e:ui       # interactive UI mode (time-travel debugger, watch)
npm run test:e2e:report   # open the last HTML report
```

`playwright.config.ts` auto-starts `npm run dev` if it isn't already running and reuses an existing dev server in local runs.

### Browser binary location

To keep the C: drive free, browser binaries are installed to `.playwright-browsers/` inside the repo (gitignored). The path is auto-set by `playwright.config.ts`. After cloning, install Chromium once:

```bash
npx playwright install chromium
```

Failures save traces and screenshots to `test-results/` (gitignored). View them with `npm run test:e2e:report`.

## Project layout

```
app/
  (app)/          Authenticated pages (dashboard, CV, search, settings, help)
  (auth)/         Sign in / sign up
  api/            Route handlers (cv, jobs, search, keys, me/application-profile)
components/       UI components (forms, dialogs, actions)
db/               Drizzle schema and client
extension/        Chromium browser extension (Auto Apply form filler)
lib/
  cv-docx.ts                Shared ATS-friendly .docx builder
  run-search.ts             Orchestrates a search end-to-end
  agentic-search.ts         Claude + Apify MCP agentic loop
  application-profile.ts    Builds the profile the extension fills with
  job-sources/              Per-source adapters
tests/
  e2e/            Playwright smoke tests (landing, login, auth-gate)
supabase/
  migrations/     Drizzle-generated SQL
```

## Notes on ATS output

Every generated `.docx` - general and job-tailored - follows ATS best practices:

- **Calibri 11pt** body, **bold-only** section headings - no italics, borders, tables, columns, text boxes, or images
- Native Word bullets; plain ASCII separators (`, ` and ` | `)
- Standard section names: Summary / Experience / Skills / Education / Certifications
- Dates in `MMM YYYY` format
- **No fabrication.** The AI uses only what is in your uploaded CV. The job-tailored CV *may* add up to 5 adjacent keywords to the skills list (e.g., PostgreSQL → MySQL, React → JSX) to improve keyword match - never new employers, dates, metrics, or certifications.

A photo placeholder is available as an opt-in toggle. Leave it off for UK / US / CA / AU applications; enable it for UAE, Germany, France, and most of the EU where a photo is conventional.

## Status

Active development. See `plans/` for in-progress design notes.
