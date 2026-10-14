import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/logger', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {} },
}))

import type { AiClient, AiCompletionOptions } from '@/lib/ai/types'
import { rerankConfig, rerankTop, rerankTopK } from '@/lib/rerank'
import type { ScoredJob } from '@/lib/score-jobs'

function job(i: number, matchScore: number | null = 50): ScoredJob {
  return {
    source: 'remotive',
    sourceJobId: String(i),
    title: `Job ${i}`,
    company: `Company ${i}`,
    location: null,
    remote: true,
    salary: null,
    postedAt: null,
    description: null,
    applyUrl: `https://example.com/${i}`,
    matchScore,
    matchReason: 'fast',
  }
}

// Gives every job in a batch the score 90 + its batch index, reason "smart".
function smartAi(): AiClient & { calls: AiCompletionOptions[] } {
  const calls: AiCompletionOptions[] = []
  return {
    provider: 'gemini',
    calls,
    complete: async (opts) => {
      calls.push(opts)
      const n = (opts.prompt.match(/^\[\d+\] Title:/gm) ?? []).length
      return JSON.stringify(Array.from({ length: n }, (_, i) => ({ index: i, score: 90 + i, reason: 'smart' })))
    },
  }
}

describe('rerankTopK', () => {
  it('is twice the result count, between 10 and 20', () => {
    expect(rerankTopK(3)).toBe(10)
    expect(rerankTopK(5)).toBe(10)
    expect(rerankTopK(8)).toBe(16)
    expect(rerankTopK(10)).toBe(20)
    expect(rerankTopK(25)).toBe(20)
  })

  it('is 20 for "All" and uses an override when set', () => {
    expect(rerankTopK(null)).toBe(20)
    expect(rerankTopK(10, 5)).toBe(5)
  })

  it('caps an override at 20', () => {
    expect(rerankTopK(10, 20)).toBe(20)
    expect(rerankTopK(10, 100)).toBe(20)
    expect(rerankTopK(null, 50)).toBe(20)
  })
})

describe('rerankConfig', () => {
  it('is off by default and on only for "true"', () => {
    expect(rerankConfig({}).enabled).toBe(false)
    expect(rerankConfig({ RERANK_ENABLED: 'true' }).enabled).toBe(true)
    expect(rerankConfig({ RERANK_ENABLED: ' TRUE ' }).enabled).toBe(true)
    expect(rerankConfig({ RERANK_ENABLED: 'false' }).enabled).toBe(false)
    expect(rerankConfig({ RERANK_ENABLED: 'yes' }).enabled).toBe(false)
  })

  it('reads RERANK_TOP_K as a whole number of at least 1', () => {
    expect(rerankConfig({}).topK).toBeNull()
    expect(rerankConfig({ RERANK_TOP_K: '5' }).topK).toBe(5)
    for (const raw of ['0', 'x', '2.5', ' ']) {
      expect(rerankConfig({ RERANK_TOP_K: raw }).topK).toBeNull()
    }
  })
})

describe('rerankTop', () => {
  it('scores batches of 5 on the smart tier and replaces scores and reasons', async () => {
    const ai = smartAi()
    const jobs = Array.from({ length: 12 }, (_, i) => job(i))
    const { jobs: out, reranked, failed } = await rerankTop(jobs, 'cv', 'q', ai)

    expect(ai.calls).toHaveLength(3)
    expect(ai.calls.every((c) => c.tier === 'smart' && c.timeoutMs === 30_000)).toBe(true)
    expect(out.map((j) => j.sourceJobId)).toEqual(jobs.map((j) => j.sourceJobId))
    expect(out[0]).toMatchObject({ matchScore: 90, matchReason: 'smart' })
    expect(out[6]).toMatchObject({ matchScore: 91, matchReason: 'smart' })
    expect(reranked).toBe(12)
    expect(failed).toBe(0)
  })

  it('sends up to 3,000 characters of each posting', async () => {
    const ai = smartAi()
    const long = { ...job(0), description: `${'word '.repeat(400)}LATE_MARKER ${'word '.repeat(200)}` }
    await rerankTop([long], 'cv', 'q', ai)
    expect(ai.calls[0].prompt).toContain('LATE_MARKER')
  })

  it('keeps fast scores for a failed batch and for skipped indexes', async () => {
    let call = 0
    const ai: AiClient = {
      provider: 'gemini',
      complete: async () => {
        call++
        if (call === 1) throw new Error('boom')
        return '[{"index": 0, "score": 99, "reason": "smart"}]'
      },
    }
    const jobs = Array.from({ length: 7 }, (_, i) => job(i, 40 + i))
    const { jobs: out, reranked, failed } = await rerankTop(jobs, 'cv', 'q', ai)

    expect(out.slice(0, 5).map((j) => j.matchScore)).toEqual([40, 41, 42, 43, 44])
    expect(out[5]).toMatchObject({ matchScore: 99, matchReason: 'smart' })
    expect(out[6]).toMatchObject({ matchScore: 46, matchReason: 'fast' })
    expect(reranked).toBe(1)
    expect(failed).toBe(6)
  })

  it('makes no calls after the deadline or once cancelled', async () => {
    const ai = smartAi()
    const jobs = [job(1), job(2)]
    const late = await rerankTop(jobs, 'cv', 'q', ai, { deadline: Date.now() - 1 })
    expect(late).toEqual({ jobs, reranked: 0, failed: 2 })

    const controller = new AbortController()
    controller.abort()
    const cancelled = await rerankTop(jobs, 'cv', 'q', ai, { signal: controller.signal })
    expect(cancelled.reranked).toBe(0)
    expect(ai.calls).toHaveLength(0)
  })
})
