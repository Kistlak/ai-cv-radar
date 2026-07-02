import { getDecryptedKeys } from '@/app/api/keys/route'
import { db } from '@/db'
import { cvs, jobResults, searches } from '@/db/schema'
import { desc, eq } from 'drizzle-orm'
import { createAiClient, resolveProvider } from './ai/provider'
import { runAgenticSearch } from './agentic-search'
import { deriveQueriesFromCv } from './derive-query'
import { dedupeJobs, fetchAllSourcesMultiQuery } from './job-sources'
import type { RawJob } from './job-sources/types'
import { logger } from './logger'
import { scoreJobs } from './score-jobs'
import { createProgressUpdater } from './search-progress'

const AGENT_ENABLED = process.env.AGENT_ENABLED !== 'false'
const APIFY_SOURCES = new Set(['linkedin', 'indeed', 'glassdoor'])
// Hard budget for the agentic Claude+Apify call. It must finish comfortably
// inside the route's maxDuration (300s) or Vercel kills the whole pipeline and
// the search is stranded in 'running'. On timeout we abort the request and
// continue with the cheap-source jobs instead.
const AGENTIC_TIMEOUT_MS = Number(process.env.AGENTIC_TIMEOUT_MS || 210_000)

async function isCancelled(searchId: string): Promise<boolean> {
  const [row] = await db
    .select({ status: searches.status })
    .from(searches)
    .where(eq(searches.id, searchId))
    .limit(1)
  return row?.status === 'cancelled'
}

