import type { AiClient } from '@/lib/ai/provider'
import { logger } from './logger'
import { buildPrompt, parseScores, type CandidateContext, type ScoredJob } from './score-jobs'

// The rerank: the smart tier re-scores the fast pass's top candidates with more
// of each posting, and its scores replace the fast ones. Best-effort: a batch
// that fails, times out or starts after the deadline keeps its fast scores.

const BATCH_SIZE = 5
const BATCH_TIMEOUT_MS = 30_000
const DESCRIPTION_CHARS = 3000
const MAX_TOP_K = 20

export interface RerankConfig {
  enabled: boolean
  // RERANK_TOP_K; null uses the default from rerankTopK.
  topK: number | null
}

// RERANK_ENABLED: 'true' turns the rerank on; off by default until the eval
// confirms the gain. RERANK_TOP_K: a whole number ≥ 1, anything else is ignored.
export function rerankConfig(env: Record<string, string | undefined> = process.env): RerankConfig {
  const rawTopK = env.RERANK_TOP_K
  const topK = rawTopK === undefined || rawTopK.trim() === '' ? NaN : Number(rawTopK)
  return {
    enabled: env.RERANK_ENABLED?.trim().toLowerCase() === 'true',
    topK: Number.isInteger(topK) && topK >= 1 ? topK : null,
  }
}

// How many of the fast pass's best jobs are reranked: twice the result count,
// at least 10 and at most 20; 20 for "All" (maxResults null). An override is
// capped at 20 too: every batch runs at once, so more would mean more parallel
// smart-tier calls than the rate limits and the 30 s budget allow.
export function rerankTopK(maxResults: number | null, override: number | null = null): number {
  if (override !== null) return Math.min(override, MAX_TOP_K)
  if (maxResults === null) return MAX_TOP_K
  return Math.min(MAX_TOP_K, Math.max(2 * maxResults, 10))
}

export interface RerankOptions {
  // Epoch ms after which no new batch starts.
  deadline?: number
  signal?: AbortSignal
  candidate?: CandidateContext
}

export interface RerankOutcome {
  // Same order and length as the input; reranked jobs carry the smart score.
  jobs: ScoredJob[]
  // Jobs that got a smart score.
  reranked: number
  // Jobs that kept their fast score (batch failed, skipped, or index missing).
  failed: number
}

export async function rerankTop(
  jobs: ScoredJob[],
  cvText: string,
  query: string,
  ai: AiClient,
  opts: RerankOptions = {}
): Promise<RerankOutcome> {
  const batches: ScoredJob[][] = []
  for (let i = 0; i < jobs.length; i += BATCH_SIZE) {
    batches.push(jobs.slice(i, i + BATCH_SIZE))
  }

  const results = await Promise.all(
    batches.map(async (batch) => {
      if (opts.signal?.aborted || (opts.deadline !== undefined && Date.now() >= opts.deadline)) {
        return batch
      }
      try {
        const text = await ai.complete({
          tier: 'smart',
          maxTokens: 1500,
          prompt: buildPrompt(cvText, query, batch, opts.candidate, DESCRIPTION_CHARS),
          timeoutMs: BATCH_TIMEOUT_MS,
          signal: opts.signal,
        })
        const scores = parseScores(text)
        return batch.map((job, j) => {
          const r = scores.find((s) => s.index === j)
          return r ? { ...job, matchScore: r.score, matchReason: r.reason } : job
        })
      } catch (err) {
        if (!opts.signal?.aborted) {
          logger.warn({ event: 'rerank.batch_failed', provider: ai.provider, jobs: batch.length, err })
        }
        return batch
      }
    })
  )

  const out = results.flat()
  const reranked = out.filter((job, i) => job !== jobs[i]).length
  return { jobs: out, reranked, failed: jobs.length - reranked }
}
