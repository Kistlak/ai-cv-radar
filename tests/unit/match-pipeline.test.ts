import { describe, expect, it, vi } from 'vitest'
import type { AiClient } from '@/lib/ai/types'
import type { RawJob } from '@/lib/job-sources/types'
import { rankJobs } from '@/lib/match-pipeline'

function job(i: number, title = `Job ${i}`): RawJob {
  return {
    source: 'remotive',
    sourceJobId: String(i),
    title,
    company: `Company ${i}`,
    location: null,
    remote: true,
    salary: null,
    postedAt: null,
    description: null,
    applyUrl: `https://example.com/${i}`,
  }
}

// Scores each job in a batch by the number in its title ("Job 7" → 7), so the
// expected order is easy to read.
function fakeAi(): AiClient & { complete: ReturnType<typeof vi.fn> } {
  const complete = vi.fn(async ({ prompt }: { prompt: string }) => {
    const lines = [...prompt.matchAll(/^\[(\d+)\] Title: \D*(\d+)/gm)]
    return JSON.stringify(
      lines.map((m) => ({ index: Number(m[1]), score: Number(m[2]), reason: 'ok' }))
    )
  })
  return { provider: 'gemini', complete }
}

const jobsInPrompt = (prompt: string) => (prompt.match(/^\[\d+\] Title:/gm) ?? []).length

describe('rankJobs', () => {
  it('scores every job and returns the top N by score', async () => {
    const ai = fakeAi()
    const jobs = [job(5), job(50), job(20), job(1)]
    const { scored, top } = await rankJobs(jobs, { queries: ['x'], cvText: 'cv', ai, maxResults: 2 })
    expect(scored).toHaveLength(4)
    expect(top.map((j) => j.sourceJobId)).toEqual(['50', '20'])
  })

  it('returns every scored job for "All"', async () => {
    const ai = fakeAi()
    const jobs = [job(5), job(50)]
    const { scored, top } = await rankJobs(jobs, { queries: ['x'], cvText: 'cv', ai, maxResults: null })
    expect(top).toBe(scored)
  })

  it('scores only the pre-ranked pool when there are more jobs than the pool', async () => {
    const ai = fakeAi()
    // 45 jobs, pool for 10 results is 40; the 5 "Laravel" jobs must survive the pre-rank.
    const jobs = [
      ...Array.from({ length: 40 }, (_, i) => job(i + 1)),
      ...Array.from({ length: 5 }, (_, i) => job(100 + i, `Laravel ${100 + i}`)),
    ]
    const onPool = vi.fn()
    const { scored } = await rankJobs(jobs, {
      queries: ['laravel'],
      cvText: 'cv',
      ai,
      maxResults: 10,
      onPool,
    })
    expect(onPool).toHaveBeenCalledWith(45, 40)
    expect(scored).toHaveLength(40)
    expect(scored.slice(0, 5).map((j) => j.title)).toEqual(
      Array.from({ length: 5 }, (_, i) => `Laravel ${100 + i}`)
    )
    const sent = ai.complete.mock.calls.reduce((n, [opts]) => n + jobsInPrompt(opts.prompt), 0)
    expect(sent).toBe(40)
  })

  it('does not cap when the jobs fit in the pool', async () => {
    const ai = fakeAi()
    const onPool = vi.fn()
    await rankJobs([job(1), job(2)], { queries: ['x'], cvText: 'cv', ai, maxResults: 10, onPool })
    expect(onPool).toHaveBeenCalledWith(2, 2)
  })

  it('passes the deadline and signal through to scoring', async () => {
    const ai = fakeAi()
    const controller = new AbortController()
    controller.abort()
    // Aborted before start: no model call, every job gets the fallback score.
    const { scored } = await rankJobs([job(1)], {
      queries: ['x'],
      cvText: 'cv',
      ai,
      maxResults: null,
      signal: controller.signal,
    })
    expect(ai.complete).not.toHaveBeenCalled()
    expect(scored[0].matchReason).toBe('Score unavailable')

    const past = await rankJobs([job(1)], {
      queries: ['x'],
      cvText: 'cv',
      ai,
      maxResults: null,
      deadline: Date.now() - 1,
    })
    expect(ai.complete).not.toHaveBeenCalled()
    expect(past.scored[0].matchScore).toBe(30)
  })
})