export async function runSearch(searchId: string, userId: string): Promise<void> {
  const setProgress = createProgressUpdater(searchId)
  const t0 = Date.now()
  logger.info({ event: 'run_search.started', searchId, userId })
  try {
    const [search] = await db
      .select()
      .from(searches)
      .where(eq(searches.id, searchId))
      .limit(1)
    if (!search) throw new Error('Search not found')

    const [cv] = await db
      .select()
      .from(cvs)
      .where(eq(cvs.userId, userId))
      .orderBy(desc(cvs.createdAt))
      .limit(1)
    if (!cv) throw new Error('No CV found for user')

    const keys = await getDecryptedKeys(userId)
    const resolved = resolveProvider(keys.preferredAiProvider, keys)
    if (!resolved) throw new Error('Add an Anthropic or Gemini API key in Settings')
    const ai = createAiClient(resolved.provider, resolved.apiKey)

    // Build the query list.
    // - If user provided a query → use it directly (predictable behavior).
    // - If blank → derive 3 complementary queries from the CV (Level 1).
    let queries: string[]
    const userQuery = search.query.trim()
    if (userQuery) {
      queries = [userQuery]
    } else {
      await setProgress({ stage: 'deriving-queries' })
      const tDerive = Date.now()
      queries = await deriveQueriesFromCv(cv.rawText, ai, 3)
      logger.info({
        event: 'run_search.queries_derived',
        searchId,
        provider: ai.provider,
        queries,
        ms: Date.now() - tDerive,
      })
      // Persist the primary derived query so the UI shows something sensible.
      await db
        .update(searches)
        .set({ query: queries[0] })
        .where(eq(searches.id, searchId))
    }

    // Scoring context uses the primary query.
    const primaryQuery = queries[0]

    // Decide whether to use the agentic path for Apify sources.
    // Conditions: feature enabled + user has an Apify token + at least one Apify-backed source was selected.
    // Agentic uses Claude MCP tool-use, so it also requires an Anthropic key regardless of the
    // user's preferred provider — Gemini can't drive this path today.
    const selectedApify = search.sources.filter((s) => APIFY_SOURCES.has(s))
    const useAgentic =
      AGENT_ENABLED &&
      !!keys.apifyToken &&
      !!keys.anthropicKey &&
      selectedApify.length > 0

    // If agentic: classic fan-out only for cheap sources; agentic handles Apify.
    // Else: classic fan-out handles everything as before.
    const cheapSources = useAgentic
      ? search.sources.filter((s) => !APIFY_SOURCES.has(s))
      : search.sources

    await setProgress({
      stage: 'fetching',
      queries,
      cheapSources,
      agentic: useAgentic,
    })
    const tFetch = Date.now()
    logger.info({
      event: 'run_search.fetch_started',
      searchId,
      cheapSources,
      useAgentic,
      queryCount: queries.length,
    })

    const cheapJobsPromise = fetchAllSourcesMultiQuery(
      queries,
      {
        location: search.location ?? undefined,
        remoteOnly: search.remoteOnly,
      },
      {
        apifyToken: keys.apifyToken,
        adzunaAppId: keys.adzunaAppId,
        adzunaAppKey: keys.adzunaAppKey,
        rapidapiKey: keys.rapidapiKey,
      },
      cheapSources
    ).then(async (jobs) => {
      await setProgress({ cheapDone: true, cheapCount: jobs.length })
      return jobs
    })

    const agenticJobsPromise: Promise<RawJob[]> = useAgentic
      ? (async () => {
          const controller = new AbortController()
          const timer = setTimeout(() => controller.abort(), AGENTIC_TIMEOUT_MS)
          let jobs: RawJob[] = []
          try {
            jobs = await runAgenticSearch({
              cvText: cv.rawText,
              userQuery: primaryQuery,
              location: search.location ?? undefined,
              remoteOnly: search.remoteOnly,
              maxResults: search.maxResults,
              anthropicKey: keys.anthropicKey!,
              apifyToken: keys.apifyToken!,
              signal: controller.signal,
              onEvent: async (e) => {
                if (e.type === 'mcp_calls') {
                  await setProgress({ agenticMcpCalls: e.count })
                }
              },
            })
          } catch (err) {
            if (controller.signal.aborted) {
              logger.warn({
                event: 'run_search.agentic_timeout',
                searchId,
                timeoutMs: AGENTIC_TIMEOUT_MS,
              })
            } else {
              logger.error({ event: 'run_search.agentic_failed', searchId, err })
            }
          } finally {
            clearTimeout(timer)
          }
          await setProgress({ agenticDone: true, agenticCount: jobs.length })
          return jobs
        })()
      : Promise.resolve<RawJob[]>([])

    const [cheapJobs, agenticJobs] = await Promise.all([
      cheapJobsPromise,
      agenticJobsPromise,
    ])
    const rawJobs = dedupeJobs([...cheapJobs, ...agenticJobs])
    logger.info({
      event: 'run_search.fetch_completed',
      searchId,
      cheap: cheapJobs.length,
      agentic: agenticJobs.length,
      deduped: rawJobs.length,
      ms: Date.now() - tFetch,
    })

    if (await isCancelled(searchId)) {
      logger.warn({ event: 'run_search.cancelled', searchId, phase: 'before-scoring' })
      return
    }

    if (rawJobs.length === 0) {
      logger.info({ event: 'run_search.completed', searchId, scoredJobs: 0, ms: Date.now() - t0 })
      await db
        .update(searches)
        .set({ status: 'complete', completedAt: new Date() })
        .where(eq(searches.id, searchId))
      return
    }

    await setProgress({ stage: 'scoring', totalJobs: rawJobs.length })
    const tScore = Date.now()
    const allScored = await scoreJobs(rawJobs, cv.rawText, primaryQuery, ai)
    logger.info({
      event: 'run_search.scoring_completed',
      searchId,
      provider: ai.provider,
      scored: allScored.length,
      ms: Date.now() - tScore,
    })
    // Respect the user's job-count preference by keeping the top-scoring N after scoring.
    const scoredJobs = search.maxResults
      ? [...allScored].sort((a, b) => b.matchScore - a.matchScore).slice(0, search.maxResults)
      : allScored

    if (await isCancelled(searchId)) {
      logger.warn({ event: 'run_search.cancelled', searchId, phase: 'after-scoring' })
      return
    }

    await setProgress({ stage: 'persisting', scoredJobs: scoredJobs.length })

    if (scoredJobs.length > 0) {
      await db
        .insert(jobResults)
        .values(
          scoredJobs.map((job) => ({
            searchId,
            source: job.source,
            sourceJobId: job.sourceJobId,
            title: job.title,
            company: job.company,
            location: job.location,
            remote: job.remote,
            salary: job.salary,
            postedAt: job.postedAt,
            description: job.description,
            applyUrl: job.applyUrl,
            matchScore: job.matchScore,
            matchReason: job.matchReason,
          }))
        )
        .onConflictDoNothing()
    }

    if (await isCancelled(searchId)) return

    await db
      .update(searches)
      .set({ status: 'complete', completedAt: new Date() })
      .where(eq(searches.id, searchId))
    logger.info({
      event: 'run_search.completed',
      searchId,
      scoredJobs: scoredJobs.length,
      ms: Date.now() - t0,
    })
  } catch (err) {
    logger.error({ event: 'run_search.failed', searchId, err, ms: Date.now() - t0 })
    if (!(await isCancelled(searchId))) {
      await db
        .update(searches)
        .set({
          status: 'failed',
          error: err instanceof Error ? err.message : 'Unknown error',
          completedAt: new Date(),
        })
        .where(eq(searches.id, searchId))
    }
  } finally {
    // Flush any in-flight Axiom ships before the serverless function ends,
    // otherwise the final events (completed/failed) get dropped.
    await logger.flush()
  }
}
