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

export function buildPrompt(cvText: string, query: string, jobs: RawJob[]): string {
  const jobList = jobs
    .map((job, i) => {
      const desc = job.description
        ? job.description.replace(/<[^>]+>/g, '').slice(0, 500)
        : 'No description provided.'
      return `<job_posting index="${i}">\n[${i}] Title: ${untrusted(job.title)} | Company: ${untrusted(job.company)} | Location: ${untrusted(job.location ?? 'Unknown')} | Remote: ${job.remote}\nDescription: ${desc}\n</job_posting>`
    })
    .join('\n\n')

  return `You are a STRICT job matching expert. You must reject jobs that don't truly fit the candidate.

CANDIDATE CV:
${cvText.slice(0, 3500)}

CANDIDATE IS LOOKING FOR: ${query}

SCORING SCALE (be strict — most jobs from generic job-board searches are NOT good fits):
- 90–100: Perfect match. Required stack, seniority, and role type all align with candidate's CV and target role.
- 70–89: Strong match. Core tech stack matches; minor gaps are acceptable.
- 50–69: Decent match. Same domain/role type, but meaningful skill gaps exist.
- 20–49: Weak match. Related area but core tech stack differs.
- 0–19: Poor match. Fundamentally different tech stack, seniority mismatch, or unrelated role.

CRITICAL RULES:
1. If the job's PRIMARY required language/framework is NOT in the candidate's CV, score must be 0–19. Example: CV shows PHP/Laravel, job requires Python → score 5–15.
2. If the job title is unrelated to "${query}" (e.g., looking for "Laravel Developer" but job is "Data Scientist"), score must be 0–19.
3. Do NOT reward mere topical relevance (e.g., "both are backend roles"). Stack alignment is what matters.
4. Be especially harsh on seniority mismatches: a senior candidate applying to a junior role (or vice versa) should score below 40.
5. The reason field must explicitly mention the matching (or mismatching) tech/skills — be concrete, not generic.
6. ${UNTRUSTED_JOB_RULE}

Return ONLY a JSON array, no prose before or after:
[{"index": 0, "score": 85, "reason": "Requires Laravel + Vue, both strong on CV. Senior level matches 5+ years experience."}, ...]

JOBS TO SCORE:
${jobList}`
}

async function scoreBatch(
  ai: AiClient,
  cvText: string,
  query: string,
  batch: RawJob[],
  signal?: AbortSignal
): Promise<ScoreResult[]> {
  try {
    const text = await ai.complete({
      tier: 'fast',
      maxTokens: 1500,
      prompt: buildPrompt(cvText, query, batch),
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
export async function scoreJobs(
  jobs: RawJob[],
  cvText: string,
  query: string,
  ai: AiClient,
  deadline?: number,
  signal?: AbortSignal
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
          : await scoreBatch(ai, cvText, query, batches[b], signal)
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
