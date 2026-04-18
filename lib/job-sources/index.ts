import type { RawJob, SearchParams } from './types'
import { fetchAdzuna } from './adzuna'
import { fetchJSearch } from './jsearch'
import { fetchRemotive } from './remotive'
import { fetchApifyLinkedIn, fetchApifyIndeed, fetchApifyGlassdoor } from './apify'

export type { RawJob, SearchParams }

export interface Keys {
  apifyToken?: string
  adzunaAppId?: string
  adzunaAppKey?: string
  rapidapiKey?: string
}

// Sources that are cheap/free — safe to run for every derived query.
// Apify sources cost money per actor run, so we only use them for the primary query.
const CHEAP_SOURCES = new Set(['remotive', 'adzuna', 'jsearch'])

async function safeCall<T extends RawJob[]>(
  label: string,
  fn: () => Promise<T>
): Promise<RawJob[]> {
  try {
    return await fn()
  } catch (err) {
    console.error(`[${label}] failed:`, err instanceof Error ? err.message : err)
    return []
  }
}

export async function fetchSources(
  params: SearchParams,
  keys: Keys,
  enabledSources: string[]
): Promise<RawJob[]> {
  const enabled = new Set(enabledSources)
  const tasks: Promise<RawJob[]>[] = []

  if (enabled.has('remotive')) {
    tasks.push(safeCall('remotive', () => fetchRemotive(params)))
  }
  if (enabled.has('adzuna') && keys.adzunaAppId && keys.adzunaAppKey) {
    tasks.push(safeCall('adzuna', () => fetchAdzuna(params, keys.adzunaAppId!, keys.adzunaAppKey!)))
  }
  if (enabled.has('jsearch') && keys.rapidapiKey) {
    tasks.push(safeCall('jsearch', () => fetchJSearch(params, keys.rapidapiKey!)))
  }
  if (enabled.has('linkedin') && keys.apifyToken) {
    tasks.push(safeCall('apify-linkedin', () => fetchApifyLinkedIn(params, keys.apifyToken!)))
  }
  if (enabled.has('indeed') && keys.apifyToken) {
    tasks.push(safeCall('apify-indeed', () => fetchApifyIndeed(params, keys.apifyToken!)))
  }
  if (enabled.has('glassdoor') && keys.apifyToken) {
    tasks.push(safeCall('apify-glassdoor', () => fetchApifyGlassdoor(params, keys.apifyToken!)))
  }

  const results = await Promise.all(tasks)
  return results.flat()
}

function dedupeKey(job: RawJob): string {
  // Same job title + company across sources/queries is almost certainly the same role.
  const t = job.title.toLowerCase().replace(/\s+/g, ' ').trim()
  const c = job.company.toLowerCase().replace(/\s+/g, ' ').trim()
  return `${t}|${c}`
}

export function dedupeJobs(jobs: RawJob[]): RawJob[] {
  const seen = new Map<string, RawJob>()
  for (const job of jobs) {
    const key = dedupeKey(job)
    const existing = seen.get(key)
    // Prefer the entry with more info (description + salary).
    const score = (j: RawJob) => (j.description ? 2 : 0) + (j.salary ? 1 : 0)
    if (!existing || score(job) > score(existing)) seen.set(key, job)
  }
  return Array.from(seen.values())
}

/**
 * Run all enabled sources across multiple queries in parallel.
 * Primary query (queries[0]) uses every enabled source.
 * Extra queries only use cheap sources (Remotive/Adzuna/JSearch) to control cost.
 */
export async function fetchAllSourcesMultiQuery(
  queries: string[],
  baseParams: Omit<SearchParams, 'query'>,
  keys: Keys,
  enabledSources: string[]
): Promise<RawJob[]> {
  if (queries.length === 0) return []

  const cheapEnabled = enabledSources.filter((s) => CHEAP_SOURCES.has(s))

  const tasks = queries.map((query, i) => {
    const sources = i === 0 ? enabledSources : cheapEnabled
    console.log(`[multi-query] query #${i + 1}: "${query}" — sources: ${sources.join(', ')}`)
    return fetchSources({ ...baseParams, query }, keys, sources)
  })

  const results = await Promise.all(tasks)
  const all = results.flat()
  const deduped = dedupeJobs(all)

  console.log(`[multi-query] ${all.length} raw jobs → ${deduped.length} after dedupe`)
  return deduped
}
