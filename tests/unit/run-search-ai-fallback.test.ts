import { beforeEach, describe, expect, it, vi } from 'vitest'
import { APIError } from '@anthropic-ai/sdk'
import { ApiError as GeminiApiError } from '@google/genai'

// runSearch end to end with a blank query while the AI is down: the queries
// fall back to the CV's role, the sources still run, and the jobs are saved
// unscored, instead of the whole search failing.

const state = vi.hoisted(() => ({
  aiError: null as Error | null,
  updates: [] as Array<Record<string, unknown>>,
  inserted: [] as Array<Record<string, unknown>>,
  progress: [] as Array<Record<string, unknown>>,
  fetchedQueries: [] as string[][],
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, flush: async () => {} },
}))

vi.mock('@/db', async () => {
  const { cvs, searches } = await import('@/db/schema')
  const search = {
    id: 's1', userId: 'u1', cvId: 'cv1', query: '', location: null, remoteOnly: false,
    sources: ['remotive'], maxResults: 10, status: 'running',
  }
  const cv = {
    id: 'cv1', userId: 'u1', rawText: 'CV text',
    structured: {
      name: 'A Nurse', email: null, location: null, summary: null, skills: [],
      experience: [{ role: 'Staff Nurse', company: 'City Hospital', period: null, description: null }],
      education: [],
    },
  }
  const select = (fields?: Record<string, unknown>) => {
    let table: unknown
    const chain = {
      from: (t: unknown) => ((table = t), chain),
      where: () => chain,
      limit: async () => {
        if (fields && 'status' in fields) return [{ status: 'running' }] // isCancelled
        if (table === searches) return [search]
        if (table === cvs) return [cv]
        return []
      },
    }
    return chain
  }
  return {
    db: {
      select,
      update: () => ({ set: (values: Record<string, unknown>) => ({ where: async () => void state.updates.push(values) }) }),
      insert: () => ({
        values: (rows: Array<Record<string, unknown>>) => ({ onConflictDoNothing: async () => void state.inserted.push(...rows) }),
      }),
    },
  }
})

vi.mock('@/lib/keys', () => ({
  getDecryptedKeys: async () => ({ preferredAiProvider: 'gemini', geminiKey: 'k', usingFallback: {} }),
}))

vi.mock('@/lib/ai/provider', () => ({
  resolveProvider: () => ({ provider: 'gemini', apiKey: 'k' }),
  createAiClient: () => ({
    provider: 'gemini',
    complete: async () => {
      throw state.aiError
    },
  }),
}))

vi.mock('@/lib/job-sources', () => ({
  fetchAllSourcesMultiQuery: async (queries: string[]) => {
    state.fetchedQueries.push(queries)
    return [
      {
        source: 'remotive', sourceJobId: 'j1', title: 'Staff Nurse', company: 'Clinic', location: null,
        remote: true, salary: null, postedAt: null, description: 'Nursing role', applyUrl: 'https://example.com/j1',
      },
    ]
  },
  dedupeJobs: (jobs: unknown[]) => jobs,
}))

vi.mock('@/lib/search-progress', () => ({
  createProgressUpdater: () => async (patch: Record<string, unknown>) => void state.progress.push(patch),
}))

import { runSearch } from '@/lib/run-search'

const GEMINI_503 = '{"error":{"code":503,"message":"This model is currently experiencing high demand.","status":"UNAVAILABLE"}}'

beforeEach(() => {
  state.aiError = null
  state.updates = []
  state.inserted = []
  state.progress = []
  state.fetchedQueries = []
})

describe('runSearch with a blank query when the AI is down', () => {
  it('searches for the CV role, saves the jobs unscored and flags the fallback', async () => {
    state.aiError = new GeminiApiError({ status: 503, message: GEMINI_503 })
    await runSearch('s1', 'u1')

    expect(state.fetchedQueries).toEqual([['Staff Nurse']])
    expect(state.updates).toContainEqual({ query: 'Staff Nurse' })
    expect(state.progress).toContainEqual({ queryFallback: true })
    expect(state.inserted).toHaveLength(1)
    expect(state.inserted[0]).toMatchObject({ sourceJobId: 'j1', matchScore: null })
    expect(state.updates.at(-1)).toMatchObject({ status: 'complete' })
  })

  it('still fails the search on a non-temporary error, before any source runs', async () => {
    state.aiError = APIError.generate(
      401, { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }, undefined, new Headers()
    )
    await runSearch('s1', 'u1')

    expect(state.fetchedQueries).toEqual([])
    expect(state.progress).not.toContainEqual({ queryFallback: true })
    expect(state.updates.at(-1)).toMatchObject({ status: 'failed' })
  })
})
