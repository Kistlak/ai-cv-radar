import type { CvStructured } from './ai/schemas'
import type { RawJob } from './job-sources/types'

// When the user asks for N results, only the best-looking N × POOL_MULTIPLIER
// jobs (at least MIN_POOL) are sent to the AI for scoring, instead of every
// fetched job. "All" (null) scores everything, as before.
const POOL_MULTIPLIER = 4
const MIN_POOL = 30

// Points per term found in the job's title / description. Query terms weigh
// more than CV terms in the title; any term in the description scores the same.
const QUERY_TITLE_WEIGHT = 3
const CV_TITLE_WEIGHT = 2
const DESCRIPTION_WEIGHT = 1
// Many postings list their requirements after a long company intro.
const DESCRIPTION_CHARS = 3000

// CV terms: the skills plus the most recent role titles, capped so a very long
// skills list can't blow up the regex work.
const CV_ROLES = 4
const MAX_CV_TERMS = 80

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

function extractTerms(texts: string[]): string[] {
  const terms = new Set<string>()
  for (const text of texts) {
    for (const raw of text.toLowerCase().split(/[\s,;/|()]+/)) {
      // Keep inner punctuation (node.js, c#, c++, .net) but drop a trailing
      // full stop or colon from the sentence.
      const term = raw.replace(/[.:]+$/, '')
      if (term.length >= 2 && !STOP_WORDS.has(term)) terms.add(term)
    }
  }
  return [...terms]
}

// Role words first, so they survive the cap; terms already in the query are
// left to the query weight.
function cvTerms(cv: CvStructured, query: string[]): string[] {
  const roles = cv.experience.slice(0, CV_ROLES).map((e) => e.role)
  const queryTerms = new Set(query)
  return extractTerms([...roles, ...cv.skills])
    .filter((t) => !queryTerms.has(t))
    .slice(0, MAX_CV_TERMS)
}

const WORD_CHAR = /[\p{L}\p{N}]/u

// Matches the term as a whole word, so "go" doesn't match "good". The boundary
// is only checked on a side that is a letter or digit, so ".net" still matches
// "ASP.NET".
function termPattern(term: string): RegExp {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const before = WORD_CHAR.test(term[0]) ? '(?<![\\p{L}\\p{N}])' : ''
  const after = WORD_CHAR.test(term[term.length - 1]) ? '(?![\\p{L}\\p{N}])' : ''
  return new RegExp(`${before}${escaped}${after}`, 'iu')
}

// Orders jobs by how well their title and description match the search
// queries and (when given) the CV's skills and recent roles, best first.
// Cheap and deterministic (no AI); ties keep the input order. Returns a new
// array and leaves the input untouched.
export function preRankJobs(
  jobs: RawJob[],
  queries: string[],
  cv?: CvStructured | null
): RawJob[] {
  const query = extractTerms(queries)
  const queryPatterns = query.map(termPattern)
  const cvPatterns = cv ? cvTerms(cv, query).map(termPattern) : []
  if (queryPatterns.length === 0 && cvPatterns.length === 0) return [...jobs]

  const ranked = jobs.map((job, index) => {
    const description = (job.description ?? '')
      .replace(/<[^>]+>/g, ' ')
      .slice(0, DESCRIPTION_CHARS)
    let score = 0
    for (const pattern of queryPatterns) {
      if (pattern.test(job.title)) score += QUERY_TITLE_WEIGHT
      if (pattern.test(description)) score += DESCRIPTION_WEIGHT
    }
    for (const pattern of cvPatterns) {
      if (pattern.test(job.title)) score += CV_TITLE_WEIGHT
      if (pattern.test(description)) score += DESCRIPTION_WEIGHT
    }
    return { job, index, score }
  })
  ranked.sort((a, b) => b.score - a.score || a.index - b.index)
  return ranked.map((r) => r.job)
}
