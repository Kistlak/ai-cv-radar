# Phase 6 — Search UI

**Status:** NOT STARTED
**Depends on:** Phase 5 complete and verified
**Goal:** Search form, results table with sort/filter, history view, dashboard recent searches.

## Steps

### Step 1 — Search Form Component
File: `src/components/search-form.tsx`
- Fields:
  - Job title / keywords (required, text input)
  - Location (optional, text input)
  - Remote only (checkbox)
  - Sources (multiselect, default: all sources user has keys for)
    - Show only sources the user has configured keys for
    - Remotive always available (no key needed)
- Submit button: "Search Jobs"
- react-hook-form + Zod resolver

### Step 2 — Loading State with Per-Source Progress
- On form submit: show loading overlay
- Display per-source status in real-time:
  - "Searching Remotive... ✓"
  - "Searching LinkedIn... ⏳"
  - "Searching Indeed... ✗ (failed)"
- Use polling GET /api/search/{id} every 2s, or use streaming response
  (v1: polling is simpler, matches spec intent)

### Step 3 — Results Table Component
File: `src/components/results-table.tsx`
- Columns: Match Score | Title | Company | Location | Source | Posted | Apply
- Default sort: match_score DESC
- Sortable columns (click header to sort)
- "Apply" column: external link button opening `apply_url` in new tab
- Expandable row: click to reveal match_reason + description snippet
- Filter bar (above table):
  - Source filter (multiselect)
  - Min match score slider (0–100, default 0)
  - Remote only toggle
- Match score displayed as colored badge:
  - 80–100: green
  - 60–79: yellow
  - < 60: gray/red
- Source displayed as badge with icon

### Step 4 — /search Page
File: `src/app/(app)/search/page.tsx`
- Shows `SearchForm` at top
- On search complete, renders `ResultsTable` below
- Shows error messages for failed sources
- Empty state: "No jobs found — try broader keywords or more sources"

### Step 5 — /search/[id] History View
File: `src/app/(app)/search/[id]/page.tsx`
- Fetch search + results from GET /api/search/{id}
- Display search params as header (query, location, date)
- Render `ResultsTable` with cached results
- Show "Cached results from {date}" banner
- No re-scraping

### Step 6 — Dashboard Updates
File: `src/app/(app)/dashboard/page.tsx`
- Card 1: CV status ("Upload CV" or "View CV: {name}")
- Card 2: API Keys status (✓ Anthropic set, ✗ Apify missing, etc.)
- Card 3: "New Search" CTA — disabled with tooltip if CV or Anthropic key missing
- Recent searches list (last 5): query, date, job count, link to /search/{id}

## Verify
- Full user flow works in browser end-to-end:
  1. Log in → dashboard
  2. Upload CV → see parsed result
  3. Set API keys → settings
  4. Run search → see loading state → see ranked results table
  5. Click Apply → opens correct external URL in new tab
  6. Click row → see match reason + description
  7. Filter by source → table updates
  8. Visit /search/{id} → same results, no re-scrape
  9. Dashboard shows recent searches list
