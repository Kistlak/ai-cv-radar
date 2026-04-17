# Phase 7 — Polish & Deploy

**Status:** NOT STARTED
**Depends on:** Phase 6 complete and verified
**Goal:** Error boundaries, toasts, skeletons, help page, Vercel deploy, production verify.

## Steps

- [ ] 1. Error boundaries on every page
  - Create `src/components/error-boundary.tsx` (React class component)
  - Wrap each `(app)` page in error boundary
  - Show friendly error card with "Try again" button

- [ ] 2. Toast notifications (sonner) for all mutations
  - CV upload: success / failure
  - API key save: success / failure
  - Search start: "Searching jobs..."
  - Search complete: "Found {n} jobs"
  - Source errors: "LinkedIn search failed — results from other sources shown"

- [ ] 3. Loading skeletons
  - CV page: skeleton while fetching current CV
  - Search results: skeleton rows while waiting
  - Dashboard: skeleton cards on load

- [ ] 4. Empty states for each page
  - Dashboard: "Upload your CV and add API keys to start searching"
  - CV page: "No CV uploaded yet — drag and drop a PDF below"
  - Search history: "No searches yet — run your first search above"

- [ ] 5. Help page — /help
  File: `src/app/(app)/help/page.tsx`
  Step-by-step guides for:
  - Getting Anthropic API key (console.anthropic.com)
  - Getting Apify token (console.apify.com/account/integrations)
  - Getting Adzuna keys (developer.adzuna.com)
  - Getting RapidAPI/JSearch key (rapidapi.com)
  - Note about Remotive (no key needed, remote jobs only)

- [ ] 6. Deploy to Vercel
  - Push repo to GitHub
  - Connect to Vercel
  - Add all env vars in Vercel dashboard
  - Update Supabase "Site URL" and "Redirect URLs" to production domain
  - Update `NEXT_PUBLIC_APP_URL` to production URL

- [ ] 7. Production verification
  - Full flow with real CV and real keys on production
  - Magic link login works
  - CV upload and parse works
  - At least one search source returns results
  - Apply links open correctly

## README Sections to Write
- What it is
- Getting started (Supabase setup, env vars, npm install, dev server)
- How to get API keys (link to /help)
- Known limitations:
  - LinkedIn/Indeed scraping via Apify may fail when source sites change
  - Claude match scores are subjective
  - Free API tiers are limited (JSearch 200/mo, Adzuna throttled)
  - Apify run timeout 90s per source — broad searches may be truncated
  - Scraping LinkedIn/Indeed may violate their ToS — personal use only

## Verify (Testing Checklist)
- [ ] User can sign up with a new email
- [ ] User can set all key types (Anthropic, Apify, Adzuna, JSearch)
- [ ] Keys are encrypted in DB (verify in Supabase table editor)
- [ ] Upload 2-page PDF CV → structured JSON is correct
- [ ] Search with only Remotive (free, no key) returns results
- [ ] Search with Apify-LinkedIn returns results
- [ ] Search with all sources returns deduplicated, ranked results
- [ ] Invalid Apify token → search completes with free sources + shows LinkedIn error
- [ ] Match scores look reasonable (senior jobs score lower for junior CVs)
- [ ] Apply links open correct external page in new tab
- [ ] Revisit /search/{id} → cached results, no re-scrape
- [ ] Account B cannot access Account A's searches
- [ ] Production deploy on Vercel works end-to-end
