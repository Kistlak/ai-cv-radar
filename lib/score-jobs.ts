import { z } from 'zod'
import type { AiClient } from '@/lib/ai/provider'
import type { RawJob } from './job-sources/types'
import { logger } from './logger'
import { UNTRUSTED_JOB_RULE, untrusted } from './untrusted'

export interface ScoredJob extends RawJob {
  matchScore: number
  matchReason: string
}

interface ScoreResult {
  index: number
  score: number
  reason: string
}

const BATCH_SIZE = 10
// Batches scored in parallel. Lower it if low-tier keys hit provider rate limits.
const SCORING_CONCURRENCY = 3
// Per-batch cap, so one hung provider call can't hold the search.
const BATCH_TIMEOUT_MS = 45_000

// The model's output is untrusted: "85", 85.5 or 150 must not reach the integer
// match_score column, or the insert throws and the whole search fails.
// Only numbers and non-empty strings are coerced (null or '' would become 0).
const numeric = z.union([z.number(), z.string().trim().min(1)]).pipe(z.coerce.number())

const ScoreResultSchema = z.object({
  index: numeric.pipe(z.number().int()),
  score: numeric
    .refine(Number.isFinite)
    .transform((n) => Math.min(100, Math.max(0, Math.round(n)))),
  reason: z.string().optional().default(''),
})

// Drops invalid items (those jobs fall back to the default score); throws if
// there is no JSON array at all, so the caller falls back for the whole batch.
export function parseScores(text: string): ScoreResult[] {
  const match = text.match(/\[[\s\S]*\]/)
  if (!match) throw new Error('No JSON array found')
  const parsed: unknown = JSON.parse(match[0])
  if (!Array.isArray(parsed)) throw new Error('Expected a JSON array')

  const results: ScoreResult[] = []
  for (const item of parsed) {
    const r = ScoreResultSchema.safeParse(item)
    if (r.success) results.push(r.data)
  }
  return results
}

// Where the candidate lives or wants to work, and whether they want remote
// only. Used for the location-eligibility cap in the prompt.
export interface CandidateContext {
  location: string | null
  remoteOnly: boolean
}

export function buildPrompt(
  cvText: string,
  query: string,
  jobs: RawJob[],
  candidate?: CandidateContext
): string {
  const jobList = jobs
    .map((job, i) => {
      const desc = job.description
        ? job.description.replace(/<[^>]+>/g, '').slice(0, 500)
        : 'No description provided.'
      return `<job_posting index="${i}">\n[${i}] Title: ${untrusted(job.title)} | Company: ${untrusted(job.company)} | Location: ${untrusted(job.location ?? 'Unknown')} | Remote: ${job.remote}\nDescription: ${desc}\n</job_posting>`
    })
    .join('\n\n')

  return `You are a STRICT job matching expert for candidates in any profession. You must reject jobs that don't truly fit the candidate.

CANDIDATE CV:
${cvText.slice(0, 3500)}

CANDIDATE IS LOOKING FOR: ${query}
CANDIDATE LOCATION (where they live or are searching): ${candidate?.location?.trim().slice(0, 100) || 'unknown'}
REMOTE ONLY: ${candidate?.remoteOnly ? 'yes' : 'no'}

Judge each job on:
- Core skills and duties: does the CV show the work this job actually involves?
- Hard requirements: licences, registrations, certifications, degrees, years of experience and languages that the posting states as required.
- Field or industry, and role type.
- Seniority.
- Location eligibility.

SCORING SCALE (be strict — most jobs from generic job-board searches are NOT good fits):
- 90–100: Same field and role type; meets every hard requirement; seniority fits; eligible by location.
- 70–89: Strong fit with minor gaps.
- 50–69: Same field, but real gaps in skills or experience.
- 20–49: Related field, or one major gap.
- 0–19: Different field, or a fundamentally different role from "${query}".

CAPS (apply the lowest one that fits):
1. A hard requirement the CV does not show caps the score at 30. Only count requirements the posting states as required, not "nice to have" items.
2. If the candidate is not eligible by location, the score is at most 20: on-site or hybrid outside the CANDIDATE LOCATION area, or remote limited to countries or regions that exclude it. If the CANDIDATE LOCATION is unknown, do not apply this cap. If REMOTE ONLY is yes, an on-site or hybrid job inside the area is a major gap, not ineligible.
3. Seniority two or more levels away from the candidate's (e.g. a mid-level candidate and an executive role, or a senior candidate and an entry-level role) caps the score at 40.

RULES:
1. Judge only what the posting and the CV actually say; do not assume skills or requirements that aren't there.
2. Do NOT reward keyword overlap or topical similarity alone (e.g. "both roles are in healthcare"). The candidate must be able to do this job and meet its requirements.
3. The reason must name the specific matching or missing requirement (a skill, licence, years, language or location) — be concrete, not generic.
4. ${UNTRUSTED_JOB_RULE}

Return ONLY a JSON array, no prose before or after. Format example (from other candidates):
[{"index": 0, "score": 30, "reason": "ICU nursing experience fits, but the job requires NMC registration, which the CV does not show."}, {"index": 1, "score": 88, "reason": "IFRS reporting and month-end close match 6 years in audit and financial control; ACCA held as required."}, {"index": 2, "score": 15, "reason": "React and TypeScript match, but the role is on-site in Berlin and the candidate lives in Colombo."}, ...]

JOBS TO SCORE:
${jobList}`
}

