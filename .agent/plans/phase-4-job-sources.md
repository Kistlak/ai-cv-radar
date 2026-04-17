# Phase 4 — Job Sources

**Status:** NOT STARTED
**Depends on:** Phase 3 complete and verified
**Goal:** Build all 6 job source modules (easiest first), unified runner, dedup logic.

## Shared Type (src/lib/types.ts)
```typescript
export type JobSource = 'linkedin' | 'indeed' | 'glassdoor' | 'adzuna' | 'jsearch' | 'remotive'

export type NormalizedJob = {
  source: JobSource
  sourceJobId?: string
  title: string
  company: string
  location?: string
  remote: boolean
  salary?: string
  postedAt?: Date
  description?: string
  applyUrl: string  // required
}

export type SearchParams = {
  query: string
  location?: string
  remoteOnly?: boolean
}

export type UserKeys = {
  anthropicKey?: string
  apifyToken?: string
  adzunaAppId?: string
  adzunaAppKey?: string
  rapidApiKey?: string
}
```

## Implementation Order (easiest → hardest)

### Step 1 — Remotive (no key needed)
File: `src/lib/job-sources/remotive.ts`
- Endpoint: `https://remotive.com/api/remote-jobs?search={query}&limit=50`
- No auth needed
- Remote-only jobs; set `remote: true` always
- Map response fields to `NormalizedJob`

### Step 2 — Adzuna
File: `src/lib/job-sources/adzuna.ts`
- Endpoint: `https://api.adzuna.com/v1/api/jobs/{country}/search/1`
  - Default country: `gb` (supports `us`, `au`, etc.)
- Params: `app_id`, `app_key`, `what` (query), `where` (location), `results_per_page=50`
- Map response fields to `NormalizedJob`
- `applyUrl` = `redirect_url` field

### Step 3 — JSearch (RapidAPI)
File: `src/lib/job-sources/jsearch.ts`
- Endpoint: `https://jsearch.p.rapidapi.com/search`
- Headers: `X-RapidAPI-Key: {rapidApiKey}`, `X-RapidAPI-Host: jsearch.p.rapidapi.com`
- Params: `query`, `page=1`, `num_pages=1`
- Map `job_apply_link` to `applyUrl`

### Step 4 — Apify LinkedIn
File: `src/lib/job-sources/apify-linkedin.ts`
- Actor ID (default): `bebity/linkedin-jobs-scraper` (configurable via env `APIFY_LINKEDIN_ACTOR`)
- Input payload: `{ keywords: query, location, limit: 25 }`
- Call pattern:
  ```typescript
  const run = await apifyClient.actor(actorId).call(input, { timeout: 90, memory: 1024 })
  const { items } = await apifyClient.dataset(run.defaultDatasetId).listItems()
  ```
- Map `applyUrl` from `jobUrl` or `applyUrl` field

### Step 5 — Apify Indeed
File: `src/lib/job-sources/apify-indeed.ts`
- Actor ID (default): `misceres/indeed-scraper` (configurable via env `APIFY_INDEED_ACTOR`)
- Input: `{ position: query, location, maxItems: 25 }`

### Step 6 — Apify Glassdoor
File: `src/lib/job-sources/apify-glassdoor.ts`
- Actor ID (default): `bebity/glassdoor-jobs-scraper` (configurable via env `APIFY_GLASSDOOR_ACTOR`)
- Input: `{ keyword: query, location, maxItems: 25 }`

## Unified Runner
File: `src/lib/job-sources/index.ts`
```typescript
export async function runJobSearch(
  params: SearchParams,
  userKeys: UserKeys,
  enabledSources: JobSource[]
): Promise<{ results: NormalizedJob[], errors: Partial<Record<JobSource, string>> }>
```
- Call all enabled sources in parallel with `Promise.allSettled`
- On rejection: record error for that source, continue with others
- Return all successful results + error map

## Deduplication
File: `src/lib/dedupe.ts`
- Key = `normalize(title) + "|" + normalize(company) + "|" + normalize(location ?? "")`
- `normalize` = lowercase, strip punctuation, collapse whitespace
- Source priority: linkedin > indeed > glassdoor > adzuna > jsearch > remotive
- If same job appears from multiple sources: keep highest-priority source's data

## Test Scripts
File: `scripts/test-source.ts` — write once, reuse per source:
```
npx tsx scripts/test-source.ts remotive "software engineer"
```

## Verify (after each source)
- Remotive returns NormalizedJob[] for "software engineer"
- Adzuna returns results with apply URLs
- JSearch returns results (check RapidAPI quota)
- Apify LinkedIn returns results (requires valid Apify token)
- Apify Indeed returns results
- Apify Glassdoor returns results
- runJobSearch with all sources returns deduplicated list
- If one source throws, others still return results
