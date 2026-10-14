import { describe, expect, it, vi } from 'vitest'
import { CvStructuredSchema } from '@/lib/ai/schemas'
import type { AiClient } from '@/lib/ai/types'
import type { RawJob } from '@/lib/job-sources/types'
import { rankJobs, selectTop } from '@/lib/match-pipeline'
import { NOT_SCORED, type ScoredJob } from '@/lib/score-jobs'

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

  it('returns every scored job for "All", best first', async () => {
    const ai = fakeAi()
    const jobs = [job(5), job(50)]
    const { scored, top } = await rankJobs(jobs, { queries: ['x'], cvText: 'cv', ai, maxResults: null })
    expect(scored.map((j) => j.sourceJobId)).toEqual(['5', '50'])
    expect(top.map((j) => j.sourceJobId)).toEqual(['50', '5'])
  })

  it('keeps unscored jobs out of the top N when enough jobs are scored', async () => {
    // The model skips index 0, so that job stays unscored.
    const ai: AiClient = {
      provider: 'gemini',
      complete: async () =>
        '[{"index": 1, "score": 5}, {"index": 2, "score": 50}, {"index": 3, "score": 20}]',
    }
    const jobs = [job(0), job(5), job(50), job(20)]
    const { scored, top } = await rankJobs(jobs, { queries: ['x'], cvText: 'cv', ai, maxResults: 3 })
    expect(scored[0]).toMatchObject({ matchScore: null, matchReason: NOT_SCORED })
    expect(top.map((j) => j.sourceJobId)).toEqual(['50', '20', '5'])
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
    expect(onPool).toHaveBeenCalledWith(45, 40, 0)
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
    expect(onPool).toHaveBeenCalledWith(2, 2, 0)
  })

  it('passes the deadline and signal through to scoring', async () => {
    const ai = fakeAi()
    const controller = new AbortController()
    controller.abort()
    // Aborted before start: no model call, every job is left unscored.
    const { scored } = await rankJobs([job(1)], {
      queries: ['x'],
      cvText: 'cv',
      ai,
      maxResults: null,
      signal: controller.signal,
    })
    expect(ai.complete).not.toHaveBeenCalled()
    expect(scored[0].matchReason).toBe(NOT_SCORED)

    const past = await rankJobs([job(1)], {
      queries: ['x'],
      cvText: 'cv',
      ai,
      maxResults: null,
      deadline: Date.now() - 1,
    })
    expect(ai.complete).not.toHaveBeenCalled()
    expect(past.scored[0].matchScore).toBeNull()
  })

  it('passes the CV profile to the pre-rank', async () => {
    const ai = fakeAi()
    // 41 jobs and a pool of 40: only the CV skill keeps "Figma 99" in the pool.
    const jobs = [...Array.from({ length: 40 }, (_, i) => job(i + 1)), job(99, 'Figma 99')]
    const ctx = { queries: ['x'], cvText: 'cv', ai, maxResults: 10 }
    const without = await rankJobs(jobs, ctx)
    expect(without.scored.map((j) => j.title)).not.toContain('Figma 99')
    const withCv = await rankJobs(jobs, {
      ...ctx,
      cvProfile: CvStructuredSchema.parse({ skills: ['Figma'] }),
    })
    expect(withCv.scored.map((j) => j.title)).toContain('Figma 99')
  })

  it('passes the candidate location to scoring', async () => {
    const ai = fakeAi()
    await rankJobs([job(1)], {
      queries: ['x'],
      cvText: 'cv',
      ai,
      maxResults: 10,
      candidate: { location: 'Lisbon, Portugal', remoteOnly: true },
    })
    const prompt = ai.complete.mock.calls[0][0].prompt as string
    expect(prompt).toContain('searching): Lisbon, Portugal')
    expect(prompt).toContain('REMOTE ONLY: yes')
  })

  it('sends the CV profile, then the raw text, to scoring', async () => {
    const ai = fakeAi()
    await rankJobs([job(1)], {
      queries: ['x'],
      cvText: 'RAW CV TEXT',
      cvProfile: CvStructuredSchema.parse({ skills: ['Figma'], experience: [{ role: 'Designer', company: 'Acme' }] }),
      ai,
      maxResults: 10,
    })
    const prompt = ai.complete.mock.calls[0][0].prompt as string
    expect(prompt).toContain('PROFILE\nSkills: Figma\nRecent roles:\n- Designer, Acme')
    expect(prompt).toContain('FULL CV TEXT\nRAW CV TEXT')
  })

  describe('freshness', () => {
    const NOW = Date.UTC(2026, 9, 14)
    const daysAgo = (n: number) => new Date(NOW - n * 86_400_000)

    it('drops stale jobs before scoring and keeps undated ones', async () => {
      const ai = fakeAi()
      const onPool = vi.fn()
      const jobs = [
        { ...job(1), postedAt: daysAgo(3) },
        { ...job(2), postedAt: daysAgo(45) },
        job(3),
      ]
      const { scored } = await rankJobs(jobs, {
        queries: ['x'],
        cvText: 'cv',
        ai,
        maxResults: 10,
        now: NOW,
        maxAgeDays: 30,
        onPool,
      })
      expect(scored.map((j) => j.sourceJobId)).toEqual(['1', '3'])
      expect(onPool).toHaveBeenCalledWith(3, 2, 1)
      const sent = ai.complete.mock.calls.reduce((n, [opts]) => n + jobsInPrompt(opts.prompt), 0)
      expect(sent).toBe(2)
    })

    it('sizes the pool from the fresh jobs', async () => {
      const ai = fakeAi()
      const onPool = vi.fn()
      // 35 fresh + 10 stale = 45, more than the pool of 30 for 5 results; only the 35 fresh compete.
      const jobs = [
        ...Array.from({ length: 35 }, (_, i) => ({ ...job(i + 1), postedAt: daysAgo(1) })),
        ...Array.from({ length: 10 }, (_, i) => ({ ...job(100 + i), postedAt: daysAgo(60) })),
      ]
      const { scored } = await rankJobs(jobs, {
        queries: ['x'],
        cvText: 'cv',
        ai,
        maxResults: 5,
        now: NOW,
        maxAgeDays: 30,
        onPool,
      })
      expect(onPool).toHaveBeenCalledWith(45, 30, 10)
      expect(scored.every((j) => Number(j.sourceJobId) < 100)).toBe(true)
    })

    it('keeps everything when the window is 0', async () => {
      const ai = fakeAi()
      const { scored } = await rankJobs([{ ...job(1), postedAt: daysAgo(400) }], {
        queries: ['x'],
        cvText: 'cv',
        ai,
        maxResults: null,
        now: NOW,
        maxAgeDays: 0,
      })
      expect(scored).toHaveLength(1)
    })
  })
})

