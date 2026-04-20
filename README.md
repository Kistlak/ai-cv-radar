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
npm run dev      # start the dev server
npm run build    # production build
npm run start    # run the production build
npm run lint     # ESLint
```

## How it works

1. **Upload** - your PDF is text-extracted with `unpdf`, structured by Claude, and saved.
2. **Search** - you pick sources, optional query, optional location. If an Apify token is set, an agentic loop lets Claude call the actors, read the results, and retry with better queries before finalizing.
3. **Score** - each job is ranked against your CV (0–100) with a one-line reason.
4. **Apply** - click Deep dive, Cover letter, or Tailor CV on any job. Outputs are cached and downloadable.
5. **Reuse** - from the CV page, generate a general polished CV and cover letter for similar roles.

## Project layout

```
app/
  (app)/          Authenticated pages (dashboard, CV, search, settings)
  (auth)/         Sign in / sign up
  api/            Route handlers (cv, jobs, search, keys)
components/       UI components (forms, dialogs, actions)
db/               Drizzle schema and client
lib/
  cv-docx.ts      Shared ATS-friendly .docx builder
  run-search.ts   Orchestrates a search end-to-end
  agentic-search.ts   Claude + Apify MCP agentic loop
  job-sources/    Per-source adapters
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