async function scoreBatch(
  ai: AiClient,
  cvText: string,
  query: string,
  batch: RawJob[],
  signal?: AbortSignal,
  candidate?: CandidateContext
): Promise<ScoreResult[]> {
  try {
    const text = await ai.complete({
      tier: 'fast',
      maxTokens: 1500,
      prompt: buildPrompt(cvText, query, batch, candidate),
      timeoutMs: BATCH_TIMEOUT_MS,
      signal,
    })
    return parseScores(text)
  } catch (err) {
    // A failure here only shows up as the fallback score, so log it: a broken
    // model or key would otherwise look like 30 for every job.
    if (!signal?.aborted) {
      logger.warn({ event: 'score_jobs.batch_failed', provider: ai.provider, jobs: batch.length, err })
    }
    return unavailable(batch)
  }
}

function unavailable(batch: RawJob[]): ScoreResult[] {
  return batch.map((_, i) => ({ index: i, score: 30, reason: 'Score unavailable' }))
}

// `deadline` (epoch ms): batches not started by then get the fallback score
// instead of a model call, so the caller still has time to save results.
// `signal`: once aborted (search cancelled), no more model calls are made.
// `candidate`: location and remote-only, for the location-eligibility cap.
export async function scoreJobs(
  jobs: RawJob[],
  cvText: string,
  query: string,
  ai: AiClient,
  deadline?: number,
  signal?: AbortSignal,
  candidate?: CandidateContext
): Promise<ScoredJob[]> {
  if (jobs.length === 0) return []

  const batches: RawJob[][] = []
  for (let i = 0; i < jobs.length; i += BATCH_SIZE) {
    batches.push(jobs.slice(i, i + BATCH_SIZE))
  }

  // Results are stored by batch index, so output order matches input order.
  const batchResults: ScoreResult[][] = new Array(batches.length)
  let next = 0
  const worker = async () => {
    while (next < batches.length) {
      const b = next++
      batchResults[b] =
        signal?.aborted || (deadline !== undefined && Date.now() >= deadline)
          ? unavailable(batches[b])
          : await scoreBatch(ai, cvText, query, batches[b], signal, candidate)
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(SCORING_CONCURRENCY, batches.length) }, worker)
  )

  const scored: ScoredJob[] = []
  batches.forEach((batch, b) => {
    for (let j = 0; j < batch.length; j++) {
      const result = batchResults[b].find((r) => r.index === j)
      scored.push({
        ...batch[j],
        matchScore: result?.score ?? 30,
        matchReason: result?.reason ?? '',
      })
    }
  })

  return scored
}