describe('selectTop', () => {
  const scoredJob = (id: number, matchScore: number | null): ScoredJob => ({
    ...job(id),
    matchScore,
    matchReason: matchScore === null ? NOT_SCORED : 'ok',
  })
  const ids = (jobs: ScoredJob[]) => jobs.map((j) => j.sourceJobId)

  it('puts scored jobs first, highest score first, then unscored ones', () => {
    const jobs = [scoredJob(1, null), scoredJob(2, 40), scoredJob(3, 90), scoredJob(4, null), scoredJob(5, 0)]
    expect(ids(selectTop(jobs, null))).toEqual(['3', '2', '5', '1', '4'])
  })

  it('lets unscored jobs fill only the slots that are left', () => {
    const jobs = [scoredJob(1, null), scoredJob(2, 40), scoredJob(3, 90)]
    expect(ids(selectTop(jobs, 2))).toEqual(['3', '2'])
    expect(ids(selectTop(jobs, 3))).toEqual(['3', '2', '1'])
  })

  it('keeps the input order for ties and for all-unscored input', () => {
    expect(ids(selectTop([scoredJob(1, 70), scoredJob(2, 70), scoredJob(3, 80)], null))).toEqual(['3', '1', '2'])
    expect(ids(selectTop([scoredJob(1, null), scoredJob(2, null)], 1))).toEqual(['1'])
  })

  it('does not mutate its input', () => {
    const jobs = [scoredJob(1, 10), scoredJob(2, 90)]
    selectTop(jobs, 1)
    expect(ids(jobs)).toEqual(['1', '2'])
  })
})
