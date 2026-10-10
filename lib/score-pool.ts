import type { RawJob } from './job-sources/types'

// When the user asks for N results, only the best-looking N × POOL_MULTIPLIER
// jobs (at least MIN_POOL) are sent to the AI for scoring, instead of every
// fetched job. "All" (null) scores everything, as before.
const POOL_MULTIPLIER = 4
const MIN_POOL = 30

// Points per query term found in the job's title / description.
const TITLE_WEIGHT = 3
const DESCRIPTION_WEIGHT = 1
const DESCRIPTION_CHARS = 1000

// Words that match almost every posting, so they say nothing about fit.
const STOP_WORDS = new Set([
  'a', 'an', 'and', 'or', 'the', 'of', 'for', 'in', 'at', 'to', 'with', 'on',
  'remote', 'hybrid', 'job', 'jobs', 'role', 'position',
  'developer', 'engineer', 'senior', 'junior', 'jr', 'sr', 'lead', 'mid',
])

export function scoringPoolSize(maxResults: number | null): number | null {
  if (maxResults === null) return null
  return Math.max(maxResults * POOL_MULTIPLIER, MIN_POOL)
}

function queryTerms(queries: string[]): string[] {
  const terms = new Set<string>()
  for (const query of queries) {
    for (const raw of query.toLowerCase().split(/[\s,;/|()]+/)) {
      // Keep inner punctuation (node.js, c#, c++, .net) but drop a trailing
      // full stop or colon from the sentence.
      const term = raw.replace(/[.:]+$/, '')
      if (term.length >= 2 && !STOP_WORDS.has(term)) terms.add(term)
    }
  }
  return [...terms]
}

// Matches the term as a whole word, so "go" doesn't match "good".
function termPattern(term: string): RegExp {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'iu')
}

// Orders jobs by how well their title and description match the search
// queries, best first. Cheap and deterministic (no AI); ties keep the input
// order. Returns a new array and leaves the input untouched.
export function preRankJobs(jobs: RawJob[], queries: string[]): RawJob[] {
  const patterns = queryTerms(queries).map(termPattern)
  if (patterns.length === 0) return [...jobs]

  const ranked = jobs.map((job, index) => {
    const description = (job.description ?? '')
      .replace(/<[^>]+>/g, ' ')
      .slice(0, DESCRIPTION_CHARS)
    let score = 0
    for (const pattern of patterns) {
      if (pattern.test(job.title)) score += TITLE_WEIGHT
      if (pattern.test(description)) score += DESCRIPTION_WEIGHT
    }
    return { job, index, score }
  })
  ranked.sort((a, b) => b.score - a.score || a.index - b.index)
  return ranked.map((r) => r.job)
}
