# Agentic Job Search

**Status:** proposed
**Author:** kistlak
**Date:** 2026-04-18
**Branch base:** `feature/phase-3`

## Problem

Searching jobs via Apify MCP inside Claude Code Desktop returns excellent, well-targeted results. The same Apify actors called directly from `lib/job-sources/apify.ts` return poor or empty results for the same CV.

The difference is not the tools — it is the *control loop*.

In Desktop, Claude:
1. Reads the CV, picks a first query.
2. Calls an Apify actor.
3. Looks at what came back.
4. If weak, rewrites the query (different wording, narrower title, different country code, different actor) and tries again.
5. Keeps going until the result set is genuinely relevant, then returns it.

In this app today (`lib/run-search.ts` → `fetchAllSourcesMultiQuery`):
1. `deriveQueriesFromCv` asks Haiku for 3 queries **before seeing any results**.
2. Each query is fired once at every enabled source with fixed inputs.
3. Whatever comes back is deduped and scored.
4. There is no recovery path — a bad first guess is the final answer.

The fix is to give Claude the steering wheel: let the model call the search tools in a loop and decide when it is done.

## Goal

Replace (or augment) the current fan-out pipeline with an **agentic search loop** that mirrors what already works in Claude Desktop.

**Non-goals for this plan:**
- Redesigning the DB schema.
- Changing the CV upload / parsing flow.
- Replacing the free sources (Remotive, Adzuna, JSearch) — keep them as cheap prefilters.

## Approaches considered

### A. Anthropic MCP connector → Apify MCP server (**recommended**)

Use the `mcp_servers` parameter on the Anthropic Messages API to attach the hosted Apify MCP server directly to a Claude conversation. Claude calls Apify tools server-to-server; we never see the tool round-trips — we just get the final assistant message.

- **Pros:** Identical tool surface to Claude Desktop (same reason it already works for you). No tool shimming. Apify handles auth, pagination, actor selection.
- **Cons:** Requires `anthropic-beta: mcp-client-2025-04-04` (beta header). Per-user Apify token needs to be passed through securely. Less control over which actors are called.
- **Cost shape:** Apify per actor run + Anthropic tokens. Agent loop typically 3–8 tool calls → acceptable.

### B. Custom tool-use loop over existing `fetchApify*` functions

Define our own tools (`search_linkedin`, `search_indeed`, `search_glassdoor`, `finalize_results`), wire them to the existing `fetchApifyLinkedIn` / `fetchApifyIndeed` / `fetchApifyGlassdoor` helpers, and run a `while stop_reason === 'tool_use'` loop with the Anthropic SDK.

- **Pros:** No beta header. Full control over which actors run and with what inputs. Easier to cost-cap (hard limit N iterations). Reuses code already written.
- **Cons:** We reimplement what Apify MCP already does well (query refinement prompts, result inspection hints). More prompt engineering on our side.

### C. Skip agent, just add a retry/refine layer

After the first pass, if result count or average score is low, re-derive queries with feedback (`"these queries returned nothing useful — try again"`).

- **Pros:** Smallest change.
- **Cons:** Still not truly agentic — Claude only sees scores, not raw results. Unlikely to close the Desktop-vs-app gap.

### Decision

Ship **A** first. It is the smallest change that matches the behavior you already verified in Desktop. Keep **B** as a fallback if the beta connector is unreliable or the per-token pass-through turns out to be awkward with user-supplied Apify keys.

## Architecture

```
POST /api/search
   └─ inserts searches row (status: running)
   └─ after() → runSearch(searchId, userId)
                    │
                    ├─ [cheap prefilter] fetchAllSourcesMultiQuery(
                    │     queries=[derived_primary],
                    │     sources=['remotive','adzuna','jsearch'])
                    │     → gives us 0–N free results
                    │
                    ├─ [agentic pass]   runAgenticSearch(
                    │     cv, userQuery, location, remoteOnly,
                    │     anthropicKey, apifyToken)
                    │     → returns curated RawJob[] from LinkedIn/Indeed/Glassdoor
                    │
                    ├─ scoreJobs(all, cv, query)   // unchanged
                    └─ persist jobResults, mark search complete
```

The agentic pass replaces only the Apify portion of `fetchAllSourcesMultiQuery`. Free sources remain deterministic because they are fast, cheap, and decent as a baseline.

## Implementation steps

### 1. Configuration

- Add env vars (documented, not required in all envs):
  - `APIFY_MCP_URL` — default `https://mcp.apify.com/` (confirm exact URL from Apify docs before shipping).
  - `AGENT_MODEL` — default `claude-sonnet-4-6`. Sonnet is the right tier: Haiku will not plan multi-step searches well; Opus is overkill and expensive.
  - `AGENT_MAX_ITERATIONS` — default `8` (hard stop).
- Apify token continues to come from `user_api_keys.apifyToken`, passed per-request.

### 2. New file: `lib/agentic-search.ts`

