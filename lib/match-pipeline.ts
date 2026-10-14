import type { AiClient } from './ai/provider'
import type { CvStructured } from './ai/schemas'
import { cvProfileText } from './cv-profile'
import { isFresh, jobMaxAgeDays } from './freshness'
import type { RawJob } from './job-sources/types'
import { scoreJobs, type CandidateContext, type ScoredJob } from './score-jobs'
import { rerankConfig, rerankTop, rerankTopK } from './rerank'
import { preRankJobs, scoringPoolSize } from './score-pool'

// The ranking half of a search: everything after the jobs are fetched, deduped
// and validated. Shared by runSearch and the match-quality eval
// (tests/eval/), so the eval measures exactly what users get.

export interface RankContext {
  // Pre-rank terms; queries[0] is what the candidate is "looking for" in scoring.
  queries: string[]
  cvText: string
  // The CV's structured profile; its skills and recent roles help the pre-rank.
  // Null or absent: the pre-rank uses the queries only.
  cvProfile?: CvStructured | null
  // Where the candidate lives or is searching, and remote-only; the scoring
  // prompt uses them for the location-eligibility cap.
  candidate?: CandidateContext
  ai: AiClient
  // The user's result count; null means "All".
  maxResults: number | null
  // Epoch ms after which no new scoring batch starts (see scoreJobs).
  deadline?: number
  signal?: AbortSignal
  // Freshness: jobs posted more than maxAgeDays before `now` are dropped
  // before the pool. Defaults: Date.now() and JOB_MAX_AGE_DAYS (0 = off).
  now?: number
  maxAgeDays?: number
  // Called once the scoring pool is chosen, before any scoring call. `fetched`
  // counts every input job, including the `stale` ones that were dropped.
  onPool?: (fetched: number, pool: number, stale: number) => void | Promise<void>
  // Rerank the top candidates on the smart tier (lib/rerank.ts). Default:
  // RERANK_ENABLED. rerankDeadline: epoch ms after which no rerank batch starts.
  rerank?: boolean
  rerankDeadline?: number
}

export type RerankSkipReason = 'disabled' | 'deadline' | 'cancelled' | 'no-jobs'

export interface RerankSummary {
  status: 'done' | 'skipped'
  reason?: RerankSkipReason
  // Jobs sent to the rerank, jobs that got a smart score, and jobs that kept
  // their fast score.
  candidates: number
  reranked: number
  failed: number
  // Time spent in the rerank (0 when skipped).
  ms: number
}

export interface RankResult {
  // Every job that went through scoring, with smart scores for reranked jobs.
  scored: ScoredJob[]
  // What the user sees: the top N by score, or all of `scored` for "All".
  top: ScoredJob[]
  rerank: RerankSummary
}

export async function rankJobs(jobs: RawJob[], ctx: RankContext): Promise<RankResult> {
  // Old postings are dropped first, so they never take a slot in the pool.
  const now = ctx.now ?? Date.now()
  const maxAgeDays = ctx.maxAgeDays ?? jobMaxAgeDays()
  const fresh = jobs.filter((job) => isFresh(job, now, maxAgeDays))

  // With a result count set, only the best-looking jobs (by a cheap keyword
  // pre-rank) are sent to the AI; "All" scores everything.
  const poolSize = scoringPoolSize(ctx.maxResults)
  const toScore =
    poolSize && fresh.length > poolSize
      ? preRankJobs(fresh, ctx.queries, ctx.cvProfile).slice(0, poolSize)
      : fresh
  await ctx.onPool?.(jobs.length, toScore.length, jobs.length - fresh.length)

  const cvText = cvProfileText(ctx.cvProfile ?? null, ctx.cvText)
  const fastScored = await scoreJobs(
    toScore,
    cvText,
    ctx.queries[0],
    ctx.ai,
    ctx.deadline,
    ctx.signal,
    ctx.candidate
  )

  const { scored, rerank } = await rerankStep(fastScored, cvText, ctx)
  // Respect the user's job-count preference by keeping the top-scoring N after scoring.
  const top = selectTop(scored, ctx.maxResults)

  return { scored, top, rerank }
}

// The smart tier re-scores the fast pass's top K; their new scores replace the
// fast ones in `scored`. Skipped (fast scores stand) when off, cancelled or late.
async function rerankStep(
  scored: ScoredJob[],
  cvText: string,
  ctx: RankContext
): Promise<{ scored: ScoredJob[]; rerank: RerankSummary }> {
  const skipped = (reason: RerankSkipReason) => ({
    scored,
    rerank: { status: 'skipped' as const, reason, candidates: 0, reranked: 0, failed: 0, ms: 0 },
  })
  const config = rerankConfig()
  if (!(ctx.rerank ?? config.enabled)) return skipped('disabled')
  if (scored.length === 0) return skipped('no-jobs')
  if (ctx.signal?.aborted) return skipped('cancelled')
  if (ctx.rerankDeadline !== undefined && Date.now() >= ctx.rerankDeadline) return skipped('deadline')

  const t0 = Date.now()
  const candidates = selectTop(scored, rerankTopK(ctx.maxResults, config.topK))
  const outcome = await rerankTop(candidates, cvText, ctx.queries[0], ctx.ai, {
    deadline: ctx.rerankDeadline,
    signal: ctx.signal,
    candidate: ctx.candidate,
  })
  const replaced = new Map(candidates.map((job, i) => [job, outcome.jobs[i]]))

  return {
    scored: scored.map((job) => replaced.get(job) ?? job),
    rerank: {
      status: 'done',
      candidates: candidates.length,
      reranked: outcome.reranked,
      failed: outcome.failed,
      ms: Date.now() - t0,
    },
  }
}

// Scored jobs by score (highest first), then unscored ones, cut to maxResults
// (null keeps all). Unscored jobs only fill slots no scored job can. The sort is
// stable, so ties and unscored jobs keep their input (pre-rank) order.
export function selectTop(jobs: ScoredJob[], maxResults: number | null): ScoredJob[] {
  const scored = jobs.filter((j): j is ScoredJob & { matchScore: number } => j.matchScore !== null)
  const unscored = jobs.filter((j) => j.matchScore === null)
  const ordered = [...scored.sort((a, b) => b.matchScore - a.matchScore), ...unscored]
  return maxResults ? ordered.slice(0, maxResults) : ordered
}
