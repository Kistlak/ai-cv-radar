import type { AiClient } from './ai/provider'
import type { CvStructured } from './ai/schemas'
import { cvProfileText } from './cv-profile'
import type { RawJob } from './job-sources/types'
import { scoreJobs, type CandidateContext, type ScoredJob } from './score-jobs'
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
  // Called once the scoring pool is chosen, before any scoring call.
  onPool?: (fetched: number, pool: number) => void | Promise<void>
}

export interface RankResult {
  // Every job that went through scoring.
  scored: ScoredJob[]
  // What the user sees: the top N by score, or all of `scored` for "All".
  top: ScoredJob[]
}

export async function rankJobs(jobs: RawJob[], ctx: RankContext): Promise<RankResult> {
  // With a result count set, only the best-looking jobs (by a cheap keyword
  // pre-rank) are sent to the AI; "All" scores everything.
  const poolSize = scoringPoolSize(ctx.maxResults)
  const toScore =
    poolSize && jobs.length > poolSize
      ? preRankJobs(jobs, ctx.queries, ctx.cvProfile).slice(0, poolSize)
      : jobs
  await ctx.onPool?.(jobs.length, toScore.length)

  const scored = await scoreJobs(
    toScore,
    cvProfileText(ctx.cvProfile ?? null, ctx.cvText),
    ctx.queries[0],
    ctx.ai,
    ctx.deadline,
    ctx.signal,
    ctx.candidate
  )
  // Respect the user's job-count preference by keeping the top-scoring N after scoring.
  const top = selectTop(scored, ctx.maxResults)

  return { scored, top }
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
