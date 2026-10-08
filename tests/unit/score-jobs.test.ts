import { describe, expect, it } from 'vitest'
import type { AiClient } from '@/lib/ai/types'
import type { RawJob } from '@/lib/job-sources/types'
import { parseScores, scoreJobs } from '@/lib/score-jobs'

function job(i: number): RawJob {
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
  }
}

// Number of jobs in a scoring prompt: one "[n] Title:" line per job.
function jobsInPrompt(prompt: string): number {
  return (prompt.match(/^\[\d+\] Title:/gm) ?? []).length
}

function fakeAi(complete: AiClient['complete']): AiClient {
  return { provider: 'anthropic', complete }
}

describe('parseScores', () => {
  it('parses a valid array', () => {
    expect(parseScores('[{"index": 0, "score": 85, "reason": "Laravel match"}]')).toEqual([
      { index: 0, score: 85, reason: 'Laravel match' },
    ])
  })

  it('coerces string scores and rounds decimals', () => {
    const out = parseScores('[{"index": "0", "score": "85"}, {"index": 1, "score": 85.5}]')
    expect(out.map((r) => [r.index, r.score])).toEqual([[0, 85], [1, 86]])
  })

  it('clamps out-of-range scores to 0–100', () => {
    const out = parseScores('[{"index": 0, "score": 150}, {"index": 1, "score": -5}]')
    expect(out.map((r) => r.score)).toEqual([100, 0])
  })

  it('defaults a missing reason to an empty string', () => {
    expect(parseScores('[{"index": 0, "score": 50}]')[0].reason).toBe('')
  })

  it('drops only the invalid items', () => {
    const out = parseScores(
      '[{"index": 0, "score": 70}, {"index": 1, "score": "high"}, {"index": 2, "score": null}, {"index": 3}, {"index": 4, "score": 40}]'
    )
    expect(out.map((r) => r.index)).toEqual([0, 4])
  })

  it('ignores prose around the JSON array', () => {
    expect(parseScores('Here you go:\n[{"index": 0, "score": 60}]\nDone.')).toHaveLength(1)
  })

  it('throws when there is no JSON array', () => {
    expect(() => parseScores('Sorry, I cannot help with that.')).toThrow()
  })
})

describe('scoreJobs', () => {
  it('returns an empty array for no jobs', async () => {
    const ai = fakeAi(async () => '[]')
    expect(await scoreJobs([], 'cv', 'query', ai)).toEqual([])
  })

  it('keeps input order across parallel batches', async () => {
    const jobs = Array.from({ length: 25 }, (_, i) => job(i))
    let call = 0
    const ai = fakeAi(async ({ prompt }) => {
      // Finish later batches first, so order can't come from completion order.
      const delay = (3 - call++) * 5
      await new Promise((r) => setTimeout(r, delay))
      const n = jobsInPrompt(prompt)
      const first = Number(prompt.match(/Title: Job (\d+)/)![1])
      return JSON.stringify(
        Array.from({ length: n }, (_, i) => ({ index: i, score: first + i, reason: `r${first + i}` }))
      )
    })

    const scored = await scoreJobs(jobs, 'cv', 'query', ai)
    expect(scored.map((j) => j.sourceJobId)).toEqual(jobs.map((j) => j.sourceJobId))
    expect(scored.map((j) => j.matchScore)).toEqual(jobs.map((_, i) => i))
  })

  it('falls back to 30 / "Score unavailable" for a batch that fails', async () => {
    const jobs = Array.from({ length: 15 }, (_, i) => job(i))
    const ai = fakeAi(async ({ prompt }) => {
      if (prompt.includes('Title: Job 0 ')) throw new Error('provider down')
      return JSON.stringify(
        Array.from({ length: jobsInPrompt(prompt) }, (_, i) => ({ index: i, score: 90, reason: 'ok' }))
      )
    })

    const scored = await scoreJobs(jobs, 'cv', 'query', ai)
    expect(scored.slice(0, 10).every((j) => j.matchScore === 30 && j.matchReason === 'Score unavailable')).toBe(true)
    expect(scored.slice(10).every((j) => j.matchScore === 90)).toBe(true)
  })

  it('gives 30 and an empty reason to a job missing from the output', async () => {
    const ai = fakeAi(async () => '[{"index": 0, "score": 80, "reason": "ok"}]')
    const scored = await scoreJobs([job(0), job(1)], 'cv', 'query', ai)
    expect(scored[1]).toMatchObject({ matchScore: 30, matchReason: '' })
  })

  it('passes a per-batch timeout to the AI client', async () => {
    let timeoutMs: number | undefined
    const ai = fakeAi(async (opts) => {
      timeoutMs = opts.timeoutMs
      return '[]'
    })
    await scoreJobs([job(0)], 'cv', 'query', ai)
    expect(timeoutMs).toBeGreaterThan(0)
  })

  it('skips the model for batches not started by the deadline', async () => {
    const jobs = Array.from({ length: 50 }, (_, i) => job(i))
    let calls = 0
    const ai = fakeAi(async ({ prompt }) => {
      calls++
      await new Promise((r) => setTimeout(r, 20))
      return JSON.stringify(
        Array.from({ length: jobsInPrompt(prompt) }, (_, i) => ({ index: i, score: 90, reason: 'ok' }))
      )
    })

    // The first 3 batches start before the deadline; the other 2 start after it.
    const scored = await scoreJobs(jobs, 'cv', 'query', ai, Date.now() + 10)
    expect(calls).toBe(3)
    expect(scored).toHaveLength(50)
    expect(scored.slice(0, 30).every((j) => j.matchScore === 90)).toBe(true)
    expect(scored.slice(30).every((j) => j.matchScore === 30 && j.matchReason === 'Score unavailable')).toBe(true)
  })

  it('runs at most 3 batches at once', async () => {
    const jobs = Array.from({ length: 60 }, (_, i) => job(i))
    let inFlight = 0
    let peak = 0
    const ai = fakeAi(async () => {
      inFlight++
      peak = Math.max(peak, inFlight)
      await new Promise((r) => setTimeout(r, 5))
      inFlight--
      return '[]'
    })

    await scoreJobs(jobs, 'cv', 'query', ai)
    expect(peak).toBe(3)
  })
})
