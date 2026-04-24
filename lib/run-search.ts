import { getDecryptedKeys } from '@/app/api/keys/route'
import { db } from '@/db'
import { cvs, jobResults, searches } from '@/db/schema'
import { desc, eq } from 'drizzle-orm'
import { runAgenticSearch } from './agentic-search'
import { deriveQueriesFromCv } from './derive-query'
import { dedupeJobs, fetchAllSourcesMultiQuery } from './job-sources'
import type { RawJob } from './job-sources/types'
import { scoreJobs } from './score-jobs'
import { createProgressUpdater } from './search-progress'

const AGENT_ENABLED = process.env.AGENT_ENABLED !== 'false'
const APIFY_SOURCES = new Set(['linkedin', 'indeed', 'glassdoor'])

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
    if (!keys?.anthropicKey) throw new Error('Anthropic key not configured')

    // Build the query list.
    // - If user provided a query → use it directly (predictable behavior).
    // - If blank → derive 3 complementary queries from the CV (Level 1).
    let queries: string[]
    const userQuery = search.query.trim()
    if (userQuery) {
      queries = [userQuery]
    } else {
      await setProgress({ stage: 'deriving-queries' })
      queries = await deriveQueriesFromCv(cv.rawText, keys.anthropicKey, 3)
      console.log(`[run-search] auto-matched queries from CV: ${JSON.stringify(queries)}`)
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
    const selectedApify = search.sources.filter((s) => APIFY_SOURCES.has(s))
    const useAgentic =
      AGENT_ENABLED && !!keys.apifyToken && selectedApify.length > 0

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
      ? runAgenticSearch({
          cvText: cv.rawText,
          userQuery: primaryQuery,
          location: search.location ?? undefined,
          remoteOnly: search.remoteOnly,
          maxResults: search.maxResults,
          anthropicKey: keys.anthropicKey,
          apifyToken: keys.apifyToken!,
          onEvent: async (e) => {
            if (e.type === 'mcp_calls') {
              await setProgress({ agenticMcpCalls: e.count })
            }
          },
        })
          .then(async (jobs) => {
            await setProgress({ agenticDone: true, agenticCount: jobs.length })
            return jobs
          })
          .catch(async (err) => {
            console.error('[run-search] agentic path failed, falling back to empty:', err)
            await setProgress({ agenticDone: true, agenticCount: 0 })
            return [] as RawJob[]
          })
      : Promise.resolve<RawJob[]>([])

    const [cheapJobs, agenticJobs] = await Promise.all([
      cheapJobsPromise,
      agenticJobsPromise,
    ])
    const rawJobs = dedupeJobs([...cheapJobs, ...agenticJobs])
    console.log(
      `[run-search] cheap=${cheapJobs.length} agentic=${agenticJobs.length} → ${rawJobs.length} after dedupe`
    )

    if (await isCancelled(searchId)) {
      console.log(`[run-search] ${searchId} cancelled before scoring - bailing`)
      return
    }

    if (rawJobs.length === 0) {
      await db
        .update(searches)
        .set({ status: 'complete', completedAt: new Date() })
        .where(eq(searches.id, searchId))
      return
    }

    await setProgress({ stage: 'scoring', totalJobs: rawJobs.length })
    const allScored = await scoreJobs(rawJobs, cv.rawText, primaryQuery, keys.anthropicKey)
    // Respect the user's job-count preference by keeping the top-scoring N after scoring.
    const scoredJobs = search.maxResults
      ? [...allScored].sort((a, b) => b.matchScore - a.matchScore).slice(0, search.maxResults)
      : allScored

    if (await isCancelled(searchId)) {
      console.log(`[run-search] ${searchId} cancelled after scoring - skipping persistence`)
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
  } catch (err) {
    console.error('[runSearch] failed:', err)
    if (await isCancelled(searchId)) return
    await db
      .update(searches)
      .set({
        status: 'failed',
        error: err instanceof Error ? err.message : 'Unknown error',
        completedAt: new Date(),
      })
      .where(eq(searches.id, searchId))
  }
}
