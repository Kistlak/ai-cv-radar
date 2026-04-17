# Phase 5 — Matching + Search Endpoint

**Status:** NOT STARTED
**Depends on:** Phase 4 complete and verified
**Goal:** Claude-based job ranking, full /api/search pipeline, search history endpoint.

## Steps

### Step 1 — lib/matcher.ts (Claude job ranking)
- Input: `NormalizedJob[]` + structured CV JSON
- Batch jobs in groups of 20
- For each batch, call Claude:
  - System: `"You are a career advisor. Score how well each job matches the candidate's CV
    from 0–100, and give a one-sentence reason. Return JSON array [{id, score, reason}].
    Be honest; reject poor matches with low scores."`
  - User: `{ cv: {...}, jobs: [{id, title, company, description}, ...] }`
- Parse JSON, validate with Zod, retry up to 2x on parse failure
- Merge scores back onto jobs
- Sort DESC by score
- Instantiate `new Anthropic({ apiKey: userKey })` per request

### Step 2 — /api/search POST (full pipeline)
File: `src/app/api/search/route.ts`

Pipeline:
1. Auth check → 401 if not authenticated
2. Validate request body with Zod: `{ query: string, location?: string, remoteOnly?: boolean, sources?: JobSource[] }`
3. Load user's active CV from DB → 400 if none
4. Load user's decrypted API keys
5. **Idempotency check**: look for existing search with same `(user_id, query, location, sources_hash)` within last 10 minutes → return cached if found
6. Create `searches` row with `status = "running"`
7. Call `runJobSearch(params, userKeys, enabledSources)`
8. Deduplicate results with `dedupe.ts`
9. Call `matcher.ts` to rank all jobs
10. Bulk insert ranked jobs into `job_results`
11. Update `searches` row: `status = "complete"`, `completed_at = now()`
12. Return `{ searchId, results, errors }` (errors = sources that failed)

Error handling:
- If matcher fails: mark search `status = "failed"`, return error
- If all sources fail: mark search `status = "failed"`, return error
- If partial source failure: complete normally, include `errors` in response

### Step 3 — /api/search/[id] GET
File: `src/app/api/search/[id]/route.ts`
- Auth check
- Fetch search by ID where `user_id = auth.uid()` (RLS)
- Return `{ search, results }` sorted by match_score DESC
- 404 if not found or not owned by user

## Zod Schemas
```typescript
const SearchRequestSchema = z.object({
  query: z.string().min(1).max(200),
  location: z.string().max(100).optional(),
  remoteOnly: z.boolean().default(false),
  sources: z.array(JobSourceSchema).optional(),
})

const MatchResultSchema = z.array(z.object({
  id: z.string(),
  score: z.number().int().min(0).max(100),
  reason: z.string(),
}))
```

## Idempotency Key
```typescript
const sourcesHash = createHash('md5')
  .update(sources.sort().join(','))
  .digest('hex')
// Check: SELECT * FROM searches WHERE user_id=$1 AND query=$2 
//   AND location=$3 AND sources_hash=$4 
//   AND created_at > now() - interval '10 minutes'
//   AND status = 'complete'
```
Note: add `sources_hash` column to `searches` schema.

## Verify
- POST /api/search with valid body → returns ranked jobs
- Scores look reasonable (relevant jobs score 70+, irrelevant score < 40)
- Same search within 10 min returns cached result (no new DB rows)
- Source failure (bad Apify token) → still returns free API results
- GET /api/search/{id} returns correct results
- GET /api/search/{id} with another user's ID → 404