Exports a single function:

```ts
export async function runAgenticSearch(input: {
  cvText: string
  userQuery: string            // may be empty
  location?: string
  remoteOnly: boolean
  anthropicKey: string
  apifyToken: string
  onEvent?: (e: AgentEvent) => void  // for progress streaming (step 5)
}): Promise<RawJob[]>
```

Internally:
1. Build a system prompt: "You are a job-search agent. Your goal is to return 15–30 genuinely relevant, recent job postings that match the candidate's CV and target role. Use Apify tools. Iterate: try a query, inspect results, refine if weak. Stop when you have a strong set. Return final answer as JSON matching the schema in `finalize_jobs`."
2. Build a user message with the CV (trimmed to ~6k chars), the user query (or "not specified — infer from CV"), location, remote preference.
3. Call `client.messages.create({ model, mcp_servers: [{ type: 'url', url: APIFY_MCP_URL, name: 'apify', authorization_token: apifyToken }], tools: [finalize_jobs_tool], ... })` with the beta header.
4. Loop while `stop_reason === 'tool_use'`:
   - If the tool call is `finalize_jobs`, parse the payload, exit loop, return jobs.
   - Otherwise append the assistant turn + tool_result(s) (MCP tool_results come back in the assistant response; the loop mostly just continues the conversation).
   - Break after `AGENT_MAX_ITERATIONS`.
5. Map the finalized payload into `RawJob[]`. Tag `source` as `linkedin|indeed|glassdoor|other` so scoring and dedupe still work.

The `finalize_jobs` tool is our own local tool — its only job is to make Claude emit a structured result at the end.

### 3. Wire into `runSearch`

In `lib/run-search.ts`:

- Behind a feature flag on the search row (`searches.mode: 'classic' | 'agentic'`, default `agentic`; add as a nullable text column so existing rows stay valid). Schema change: add `mode` column via a new Drizzle migration.
- If `mode === 'agentic'` and user has an `apifyToken`, call `runAgenticSearch` for Apify sources and skip `linkedin|indeed|glassdoor` in `fetchAllSourcesMultiQuery`.
- Merge agentic results with cheap-source results, dedupe via existing `dedupeJobs`, then `scoreJobs` as today.

### 4. API surface

`app/api/search/route.ts`:
- Accept optional `mode` in the request body (`'classic' | 'agentic'`, default `'agentic'`).
- Persist on the `searches` row.

### 5. Progress streaming (nice-to-have, not blocking)

Agentic runs can take 30–90s. The existing `search-poller.tsx` polls `GET /api/search?id=...`. Extend the row with a `progress` jsonb column containing `{ stage, currentQuery, iterationsUsed, jobsFound }` and update it inside `onEvent`. If too much scope, ship without it and rely on `status: running` → `complete`.

### 6. Guardrails

- `AGENT_MAX_ITERATIONS` hard stop.
- Token budget: cap `max_tokens` at 4096 per turn; if the loop exceeds 10 turns, finalize with whatever the agent has gathered so far.
- If `runAgenticSearch` throws or times out (60s overall wall clock), fall back to the current fan-out pipeline so the search still completes.
- Never log the Apify token or the raw Anthropic key.

### 7. Testing

- Manual: upload the same CV that works in Desktop. Run an agentic search with empty `query`. Verify result count and relevance ≈ Desktop.
- Manual: user-specified tight query ("Senior Laravel Berlin"). Verify agent honors it rather than drifting.
- Manual: bad/missing Apify token → agent path is skipped, classic path runs, search still completes.
- Unit: `runAgenticSearch` with a mocked Anthropic client returning a canned `finalize_jobs` tool call — assert the `RawJob[]` shape.

## Open questions

1. **Exact Apify MCP URL and auth format.** Confirm from Apify's MCP docs whether the token goes in `authorization_token` on the connector, or as a header, or whether each tool takes a token argument. This is the single biggest unknown before coding. If MCP connector doesn't accept per-call tokens cleanly, fall back to Approach B.
2. **Does `mcp_servers` support per-user tokens in the same process?** If Anthropic caches the MCP session per server URL, multi-tenant use may need the token in the URL (`https://mcp.apify.com/?token=...`) rather than the `authorization_token` field.
3. **Do we trust Claude's job list verbatim, or still run `scoreJobs` on top?** Recommendation: still run `scoreJobs`. The agent finds and curates; `scoreJobs` is our own trust layer and sorts the UI.

## Out of scope

- Streaming the agent's intermediate thoughts to the UI.
- Allowing Claude to write to the DB directly.
- Swapping the scoring model.
- Adding new free sources.

## Rollout

1. Land schema migration (add `mode` column) — harmless on its own.
2. Land `lib/agentic-search.ts` behind feature flag; default `classic` initially.
3. Flip default to `agentic` after one clean manual run on your own CV.
4. Remove `classic` path after a week of stable usage (or keep as fallback).
